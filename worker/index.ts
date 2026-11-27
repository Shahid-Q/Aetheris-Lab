import type { D1Database, R2Bucket, ScheduledController } from "@cloudflare/workers-types";
import {
  publicInputSchema, publicReceiptSchema, publicRequestIdSchema, publicRequestPath,
  publicResultSchema, type PublicRequestStatus,
} from "../src/domain";
import { admin } from "./admin";
import { processNextRequest } from "./orchestrator";
import { providerFor, type AIConfig } from "./ai";
import {
  adminConfig, authenticateReviewer, fromAdminProxy, hasCsrfToken, logout, reviewerId, reviewerLogin, sessionInfo,
  type ReviewerAuthEnv,
} from "./auth";
import { error, hex, json } from "./http";
import { deleteQueuedImages, readSubmission, storeImages } from "./images";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env extends ReviewerAuthEnv, AIConfig {
  DB: D1Database;
  SUBMISSION_LIMIT: RateLimiter;
  TRACKING_LIMIT: RateLimiter;
  IMAGES: R2Bucket;
  AGENT_ENABLED?: string;
  PUBLIC_ORIGINS?: string;
}

const unavailable = { error: "INTEGRATION_UNAVAILABLE" };

async function health(env: Env) {
  let ready = false;
  if (env.DB && env.SUBMISSION_LIMIT && env.TRACKING_LIMIT) {
    try {
      await env.DB.prepare(
        `SELECT r.id, r.input_json, r.created_at, w.status, w.updated_at, t.token_sha256, v.approved_result_json
         FROM public_requests r JOIN public_request_tokens t ON t.request_id = r.id
         JOIN public_request_workflow w ON w.request_id = r.id
         LEFT JOIN public_review_decisions v ON v.request_id = r.id LIMIT 0`,
      ).all();
      ready = true;
    } catch {
      // Keep ready as false when schema or bindings are unavailable
    }
  }
  const enabled = ready && env.AGENT_ENABLED === "true";
  return json({
    mode: ready ? "public-assessment" : "integration-unavailable",
    submission: ready,
    tracking: ready,
    identification: enabled,
    review: ready && Boolean(adminConfig(env)),
    agent: !enabled ? "disabled" : providerFor(env) ? "configured" : "unconfigured",
  }, ready ? 200 : 503);
}

async function withinLimit(request: Request, limiter: RateLimiter) {
  // Cloudflare provides this header on direct ingress. Treat missing IPs as a shared bucket
  const key = request.headers.get("CF-Connecting-IP") || "unknown-client";
  const { success } = await limiter.limit({ key });
  return success;
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return hex(new Uint8Array(digest));
}

async function submit(request: Request, env: Env) {
  const submission = await readSubmission(request);
  if (submission instanceof Response) return submission;
  const parsed = publicInputSchema.safeParse(submission.input);
  if (!parsed.success) return error("INVALID_REQUEST", 400);
  if (submission.images.length && !env.IMAGES) return error("SERVICE_UNAVAILABLE", 503);

  const id = crypto.randomUUID();
  const trackingToken = hex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await hashToken(trackingToken);
  const createdAt = new Date().toISOString();
  const images = submission.images.length ? await storeImages(env.IMAGES, id, submission.images) : [];

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO public_requests (id, input_json, status, created_at, updated_at)
         VALUES (?, ?, 'Submitted', ?, ?)`,
      ).bind(id, JSON.stringify(parsed.data), createdAt, createdAt),
      env.DB.prepare(
        "INSERT INTO public_request_tokens (request_id, token_sha256) VALUES (?, ?)",
      ).bind(id, tokenHash),
      ...images.map(({ id: imageId, solution, objectKey, mimeType, size }) => env.DB.prepare(
        `INSERT INTO public_request_images (id, request_id, solution, object_key, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(imageId, id, solution, objectKey, mimeType, size)),
    ]);
  } catch (cause) {
    if (images.length) {
      // Resolve an ambiguous D1 failure on the primary before deleting any objects
      try {
        const receipt = await env.DB.withSession("first-primary").prepare("SELECT id FROM public_requests WHERE id = ?")
          .bind(id).first();
        if (!receipt) await Promise.allSettled(images.map(({ objectKey }) => env.IMAGES.delete(objectKey)));
      } catch {
        // Keep inaccessible objects if the database could not confirm the outcome
      }
    }
    throw cause;
  }

  return json(
    { id, status: "Submitted", createdAt, updatedAt: createdAt, trackingToken },
    201,
    { Location: `${publicRequestPath}/${id}` },
  );
}

async function track(request: Request, env: Env, id: string) {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = /^Bearer ([a-f0-9]{64})$/i.exec(authorization)?.[1];
  if (!token || !publicRequestIdSchema.safeParse(id).success) return error("NOT_FOUND", 404);
  const row = await env.DB.prepare(
    `SELECT r.id, r.created_at AS createdAt, w.updated_at AS updatedAt, w.status,
       v.approved_result_json AS resultJson
     FROM public_requests r JOIN public_request_tokens t ON t.request_id = r.id
     JOIN public_request_workflow w ON w.request_id = r.id
     LEFT JOIN public_review_decisions v ON w.status = 'Approved' AND v.decision = 'Approved'
       AND v.request_id = w.request_id AND v.run_id = w.run_id
     WHERE r.id = ? AND t.token_sha256 = ?`,
  ).bind(id, await hashToken(token)).first<{
    id: string; createdAt: string; updatedAt: string; status: PublicRequestStatus; resultJson: string | null;
  }>();
  if (!row) return error("NOT_FOUND", 404);

  const { resultJson, ...receipt } = row;
  let response: Record<string, unknown> = receipt;
  if (row.status === "Approved") {
    try {
      const parsedResult = publicResultSchema.safeParse(JSON.parse(resultJson ?? "null"));
      if (!parsedResult.success) return error("SERVICE_UNAVAILABLE", 503);
      response = { ...receipt, result: parsedResult.data };
    } catch {
      return error("SERVICE_UNAVAILABLE", 503);
    }
  }
  const validated = publicReceiptSchema.safeParse(response);
  if (!validated.success) return error("SERVICE_UNAVAILABLE", 503);
  return json(validated.data);
}

async function reviewApi(request: Request, env: Env, pathname: string) {
  const config = adminConfig(env);
  if (!config || !env.DB) return error("SERVICE_UNAVAILABLE", 503);
  if (!fromAdminProxy(request, config)) return error("FORBIDDEN", 403);
  if (pathname === "/api/admin/auth/login") return reviewerLogin(request, env.DB, config);
  if (pathname.startsWith("/api/admin/auth/") && pathname !== "/api/admin/auth/logout") return error("NOT_FOUND", 404);
  const reviewer = await authenticateReviewer(request, env.DB, config);
  if (reviewer instanceof Response) return reviewer;
  if (request.method !== "GET" && !hasCsrfToken(request, reviewer.csrfToken)) return error("FORBIDDEN", 403);
  if (pathname === "/api/admin/session" && request.method === "GET") return json(sessionInfo(reviewer.csrfToken));
  if (pathname === "/api/admin/auth/logout" && request.method === "POST") return logout(env.DB, reviewer.tokenHash);
  return admin(request, env, reviewerId);
}

function isLocalDevOrigin(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

function allowedPublicOrigin(origin: string, env: Env) {
  const configured = env.PUBLIC_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  try {
    const url = new URL(origin);
    if (url.origin !== origin) return false;
    if (isLocalDevOrigin(url)) return true;
    return url.protocol === "https:" && configured.includes(origin);
  } catch {
    return false;
  }
}

async function publicApi(request: Request, env: Env, trackingId: string | undefined, isHealth: boolean) {
  const source = request.headers.get("Origin");
  const crossOrigin = source !== null && source !== new URL(request.url).origin ? source : null;
  if (crossOrigin !== null && !allowedPublicOrigin(crossOrigin, env)) return error("FORBIDDEN", 403);

  const isSubmission = !isHealth && trackingId === undefined;
  const method = isSubmission ? "POST" : "GET";
  const allowedHeader = isHealth ? "" : isSubmission ? "content-type" : "authorization";
  const cors = crossOrigin ? {
    "Access-Control-Allow-Origin": crossOrigin,
    "Access-Control-Expose-Headers": "Location, Retry-After",
    "Vary": "Origin",
  } : undefined;

  if (cors && request.method === "OPTIONS") {
    const headers = (request.headers.get("Access-Control-Request-Headers") ?? "").toLowerCase()
      .split(",").map((header) => header.trim()).filter(Boolean);
    if (request.headers.get("Access-Control-Request-Method") !== method ||
      headers.some((header) => header !== allowedHeader)) return error("FORBIDDEN", 403);
    const responseHeaders = new Headers({
      ...cors,
      "Access-Control-Allow-Methods": method,
      "Cache-Control": "no-store",
      "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    });
    if (allowedHeader) responseHeaders.set("Access-Control-Allow-Headers", allowedHeader);
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  let response: Response;
  if (request.method !== method) response = error("METHOD_NOT_ALLOWED", 405, { Allow: method });
  else if (isHealth) response = await health(env);
  else {
    const limiter = isSubmission ? env.SUBMISSION_LIMIT : env.TRACKING_LIMIT;
    try {
      if (!env.DB || !limiter) response = error("SERVICE_UNAVAILABLE", 503);
      else if (!await withinLimit(request, limiter)) {
        response = error("RATE_LIMITED", 429, { "Retry-After": "60" });
      } else {
        response = trackingId === undefined ? await submit(request, env) : await track(request, env, trackingId);
      }
    } catch {
      response = error("SERVICE_UNAVAILABLE", 503);
    }
  }

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");

  if (cors) for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
  return response;
}

function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    let response: Response;

    if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
      try {
        response = await reviewApi(request, env, pathname);
      } catch {
        response = error("SERVICE_UNAVAILABLE", 503);
      }
    } else {
      const trackingId = /^\/api\/requests\/([^/]+)$/.exec(pathname)?.[1];
      const isHealth = pathname === "/api/health";

      if (isHealth || pathname === publicRequestPath || trackingId !== undefined) {
        response = await publicApi(request, env, trackingId, isHealth);
      } else if (pathname.startsWith("/api/")) {
        response = json(unavailable, 503);
      } else {
        response = error("NOT_FOUND", 404);
      }
    }

    return secureResponse(response);
  },

  async scheduled(_controller: ScheduledController, env: Env) {
    await Promise.allSettled([
      processNextRequest(env),
      deleteQueuedImages(env.DB, env.IMAGES),
    ]);
  },
};