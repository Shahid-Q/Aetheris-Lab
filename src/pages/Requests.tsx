import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listLocalRequests } from "../services/local";
import { useReceipts } from "../services/useReceipts";
import { Icon, Notice } from "../ui";
import { useText } from "../text";
import PageHeading from "../components/PageHeading";
import RequestList from "../components/RequestList";

export default function Requests() {
  const t = useText();
  const q = useQuery({ queryKey: ["requests"], queryFn: listLocalRequests });
  const { receipts, storageUnavailable } = useReceipts();
  const drafts = q.data ?? [];

  return (
    <div className="page">
      <div className="heading-with-action">
        <PageHeading title={t("requests")} description={t("requestIntro")} />
        <Link className="button primary" to="/analysis">
          <Icon name="add" />
          {t("new")}
        </Link>
      </div>
      <Notice>
        {t(storageUnavailable ? "receiptStorageUnavailable" : "receiptPrivacy")}
      </Notice>
      {q.isError && (
        <Notice kind="error">
          {t("draftsUnavailable")}
          <button
            type="button"
            className="button subtle"
            onClick={() => void q.refetch()}
          >
            {t("retry")}
          </button>
        </Notice>
      )}
      {receipts.length > 0 || drafts.length > 0 ? (
        <section className="panel">
          <RequestList requests={drafts} receipts={receipts} />
        </section>
      ) : q.isPending ? (
        <div className="skeleton" role="status" aria-label={t("loading")} />
      ) : (
        <div className="panel empty-state">
          <span className="empty-icon">
            <Icon name="assignment" />
          </span>
          <h2>{t("noRequests")}</h2>
          <p>{t("noRequestsText")}</p>
          <Link className="button primary" to="/analysis">
            {t("newAnalysis")}
          </Link>
        </div>
      )}
    </div>
  );
}