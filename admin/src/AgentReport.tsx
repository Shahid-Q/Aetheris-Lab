import type { AdminRequestDetail, Evidence, GapCode } from "../../src/review";
import type { AdminTextKey } from "./i18n";
import { useAdminText as useText } from "./text";
import { Notice } from "../../src/ui";

const gapLabels: Record<GapCode, AdminTextKey> = {
  identity: "identityMissing",
  identifierUnverified: "extraIdentifiers",
  concentration: "concentration",
  solvent: "solvent",
  state: "state",
  temperature: "temperature",
  quantity: "quantity",
  conditions: "conditions",
  hazards: "hazards",
  incompatibilities: "incompatibilities",
  pubchemUnavailable: "pubchemUnavailable",
  nioshUnavailable: "nioshUnavailable",
  nioshNoRecord: "nioshNoRecord",
};
const identityLabels = {
  matched: "identityMatched", ambiguous: "identityAmbiguous", missing: "identityMissing",
} as const;

function EvidenceLink({ evidence }: { evidence: Evidence }) {
  return <a href={evidence.url} target="_blank" rel="noreferrer" className="text-link">
    <bdi>{evidence.title}</bdi>
  </a>;
}

export function AgentReport({ request }: { request: AdminRequestDetail }) {
  const t = useText();
  const { run, report, evidence } = request;
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const sections = report?.assessment && [
    ["agentHazards", report.assessment.hazardEvidenceIds],
    ["agentPairConcerns", report.assessment.pairConcernEvidenceIds],
  ] as const;

  return (
    <section className="panel admin-section">
      <h2>{t("preliminaryAssessment")}</h2>
      {!run && <Notice>{t("agentWaiting")}</Notice>}
      {run?.status === "running" && <Notice>{t("agentRunning")}</Notice>}
      {run?.status === "unconfigured" && <Notice kind="warning">{t("agentUnconfigured")}</Notice>}
      {run?.status === "failed" && <Notice kind="warning">
        {t("agentFailed")} {run.failureCode && <bdi className="small mono">{run.failureCode}</bdi>}
      </Notice>}
      {report && (
        <>
          <Notice kind="warning">{t("preliminaryCaution")}</Notice>
          <div className="admin-grid">
            <section>
              <h3>{t("catalogMatches")}</h3>
              {report.identities.map((identity) => (
                <div key={identity.solution}>
                  <p><strong>{t("solution")} {identity.solution}</strong> · {t(identityLabels[identity.state])}</p>
                  {identity.records.length > 0 && <ul>
                    {identity.records.map((record) => (
                      <li key={record.cid}><bdi>{record.name} · {record.formula} · CID {record.cid}</bdi></li>
                    ))}
                  </ul>}
                </div>
              ))}
            </section>
            {report.gaps.length > 0 && (
              <section>
                <h3>{t("evidenceGaps")}</h3>
                <ul>
                  {report.gaps.map(({ code, solution }) => (
                    <li key={code + (solution ?? "")}>
                      {solution ? `${t("solution")} ${solution} · ` : ""}{t(gapLabels[code])}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {sections && sections.map(([key, ids]) => (
              <section key={key}>
                <h3>{t(key)}</h3>
                {ids.length ? <ul>{ids.map((id) => {
                  const item = byId.get(id);
                  return item && <li key={id}>{item.solution} · <EvidenceLink evidence={item} /></li>;
                })}</ul> : <p>{t("noAgentFlags")}</p>}
              </section>
            ))}
            {report.assessment && (
              <section>
                <h3>{t("agentUncertainty")}</h3>
                <ul>
                  {[...new Set(["substanceOnly", ...report.assessment.uncertainty] as const)]
                    .map((code) => <li key={code}>{t(code)}</li>)}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
      <section>
        <h3>{t("retrievedEvidence")}</h3>
        {evidence.length === 0 && <p className="muted">{t("noRetrievedEvidence")}</p>}
        {evidence.map((item) => (
          <article className="admin-evidence" key={item.id}>
            <div className="small muted">{t("solution")} {item.solution} · <bdi>{item.source}</bdi></div>
            <EvidenceLink evidence={item} />
            <p dir="auto">{item.excerpt}</p>
            <time className="small muted" dateTime={item.retrievedAt}>
              {new Date(item.retrievedAt).toLocaleString(document.documentElement.lang || undefined)}
            </time>
          </article>
        ))}
      </section>
    </section>
  );
}
