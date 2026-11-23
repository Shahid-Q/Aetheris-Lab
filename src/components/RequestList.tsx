import { Link } from "react-router-dom";
import type { LocalRequest, PublicReceipt } from "../domain";
import { Icon } from "../ui";
import { useText } from "../text";

export default function RequestList({
  requests,
  receipts,
  limit,
}: {
  requests: LocalRequest[];
  receipts: PublicReceipt[];
  limit?: number;
}) {
  const t = useText();
  const entries = [...receipts, ...requests]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  return (
    <div className="request-list">
      {entries.map((entry) => {
        const local = "mode" in entry;
        const label = local
          ? t(entry.mode === "demo" ? "legacyPreview" : "draft")
          : t("submitted");
        return (
          <Link
            className="request-row"
            key={entry.id}
            to={"/requests/" + entry.id + (local ? "" : "/receipt")}
          >
            <span className="request-icon">
              <Icon name={local ? "science" : "assignment"} />
            </span>
            <div>
              <strong>
                {local ? (
                  <>
                    {entry.a.name} <span className="muted">+</span>{" "}
                    {entry.b.name}
                  </>
                ) : (
                  t("receipt")
                )}
              </strong>
              <small>
                <bdi>{entry.id.slice(0, 8).toUpperCase()}</bdi> ·{" "}
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString(
                    document.documentElement.lang || undefined,
                  )}
                </time>
              </small>
            </div>
            <span className="status-pill">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}
