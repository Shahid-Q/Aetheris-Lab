import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listLocalRequests } from "../services/local";
import { Icon, Notice } from "../ui";
import { useText } from "../text";
import PageHeading from "../components/PageHeading";
export default function RequestDetail() {
  const { id } = useParams();
  const t = useText();
  const q = useQuery({ queryKey: ["requests"], queryFn: listLocalRequests });
  if (q.isPending) return <div className="page skeleton" />;
  if (q.isError)
    return (
      <div className="page">
        <Notice kind="error">{t("draftsUnavailable")}</Notice>
      </div>
    );
  const r = q.data.find((v) => v.id === id);
  if (!r)
    return (
      <div className="page">
        <h1>{t("requestMissing")}</h1>
        <Link to="/requests">{t("back")}</Link>
      </div>
    );
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `aetheris-${r!.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="page">
      <Link className="text-link" to="/requests">
        {t("back")} · {t("requests")}
      </Link>
      <PageHeading
        eyebrow={t("notSubmitted")}
        title={t(r.mode === "demo" ? "legacyPreview" : "saved")}
        description={t("noVerdict")}
      />
      <div className="panel request-metadata">
        <div>
          <span>{t("requestId")}</span>
          <strong className="mono">{r.id}</strong>
        </div>
        <div>
          <span>{t("created")}</span>
          <strong>
            {new Date(r.createdAt).toLocaleString(
              document.documentElement.lang,
            )}
          </strong>
        </div>
        <div>
          <span>{t("status")}</span>
          <strong>{t(r.mode === "demo" ? "legacyPreview" : "draft")}</strong>
        </div>
        <div>
          <span>{t("completion")}</span>
          <strong>{t("notCompleted")}</strong>
        </div>
      </div>
      <div className="detail-grid">
        {[r.a, r.b].map((s, i) => (
          <section className="panel" key={i}>
            <span className={`solution-letter ${i ? "b" : "a"}`}>
              {i ? "B" : "A"}
            </span>
            <h2>{s.name}</h2>
            <dl className="request-solution">
              {(
                [
                  "formula",
                  "cas",
                  "concentration",
                  "unit",
                  "solvent",
                  "state",
                  "temperature",
                  "quantity",
                  "quantityUnit",
                  "notes",
                ] as const
              ).map((key) => (
                <div key={key}>
                  <dt>{t(key)}</dt>
                  <dd>{s[key] || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <section className="panel">
        <h2>{t("conditions")}</h2>
        <p className="preserve-lines">{r.conditions || t("unknown")}</p>
      </section>
      {r.mode === "draft" && (
        <section className="panel timeline-panel">
          <h2>{t("history")}</h2>
          <ol className="timeline">
            {r.history.map((h, i) => (
              <li key={i}>
                <span className="timeline-node">
                  <Icon
                    name={
                      i === r.history.length - 1
                        ? "radio_button_checked"
                        : "check"
                    }
                  />
                </span>
                <div>
                  <h3>{h.status}</h3>
                  <time>
                    {new Date(h.at).toLocaleString(document.documentElement.lang)}
                  </time>
                  <p>{h.note}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <div className="result-locked">
        <Icon name="lock" />
        <h2>{t("noVerdict")}</h2>
        <p>{t("safetyText")}</p>
        <p className="small">{t("approval")}</p>
      </div>
      <button className="button outlined" onClick={download}>
        <Icon name="download" />
        {t("copy")}
      </button>
    </div>
  );
}
