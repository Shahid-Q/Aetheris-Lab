import type { D1Database } from "@cloudflare/workers-types";
import { publicInputSchema } from "../src/domain";
import type { AgentStatus, Evidence, PreliminaryReport } from "../src/review";
import { providerFor, type AIConfig } from "./ai";
import { scientificSources } from "./sources";

type AgentEnv = AIConfig & { DB: D1Database; AGENT_ENABLED?: string };
type End = Exclude<AgentStatus, "running">;
const leaseMs = 3 * 60_000;

async function finish(
  db: D1Database, runId: string, status: End, failure: string | null,
  evidence: Evidence[], report: PreliminaryReport | null,
) {
  const timestamp = new Date().toISOString();
  const active = "FROM public_agent_runs WHERE id = ? AND status = 'running' AND lease_until > ?";
  const batch = evidence.map(({ id, source, kind, solution, title, url, excerpt, retrievedAt }) =>
    db.prepare(
      `INSERT INTO public_assessment_evidence (id, run_id, source, kind, solution, title, url, excerpt, retrieved_at)
       SELECT ?, id, ?, ?, ?, ?, ?, ?, ? ${active}`,
    ).bind(id, source, kind, solution, title, url, excerpt, retrievedAt, runId, timestamp),
  );
  if (report) {
    batch.push(db.prepare(
      `INSERT INTO public_assessment_drafts (run_id, report_json, created_at)
       SELECT id, ?, ? ${active}`,
    ).bind(JSON.stringify(report), timestamp, runId, timestamp));
  }
  batch.push(db.prepare(
    `UPDATE public_agent_runs SET status = ?, finished_at = ?, failure_code = ?
     WHERE id = ? AND status = 'running' AND lease_until > ?`,
  ).bind(status, timestamp, failure, runId, timestamp));
  await db.batch(batch);
}

export async function processNextRequest(env: AgentEnv) {
  if (!env.DB || env.AGENT_ENABLED !== "true") return;
  const db = env.DB;
  const provider = providerFor(env);
  const now = new Date();
  const timestamp = now.toISOString();
  const runId = crypto.randomUUID();
  // Reclaim abandoned runs as failures. All stale writes are fenced by run ID and lease.
  await db.prepare(
    `UPDATE public_agent_runs SET status = 'failed', finished_at = ?, failure_code = 'LEASE_EXPIRED'
     WHERE status = 'running' AND lease_until <= ?`,
  ).bind(timestamp, timestamp).run();

  const run = await db.prepare(
    `INSERT INTO public_agent_runs (id, request_id, status, started_at, lease_until, provider, model)
     SELECT ?, request_id, 'running', ?, ?, ?, ? FROM public_request_workflow
     WHERE status = 'Submitted' AND archived_at IS NULL
     ORDER BY updated_at, request_id LIMIT 1
     RETURNING request_id AS requestId`,
  ).bind(runId, timestamp, new Date(now.getTime() + leaseMs).toISOString(),
    provider?.name ?? null, provider?.model ?? null).first<{ requestId: string }>();
  if (!run) return;

  let status: End = provider ? "completed" : "unconfigured";
  let failure: string | null = null;
  let evidence: Evidence[] = [];
  let report: PreliminaryReport | null = null;
  try {
    const request = await db.prepare("SELECT input_json FROM public_requests WHERE id = ?")
      .bind(run.requestId).first<{ input_json: string }>();
    const input = publicInputSchema.parse(JSON.parse(request?.input_json ?? "null"));
    const collect = scientificSources();
    const results = await Promise.all([collect(input.a, "A"), collect(input.b, "B")]);
    evidence = results.flatMap((result) => result.evidence);
    report = {
      identities: results.map((result) => result.identity),
      gaps: results.flatMap((result) => result.gaps),
      assessment: null,
    };
    if (!input.conditions.trim()) report.gaps.push({ code: "conditions" });
    if (provider) {
      if (!evidence.length && report.gaps.some(({ code }) =>
        code === "pubchemUnavailable" || code === "nioshUnavailable")) {
        status = "failed";
        failure = "EVIDENCE_UNAVAILABLE";
      } else {
        try {
          report.assessment = await provider.assess(report, evidence);
        } catch {
          status = "failed";
          failure = "AI_UNAVAILABLE_OR_INVALID";
        }
      }
    }
  } catch {
    status = "failed";
    failure = "REQUEST_UNAVAILABLE";
  }
  await finish(db, runId, status, failure, evidence, report);
}
