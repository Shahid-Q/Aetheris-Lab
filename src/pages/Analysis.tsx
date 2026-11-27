import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { SolutionCard, type ImageAttachment } from "../components/SolutionCard";
import { unknown, type Solution } from "../domain";
import { saveLocalRequest } from "../services/local";
import { RequestError, submitRequest } from "../services/publicRequests";
import { useRetryDelay } from "../services/useRetryDelay";
import { Icon, Modal, Notice } from "../ui";
import { useText } from "../text";
import PageHeading from "../components/PageHeading";

interface InstantEvaluation {
  summary: string;
  compatibilityNote: string;
  missingDetails: string[];
  estimatedSavingsText: string;
  wasteReductionText: string;
}

function parsePositiveNumber(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === unknown) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function evaluatePairInstantly(
  a: Solution,
  b: Solution,
  conditions: string,
  costAInput: string,
  costBInput: string,
): InstantEvaluation {
  const nameA = a.name.trim() || "Solution A";
  const nameB = b.name.trim() || "Solution B";
  const casA = a.cas.trim();
  const casB = b.cas.trim();
  const sameSubstance =
    (casA && casA !== unknown && casB && casB !== unknown && casA === casB) ||
    nameA.toLowerCase() === nameB.toLowerCase();

  const missingDetails: string[] = [];
  if (a.concentration === unknown) missingDetails.push(`${nameA}: concentration is Unknown`);
  if (b.concentration === unknown) missingDetails.push(`${nameB}: concentration is Unknown`);
  if (a.state === unknown) missingDetails.push(`${nameA}: physical state is Unknown`);
  if (b.state === unknown) missingDetails.push(`${nameB}: physical state is Unknown`);
  if (a.temperature === unknown && b.temperature === unknown && !conditions.trim()) {
    missingDetails.push("Temperature and mixing conditions are not specified");
  }

  const compatibilityNote = `Instant preview for ${nameA} + ${nameB} (no admin approval needed).`;
  let summary = sameSubstance
    ? `Both entries point to the same substance (${nameA}). Avoiding accidental re-mixing or mislabeling still protects against concentration, solvent, or thermal differences.`
    : `Instant screening for ${nameA} and ${nameB}: verify reactivity, flammability/volatility, solubility, and heat effects for your concentrations (${a.concentration} ${a.unit !== unknown ? a.unit : ""} vs. ${b.concentration} ${b.unit !== unknown ? b.unit : ""}).`;

  if (conditions.trim()) {
    summary += ` Conditions noted: "${conditions.trim()}".`;
  }

  const parsedCostA = parsePositiveNumber(costAInput);
  const parsedCostB = parsePositiveNumber(costBInput);
  let estimatedSavingsText =
    "Enter optional cost values for A and/or B above to estimate protected material value.";
  if (parsedCostA !== null || parsedCostB !== null) {
    const totalCost = (parsedCostA ?? 0) + (parsedCostB ?? 0);
    estimatedSavingsText = `Estimated cost value protected from an unwanted/unsafe mix: ${totalCost.toFixed(2)} (user estimate).`;
  }

  const qtyA = parsePositiveNumber(a.quantity);
  const qtyB = parsePositiveNumber(b.quantity);
  const unitA = a.quantityUnit !== unknown ? a.quantityUnit : "units";
  const unitB = b.quantityUnit !== unknown ? b.quantityUnit : "units";

  let wasteReductionText =
    "Enter quantity and unit on Solution A and/or B to measure material kept out of potential waste.";
  if (qtyA !== null && qtyB !== null) {
    wasteReductionText =
      a.quantityUnit === b.quantityUnit
        ? `Potential mixture volume/mass avoided: ${(qtyA + qtyB).toFixed(2)} ${unitA} (${qtyA} ${unitA} ${nameA} + ${qtyB} ${unitB} ${nameB}).`
        : `Potential material kept separate: ${qtyA} ${unitA} (${nameA}) and ${qtyB} ${unitB} (${nameB}).`;
  } else if (qtyA !== null) {
    wasteReductionText = `Potential material kept separate: ${qtyA} ${unitA} of ${nameA}.`;
  } else if (qtyB !== null) {
    wasteReductionText = `Potential material kept separate: ${qtyB} ${unitB} of ${nameB}.`;
  }

  return {
    summary,
    compatibilityNote,
    missingDetails,
    estimatedSavingsText,
    wasteReductionText,
  };
}

export default function Analysis() {
  const t = useText();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [a, setA] = useState<Solution | null>(null);
  const [b, setB] = useState<Solution | null>(null);
  const [costA, setCostA] = useState("");
  const [costB, setCostB] = useState("");
  const [imageA, setImageA] = useState<ImageAttachment | null>(null);
  const [imageB, setImageB] = useState<ImageAttachment | null>(null);
  const [attachPhotos, setAttachPhotos] = useState(false);
  const [conditions, setConditions] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestError>();
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(false);
  const cooldown = useRetryDelay(failure?.retryAt ?? 0);
  const method = new URLSearchParams(location.search).get("method");

  useEffect(() => {
    active.current = location.pathname === "/analysis";
    return () => {
      active.current = false;
    };
  }, [location.pathname]);
  useEffect(
    () => () => {
      if (imageA) URL.revokeObjectURL(imageA.url);
    },
    [imageA],
  );
  useEffect(
    () => () => {
      if (imageB) URL.revokeObjectURL(imageB.url);
    },
    [imageB],
  );

  useEffect(() => {
    if (!imageA && !imageB) setAttachPhotos(false);
  }, [imageA, imageB]);

  const instantResult = useMemo(() => {
    if (!a || !b) return null;
    return evaluatePairInstantly(a, b, conditions, costA, costB);
  }, [a, b, conditions, costA, costB]);

  function saveDraft() {
    if (!a || !b || inFlight.current || conditions.length > 3000) {
      return;
    }

    try {
      const draft = saveLocalRequest({ a, b, conditions });
      void client.invalidateQueries({ queryKey: ["requests"] });
      navigate("/requests/" + draft.id);
    } catch {
      setDraftError(true);
    }
  }

  async function submit() {
    if (!a || !b || inFlight.current || cooldown || conditions.length > 3000)
      return;
    inFlight.current = true;
    setConfirmRetry(false);
    setPending(true);
    setFailure(undefined);
    setDraftError(false);
    try {
      const id = await submitRequest(
        { a, b, conditions },
        attachPhotos ? { imageA: imageA?.file, imageB: imageB?.file } : undefined,
      );
      if (active.current)
        navigate("/requests/" + id + "/receipt", { replace: true });
    } catch (error) {
      inFlight.current = false;
      if (active.current) {
        setFailure(
          error instanceof RequestError
            ? error
            : new RequestError("unconfirmed"),
        );
        setPending(false);
      }
    }
  }

  return (
    <div className="page">
      <PageHeading title={t("newAnalysis")} description={t("analysisIntro")} />
      <Notice kind="warning">
        <strong>{t("review")}</strong> {t("reviewText")}
      </Notice>
      <fieldset className="request-fields" disabled={pending}>
        <div className="solutions-grid">
          <SolutionCard
            letter="A"
            value={a}
            onChange={setA}
            image={imageA}
            onImage={setImageA}
            initialMethod={method ?? undefined} />
          <div className="pair-connector">
            <Icon name="add" />
          </div>
          <SolutionCard
            letter="B"
            value={b}
            onChange={setB}
            image={imageB}
            onImage={setImageB}
          />
        </div>
        <section className="panel context-panel">
          <TextField
            fullWidth
            multiline
            rows={3}
            label={t("conditions")}
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            placeholder={t("conditionsHint")}
            slotProps={{ htmlInput: { maxLength: 3000 } }}
          />
          <div className="solutions-grid" style={{ marginTop: "1rem" }}>
            <TextField
              type="number"
              label="Estimated cost — Solution A (optional)"
              value={costA}
              onChange={(e) => setCostA(e.target.value)}
              slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
            />
            <TextField
              type="number"
              label="Estimated cost — Solution B (optional)"
              value={costB}
              onChange={(e) => setCostB(e.target.value)}
              slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
            />
          </div>
          <p className="small muted">{t("unknownFields")}</p>
        </section>
      </fieldset>

      {instantResult && (
        <section className="panel" aria-live="polite">
          <h3>Instant Mixing Result (No Admin Approval Required)</h3>
          <p><strong>{instantResult.compatibilityNote}</strong></p>
          <p>{instantResult.summary}</p>
          <p><strong>Estimated Money Saved / Protected:</strong> {instantResult.estimatedSavingsText}</p>
          <p><strong>Environmental Waste Reduction:</strong> {instantResult.wasteReductionText}</p>
          {instantResult.missingDetails.length > 0 && (
            <div>
              <p className="small muted"><strong>Data gaps to verify:</strong></p>
              <ul className="small muted">
                {instantResult.missingDetails.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="small muted">
            Instant local preview for rapid guidance; verify experimentally and consult safety data before mixing chemicals.
          </p>
        </section>
      )}

      <section className="submission-panel" aria-busy={pending}>
        <div>
          <h3>{t("submitRequest")}</h3>
          <p>{t("submissionNotice")}</p>
          {attachPhotos && (imageA || imageB) && <p>{t("photosPrivate")}</p>}
        </div>
        {(imageA || imageB) && (
          <FormControlLabel
            label={t("attachReviewPhotos")}
            control={<Checkbox checked={attachPhotos} disabled={pending} onChange={(_, value) => setAttachPhotos(value)} />}
          />
        )}
        <Button
          variant="contained"
          disabled={!a || !b || pending || cooldown}
          onClick={() =>
            failure?.code === "unconfirmed"
              ? setConfirmRetry(true)
              : void submit()
          }
        >
          {pending
            ? t("submitting")
            : failure
              ? t("retry")
              : t("submitRequest")}
        </Button>
      </section>
      <span role="status" className="sr-only">
        {pending && t("submitting")}
      </span>
      {failure && (
        <Notice kind="error">
          {failure.code === "unconfirmed"
            ? t("submissionUnconfirmed")
            : failure.code === "rateLimited"
              ? t(cooldown ? "rateLimited" : "retryAvailable")
              : failure.code === "validation"
                ? t("submissionInvalid")
                : t("submissionRejected")}
        </Notice>
      )}
      <div className="local-actions">
        <p>{t("localNotice")}</p>
        <Button
          variant="outlined"
          disabled={!a || !b || pending}
          onClick={saveDraft}
        >
          <Icon name="save" />
          {t("saveDraft")}
        </Button>
      </div>
      {draftError && <Notice kind="error">{t("localDataError")}</Notice>}
      {confirmRetry && (
        <Modal
          title={t("retrySubmission")}
          onClose={() => setConfirmRetry(false)}
        >
          <p>{t("submissionUnconfirmed")}</p>
          <div className="button-row">
            <Button onClick={() => setConfirmRetry(false)}>
              {t("cancel")}
            </Button>
            <Button variant="contained" onClick={() => void submit()}>
              {t("submitAgain")}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}