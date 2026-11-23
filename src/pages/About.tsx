import { Icon, Notice } from "../ui";
import { useText } from "../text";
import PageHeading from "../components/PageHeading";
export default function About() {
  const t = useText();
  return (
    <div className="page about-page">
      <PageHeading
        eyebrow="AETHERIS LAB"
        title={t("aboutTitle")}
        description={t("aboutText")}
      />
      <div className="detail-grid">
        <section className="panel">
          <Icon name="verified_user" />
          <h2>{t("safety")}</h2>
          <p>{t("safetyText")}</p>
          <p>{t("approval")}</p>
        </section>
        <section className="panel">
          <Icon name="construction" />
          <h2>{t("readiness")}</h2>
          <p>{t("readinessText")}</p>
          <p>{t("localNotice")}</p>
        </section>
      </div>
      <Notice>{t("privacy")}</Notice>
    </div>
  );
}
