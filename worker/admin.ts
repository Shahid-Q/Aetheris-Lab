import { z } from "zod";
import {
  finalResultSchema, publicResultSchema, publicInputSchema, publicRequestIdSchema, publicRequestStatusSchema,
  type PublicRequestStatus,
} from "../src/domain";
import {
  adminManageSchema, retryInputSchema, reviewInputSchema, type AdminRequestDetail, type AdminRequestList,
  type Evidence, type PreliminaryReport, type ReviewDecision,
} from "../src/review";
import type { Env } from "./index";
import { providerFor } from "./ai";
import { error, json, readJson } from "./http";

const pageSize = 30;

async function list(env: Env, url: URL) {
  const filter = z.strictObject({
    status: publicRequestStatusSchema.optional(),
    archived: z.literal("true").optional(),
    after: z.string().max(150).optional(),
  }).safeParse(Object.fromEntries(url.searchParams));
  if (!filter.success) return error("INVALID_FILTER", 400);
  const { status, after, archived } = filter.data;
  let cursor: { createdAt: string; id: string } | null = null;
  if (after !== undefined) {
    const parts = z.tuple([z.string().min(1).max(100), publicRequestIdSchema]).safeParse(after.split("/"));
    if (!parts.success) return error("INVALID_FILTER", 400);
    cursor = { createdAt: parts.data[0], id: parts.data[1] };
  }
  const { results } = await env.DB.prepare(
    `SELECT r.id, w.status, r.created_at AS createdAt,
       json_extract(r.input_json, '$.a.name') AS nameA,
       json_extract(r.input_json, '$.b.name') AS nameB
     FROM public_requests r JOIN public_request_workflow w ON w.request_id = r.id
     WHERE (w.archived_at IS NOT NULL) = ?
       AND (? IS NULL OR w.status = ?) AND (? IS NULL OR (r.created_at, r.id) < (?, ?))
     ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
  ).bind(archived ? 1 : 0, status ?? null, status ?? null, cursor?.createdAt ?? null,
    cursor?.createdAt ?? null, cursor?.id ?? null, pageSize + 1)
    .all<AdminRequestList["requests"][number]>();
  const requests = results.slice(0, pageSize);
  const last = requests.at(-1);
  return json({ requests, next: results.length > pageSize && last ? `${last.createdAt}/${last.id}` : null });
}

async function manage(request: Request, env: Env, reviewer: string) {
  const input = await readJson(request, 4096);
  if (input instanceof Response) return input;
  const parsed = adminManageSchema.safeParse(input);
  if (!parsed.success) return error("INVALID_REQUEST", 400);
  const { action, ids } = parsed.data;
  const serializedIds = JSON.stringify(ids);
  const now = new Date().toISOString();

  if (action === "delete") {
    try {
      const { results } = await env.DB.prepare(
        `INSERT INTO public_request_management_events (request_id, action, actor, created_at)
         SELECT id, 'delete', ?, ? FROM public_requests
         WHERE id IN (SELECT DISTINCT value FROM json_each(?))
         RETURNING request_id AS id`,
      ).bind(reviewer, now, serializedIds)
        .all<{ id: string }>();
      return json({ changed: results.length });
    } catch {
      return error("SERVICE_UNAVAILABLE", 503);
    }
  }

  const { results } = await env.DB.prepare(
    `INSERT INTO public_request_management_events (request_id, action, actor, created_at)
     SELECT request_id, ?, ?, ? FROM public_request_workflow
     WHERE request_id IN (SELECT value FROM json_each(?))
       AND CASE ?
         WHEN 'archive' THEN archived_at IS NULL
         WHEN 'restore' THEN archived_at IS NOT NULL
         ELSE 0
       END
     RETURNING request_id AS id`,
  ).bind(action, reviewer, now, serializedIds, action)
    .all<{ id: string }>();
  return json({ changed: results.length });
}

const evidenceColumns = `id, source, kind, solution, title, url, excerpt, retrieved_at AS retrievedAt`;

async function detail(env: Env, id: string) {
  const [rows, evidenceRows, imageRows, historyRows] = await env.DB.batch([
    env.DB.prepare(
      `SELECT r.input_json, r.created_at AS createdAt, w.updated_at AS updatedAt, w.status, w.archived_at AS archivedAt,
         a.id AS runId, a.status AS runStatus, a.failure_code AS failureCode, a.provider, a.model,
         d.report_json AS reportJson, v.approved_result_json AS approvedJson, v.decision, v.notes, v.reviewer_id AS reviewerId, v.created_at AS reviewedAt
       FROM public_requests r JOIN public_request_workflow w ON w.request_id = r.id
       LEFT JOIN public_agent_runs a ON a.id = w.run_id
       LEFT JOIN public_assessment_drafts d ON d.run_id = a.id
       LEFT JOIN public_review_decisions v ON v.request_id = w.request_id AND v.run_id = w.run_id
       WHERE r.id = ?`,
    ).bind(id),
    env.DB.prepare(
      `SELECT ${evidenceColumns} FROM public_assessment_evidence
       WHERE run_id = (SELECT run_id FROM public_request_workflow WHERE request_id = ?)
       ORDER BY solution, source, kind, title, id`,
    ).bind(id),
    env.DB.prepare("SELECT id, solution FROM public_request_images WHERE request_id = ? ORDER BY solution").bind(id),
    env.DB.prepare(
      `SELECT id, status, actor, created_at AS createdAt FROM public_request_status_history
       WHERE request_id = ? ORDER BY id`,
    ).bind(id),
  ]);
  const row = rows.results[0] as {
    input_json: string; createdAt: string; updatedAt: string; status: PublicRequestStatus; archivedAt: string | null;
    runId: string | null; runStatus: NonNullable<AdminRequestDetail["run"]>["status"];
    failureCode: string | null; provider: string | null; model: string | null;
    reportJson: string | null; approvedJson: string | null; decision: ReviewDecision | null; notes: string; reviewerId: string; reviewedAt: string;
  } | undefined;
  if (!row) return error("NOT_FOUND", 404);
  const result: AdminRequestDetail = {
    id, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, archivedAt: row.archivedAt,
    input: publicInputSchema.parse(JSON.parse(row.input_json)),
    images: imageRows.results as AdminRequestDetail["images"],
    run: row.runId ? {
      id: row.runId, status: row.runStatus, failureCode: row.failureCode, provider: row.provider, model: row.model,
    } : null,

    report: row.reportJson ? JSON.parse(row.reportJson) as PreliminaryReport : null,
    evidence: evidenceRows.results as Evidence[],
    review: row.decision ? {
      decision: row.decision, reviewerId: row.reviewerId, notes: row.notes, createdAt: row.reviewedAt,
    } : null,
    approvedResult: row.approvedJson ? publicResultSchema.parse(JSON.parse(row.approvedJson)) : null,
    history: historyRows.results as AdminRequestDetail["history"],
    canRetry: !row.archivedAt && row.status === "Pending Review" && env.AGENT_ENABLED === "true" &&
      (row.runStatus === "failed" || (row.runStatus === "unconfigured" && Boolean(providerFor(env)))),
  };
  return json(result);
}

async function decide(request: Request, env: Env, requestId: string, reviewer: string) {
  const input = await readJson(request, 64 * 1024);
  if (input instanceof Response) return input;
  const parsed = reviewInputSchema.safeParse(input);
  if (!parsed.success) return error("INVALID_REVIEW", 400);
  const review = parsed.data;
  const createdAt = new Date().toISOString();
  let approvedResult: string | null = null;
  if (review.decision === "Approved") {
    const { evidenceIds, externalSources, attestation, ...authored } = review.result;
    if (!attestation) return error("INVALID_REVIEW", 400);
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.title, e.url FROM public_assessment_evidence e
       JOIN public_agent_runs a ON a.id = e.run_id WHERE a.request_id = ? AND e.run_id = ?`,
    ).bind(requestId, review.runId).all<{ id: string; title: string; url: string }>();
    const byId = new Map(results.map(({ id, title, url }) => [id, { title, url }]));
    const selected = evidenceIds.map((id) => byId.get(id));
    if (selected.some((source) => !source)) return error("INVALID_EVIDENCE", 400);
    if (authored.classification === "Compatible under documented conditions" && !externalSources.length) {
      return error("MIXTURE_EVIDENCE_REQUIRED", 400);
    }
    if (
      externalSources.some((source) => {
        try {
          return new URL(source.url).protocol !== "https:";
        } catch {
          return true;
        }
      })
    ) {
      return error("INVALID_REVIEW", 400);
    }
    const sources = [...new Map(
      [...selected.filter((source) => source !== undefined), ...externalSources].map((source) => [source.url, source]),
    ).values()];
    const validated = finalResultSchema.safeParse({
      ...authored, sources, reviewerId: reviewer, reviewedAt: createdAt, decision: "approved",
    });
    if (!validated.success) return error("INVALID_REVIEW", 400);
    approvedResult = JSON.stringify(validated.data);
  }

  const written = await env.DB.prepare(
    `INSERT INTO public_review_decisions (id, request_id, run_id, reviewer_id, decision, notes, approved_result_json, created_at)
     SELECT ?, request_id, run_id, ?, ?, ?, ?, ? FROM public_request_workflow
     WHERE request_id = ? AND status = 'Pending Review' AND run_id = ? AND archived_at IS NULL
     RETURNING decision`,
  ).bind(crypto.randomUUID(), reviewer, review.decision, review.notes, approvedResult, createdAt, requestId, review.runId)
    .first<{ decision: ReviewDecision }>();
  return written ? json({ status: written.decision }) : error("STALE_REVIEW", 409);
}

async function retry(request: Request, env: Env, id: string, reviewer: string) {
  const input = await readJson(request, 1024);
  if (input instanceof Response) return input;
  const parsed = retryInputSchema.safeParse(input);
  if (!parsed.success) return error("INVALID_REQUEST", 400);
  if (env.AGENT_ENABLED !== "true") return error("AGENT_DISABLED", 409);
  const row = await env.DB.prepare(
    `UPDATE public_request_workflow SET status = 'Submitted', updated_at = ?, actor = ?, run_id = NULL
     WHERE request_id = ? AND status = 'Pending Review' AND run_id = ? AND archived_at IS NULL AND EXISTS (
       SELECT 1 FROM public_agent_runs a WHERE a.id = run_id AND
       (a.status = 'failed' OR (a.status = 'unconfigured' AND ? = 1))
     ) RETURNING status`,
  ).bind(new Date().toISOString(), reviewer, id, parsed.data.runId, providerFor(env) ? 1 : 0).first();
  return row ? json(row) : error("STALE_REVIEW", 409);
}

async function image(env: Env, requestId: string, imageId: string) {
  if (!env.IMAGES) return error("SERVICE_UNAVAILABLE", 503);
  const metadata = await env.DB.prepare(
    "SELECT object_key, mime_type FROM public_request_images WHERE request_id = ? AND id = ?",
  ).bind(requestId, imageId).first<{ object_key: string; mime_type: string }>();
  if (!metadata) return error("NOT_FOUND", 404);
  const object = await env.IMAGES.get(metadata.object_key);
  if (!object) return error("NOT_FOUND", 404);
  return new Response(object.body as unknown as ReadableStream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": metadata.mime_type,
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export async function admin(request: Request, env: Env, reviewer: string) {
  const url = new URL(request.url);
  if (url.pathname === "/api/admin/requests" && request.method === "GET") return list(env, url);
  if (url.pathname === "/api/admin/requests/manage" && request.method === "POST") return manage(request, env, reviewer);
  const route = /^\/api\/admin\/requests\/([^/]+)(?:\/(.+))?$/.exec(url.pathname);
  if (!route || !publicRequestIdSchema.safeParse(route[1]).success) return error("NOT_FOUND", 404);
  const [, id, action] = route;
  if (!action && request.method === "GET") return detail(env, id);
  if (action === "decision" && request.method === "POST") return decide(request, env, id, reviewer);
  if (action === "retry" && request.method === "POST") return retry(request, env, id, reviewer);
  const imageId = /^images\/([^/]+)$/.exec(action ?? "")?.[1];
  if (imageId && request.method === "GET" && publicRequestIdSchema.safeParse(imageId).success) {
    return image(env, id, imageId);
  }
  return error("NOT_FOUND", 404);
}