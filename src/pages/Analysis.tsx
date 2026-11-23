import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { SolutionCard, type ImageAttachment } from "../components/SolutionCard";
import type { Solution } from "../domain";
import { saveLocalRequest } from "../services/local";
import { RequestError, submitRequest } from "../services/publicRequests";
import { useRetryDelay } from "../services/useRetryDelay";
import { Icon, Modal, Notice } from "../ui";
import { useText } from "../text";
import PageHeading from "../components/PageHeading";

export default function Analysis() {
  const t = useText();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [a, setA] = useState<Solution | null>(null);
  const [b, setB] = useState<Solution | null>(null);
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
          <p className="small muted">{t("unknownFields")}</p>
        </section>
      </fieldset>
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
