import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useState, type FormEvent } from "react";
import { finalResultSchema, type PublicResult } from "../../src/domain";
import { reviewInputSchema, type AdminRequestDetail, type ReviewDecision } from "../../src/review";
import { resultLabel } from "../../src/reviewText";
import { useAdminText as useText } from "./text";
import { Notice } from "../../src/ui";

type Draft = Record<"conditions" | "hazards" | "incompatibilities" | "storage" | "container" | "limitations", string>;
const fieldLabels = {
  conditions: "documentedConditions",
  hazards: "hazards",
  incompatibilities: "incompatibilities",
  storage: "storageAssessment",
  container: "containerAssessment",
  limitations: "limitations",
} as const;

export function ReviewForm({ request, busy, onSubmit }: {
  request: AdminRequestDetail;
  busy: boolean;
  onSubmit: (body: unknown) => void;
}) {
  const t = useText();
  const [decision, setDecision] = useState<ReviewDecision>("Approved");
  const [notes, setNotes] = useState("");
  const [fields, setFields] = useState<Draft>({
    conditions: "", hazards: "", incompatibilities: "", storage: "", container: "", limitations: "",
  });
  const [classification, setClassification] = useState<PublicResult["classification"]>("Insufficient information");
  const [selected, setSelected] = useState<string[]>([]);
  const [externalSources, setExternalSources] = useState<{ title: string; url: string }[]>([]);
  const [attestation, setAttestation] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const approval = decision === "Approved";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !request.run) return;
    const items = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
    const base = { runId: request.run.id, decision, notes };
    const parsed = reviewInputSchema.safeParse(approval ? {
      ...base,
      result: {
        ...fields, classification,
        hazards: items(fields.hazards),
        incompatibilities: items(fields.incompatibilities),
        limitations: items(fields.limitations),
        evidenceIds: selected, externalSources, attestation,
      },
    } : base);
    const needsMixtureSource = approval && classification === "Compatible under documented conditions" && !externalSources.length;
    setInvalid(!parsed.success || needsMixtureSource);
    if (parsed.success && !needsMixtureSource) onSubmit(parsed.data);
  }

  return (
    <section className="panel admin-section">
      <h2>{t("reviewDecision")}</h2>
      <form onSubmit={submit} className="admin-form">
        <fieldset className="request-fields admin-form" disabled={busy}>
          <TextField select fullWidth label={t("reviewDecision")} value={decision}
            onChange={(event) => { setDecision(event.target.value as ReviewDecision); setInvalid(false); }}>
            <MenuItem value="Approved">{t("approveAction")}</MenuItem>
            <MenuItem value="Rejected">{t("rejectAction")}</MenuItem>
            <MenuItem value="Needs More Information">{t("moreInfoAction")}</MenuItem>
          </TextField>
          <TextField required fullWidth multiline label={t("reviewerNotes")} value={notes}
            slotProps={{ htmlInput: { maxLength: 2500 } }}
            onChange={(event) => setNotes(event.target.value)} />
          {approval && (
            <>
              <p className="muted">{t("publicationText")}</p>
              <TextField select fullWidth label={t("resultClassification")} value={classification}
                onChange={(event) => setClassification(event.target.value as PublicResult["classification"])}>
                {finalResultSchema.shape.classification.options.map((option) => (
                  <MenuItem key={option} value={option}>{t(resultLabel[option])}</MenuItem>
                ))}
              </TextField>
              {Object.entries(fields).map(([name, value]) => {
                const key = name as keyof Draft;
                const list = key === "hazards" || key === "incompatibilities" || key === "limitations";
                return <TextField key={name} fullWidth multiline label={t(fieldLabels[key])} value={value}
                  required={key !== "hazards" && key !== "incompatibilities"}
                  helperText={list ? t("lineItems")
                    : (key === "storage" || key === "container") ? t("adminNotAssessed") : undefined}
                  slotProps={{ htmlInput: { maxLength: list ? 6000 : 2500 } }}
                  onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} />;
              })}
              {request.evidence.length > 0 && (
                <fieldset className="request-fields admin-choices">
                  <legend>{t("evidenceSelection")}</legend>
                  {request.evidence.map((item) => (
                    <FormControlLabel key={item.id} label={<bdi>{item.solution} · {item.title}</bdi>}
                      control={<Checkbox checked={selected.includes(item.id)} onChange={(_, checked) =>
                        setSelected((current) => checked ? [...current, item.id] : current.filter((id) => id !== item.id))
                      } />} />
                  ))}
                </fieldset>
              )}
              {classification === "Compatible under documented conditions" &&
                <Notice kind="warning">{t("mixtureSourceRequired")}</Notice>}
              {externalSources.map((source, index) => (
                <fieldset key={index} className="request-fields admin-form">
                  <legend>{t("externalReference")}</legend>
                  <TextField required fullWidth label={t("sourceTitle")} value={source.title}
                    slotProps={{ htmlInput: { maxLength: 250 } }}
                    onChange={(event) => setExternalSources((current) => current.map((item, i) =>
                      i === index ? { ...item, title: event.target.value } : item))} />
                  <TextField required fullWidth type="url" label={t("sourceUrl")} value={source.url}
                    slotProps={{ htmlInput: { maxLength: 1500 } }}
                    onChange={(event) => setExternalSources((current) => current.map((item, i) =>
                      i === index ? { ...item, url: event.target.value } : item))} />
                  <Button type="button" onClick={() => setExternalSources((current) => current.filter((_, i) => i !== index))}>
                    {t("remove")}
                  </Button>
                </fieldset>
              ))}
              {externalSources.length < 5 && <div>
                <Button type="button" variant="outlined"
                  onClick={() => setExternalSources((current) => [...current, { title: "", url: "" }])}>
                  {t("addReference")}
                </Button>
              </div>}
              <FormControlLabel label={t("reviewAttestation")}
                control={<Checkbox checked={attestation} onChange={(_, checked) => setAttestation(checked)} />} />
            </>
          )}
          {invalid && <Notice kind="error">{t("adminWriteError")}</Notice>}
          <div>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? t("loading") : t(approval ? "publishConfirm" : "saveDecision")}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
