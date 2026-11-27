import Button from "@mui/material/Button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApprovedResultPanel } from "../components/ApprovedResultPanel";
import { statusLabel } from "../reviewText";
import PageHeading from "../components/PageHeading";
import type { PublicReceipt } from "../domain";
import { trackRequest, type RequestError } from "../services/publicRequests";
import { forgetReceipt } from "../services/receipts";
import { useReceipts } from "../services/useReceipts";
import { useRetryDelay } from "../services/useRetryDelay";
import { useText } from "../text";
import { Icon, Modal, Notice } from "../ui";

export default function Receipt() {
  const { id = "" } = useParams();
  const t = useText();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { receipts, storageUnavailable } = useReceipts();
  const saved = receipts.find((receipt) => receipt.id === id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const queryKey = ["receipt", id];
  const tracking = useQuery<PublicReceipt, RequestError>({
    queryKey,
    queryFn: ({ signal }) => trackRequest(id, signal),
    enabled: !!saved,
    gcTime: 0,
    networkMode: "always",
    retry: false,
    refetchOnReconnect: false,
    refetchInterval: ({ state }) => !state.error &&
      (state.data?.status === "Submitted" || state.data?.status === "Analyzing" || state.data?.status === "Pending Review")
      ? 30_000 : false,
  });
  const cooldown = useRetryDelay(tracking.error?.retryAt ?? 0);
  const receipt = tracking.data ?? saved;
  const rejected = tracking.error?.code === "missing";
  const parsedCreatedAt = receipt ? new Date(receipt.createdAt) : null;
  const hasValidCreatedAt =
    parsedCreatedAt !== null && !Number.isNaN(parsedCreatedAt.getTime());
  const formattedCreatedAt = receipt
    ? hasValidCreatedAt
      ? parsedCreatedAt.toLocaleString(document.documentElement.lang || undefined)
      : receipt.createdAt
    : "";

  function remove() {
    if (!forgetReceipt(id)) {
      setDeleteError(true);
      setConfirmDelete(false);
      return;
    }
    client.removeQueries({ queryKey, exact: true });
    navigate("/requests", { replace: true });
  }

  return (
    <div className="page">
      <Link className="text-link" to="/requests">
        {t("back")} · {t("requests")}
      </Link>
      <PageHeading title={t("receipt")} description={t("receiptIntro")} />
      {!saved ? (
        <Notice kind="error">
          {t(
            storageUnavailable ? "receiptStorageUnavailable" : "receiptMissing",
          )}
        </Notice>
      ) : (
        <>
          {receipt && !rejected && (
            <div className="panel request-metadata">
              <div>
                <span>{t("requestId")}</span>
                <strong className="mono">
                  <bdi>{receipt.id}</bdi>
                </strong>
              </div>
              <div>
                <span>{t("created")}</span>
                <strong>
                  <time
                    dateTime={
                      hasValidCreatedAt && parsedCreatedAt
                        ? parsedCreatedAt.toISOString()
                        : undefined
                    }
                  >
                    {formattedCreatedAt}
                  </time>
                </strong>
              </div>
              <div>
                <span>{t("status")}</span>
                <strong>{t(statusLabel[receipt.status])}</strong>
              </div>
            </div>
          )}
          {tracking.isFetching && (
            <p role="status" className="small muted">
              {t("checkingReceipt")}
            </p>
          )}
          {tracking.isError && (
            <Notice kind="error">
              {rejected
                ? t("receiptMissing")
                : tracking.error.code === "rateLimited"
                  ? t(cooldown ? "rateLimited" : "retryAvailable")
                  : t("trackingUnavailable")}
            </Notice>
          )}
          <Notice>
            {t(saved.persistent ? "receiptPrivacy" : "receiptTemporary")}
          </Notice>
          <div className="button-row">
            <Button
              variant="outlined"
              disabled={tracking.isFetching || cooldown}
              onClick={() => void tracking.refetch()}
            >
              {t("refreshReceipt")}
            </Button>
            <Button
              onClick={() => {
                setDeleteError(false);
                setConfirmDelete(true);
              }}
            >
              {t("forgetReceipt")}
            </Button>
          </div>
          {deleteError && (
            <Notice kind="error">{t("receiptDeleteError")}</Notice>
          )}
          {confirmDelete && (
            <Modal
              title={t("forgetReceipt")}
              onClose={() => setConfirmDelete(false)}
            >
              <p>{t("receiptDeleteConfirm")}</p>
              <div className="button-row">
                <Button onClick={() => setConfirmDelete(false)}>
                  {t("cancel")}
                </Button>
                <Button variant="contained" onClick={remove}>
                  {t("remove")}
                </Button>
              </div>
            </Modal>
          )}
        </>
      )}
      {saved && !tracking.isError && tracking.data?.status === "Approved" ? (
        <ApprovedResultPanel result={tracking.data.result} />
      ) : (
        <div className="result-locked">
          <Icon name="lock" />
          <h2>{t("noVerdict")}</h2>
          <p>{t(receipt?.status === "Rejected" ? "receiptRejected"
            : receipt?.status === "Needs More Information" ? "receiptNeedsMore" : "reviewText")}</p>
        </div>
      )}
    </div>
  );
}