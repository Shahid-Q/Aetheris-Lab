import { Link, useParams } from "react-router-dom";
import { chemicals } from "../data/chemicals";
import { Icon, Notice } from "../ui";
import { useText } from "../text";
export default function ChemicalDetail() {
  const { id } = useParams();
  const t = useText();
  const c = chemicals.find((v) => v.id === id);
  if (!c) return <div className="page">{t("empty")}</div>;
  return (
    <div className="page detail-page">
      <Link className="text-link" to="/library">
        {t("back")} · {t("library")}
      </Link>
      <div className="chemical-detail-header">
        <div>
          <span className="eyebrow">NIOSH REFERENCE · {c.category}</span>
          <h1>{c.name}</h1>
          <p>{c.aliases.join(" · ")}</p>
        </div>
        <span className="large-formula">{c.formula}</span>
      </div>
      <div className="detail-meta panel">
        <div>
          {t("cas")}
          <strong>{c.cas}</strong>
        </div>
        <div>
          {t("mass")}
          <strong>{c.mass} g/mol</strong>
        </div>
        <div>
          {t("state")}
          <strong>{c.state}</strong>
        </div>
        <div>
          {t("sourceDate")}
          <strong>{c.verifiedOn}</strong>
        </div>
      </div>
      <div className="detail-grid">
        {[
          [t("physical"), c.description, "science"],
          [t("hazards"), c.hazards, "warning"],
          [t("incompatibilities"), c.incompatibilities, "report"],
          [t("storage"), t("storageNote"), "inventory_2"],
        ].map(([title, body, icon]) => (
          <section className="panel" key={title}>
            <Icon name={icon} />
            <h2>{title}</h2>
            <p>{body}</p>
          </section>
        ))}
      </div>
      <Notice>{t("notVerified")}</Notice>
      <section className="panel">
        <h2>{t("references")}</h2>
        <a
          className="text-link"
          href={c.source}
          target="_blank"
          rel="noreferrer"
        >
          CDC / NIOSH Pocket Guide · {c.name} <Icon name="open_in_new" />
        </a>
        <p className="small muted">
          This substance reference does not determine compatibility for your
          solution or conditions.
        </p>
      </section>
    </div>
  );
}
