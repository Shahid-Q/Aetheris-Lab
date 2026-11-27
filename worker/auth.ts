import type { D1Database, SubtleCrypto } from "@cloudflare/workers-types";
import { error, hex, json, readJson } from "./http";

export interface ReviewerAuthEnv {
  ADMIN_ORIGIN?: string;
  ADMIN_PROXY_SECRET?: string;
  ADMIN_PASSWORD?: string;
}

export const reviewerId = "password:admin";
const reviewer = { login: "admin" };
const sessionCookie = "__Host-aetheris-session";
const sessionSeconds = 8 * 60 * 60;
const loginWindowSeconds = 15 * 60;
const attemptsPerClient = 5;
const attemptsTotal = 30;
const tokenPattern = /^[a-f0-9]{64}$/;

export function adminConfig(env: ReviewerAuthEnv) {
  const origin = env.ADMIN_ORIGIN;
  const proxySecret = env.ADMIN_PROXY_SECRET;
  const password = env.ADMIN_PASSWORD;
  if (!origin || !proxySecret || !tokenPattern.test(proxySecret) || typeof password !== "string" || !password) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin) return null;
  } catch {
    return null;
  }
  return { origin, proxySecret, password };
}

type Config = NonNullable<ReturnType<typeof adminConfig>>;

function matchesToken(candidate: string, expected: string) {
  if (!tokenPattern.test(candidate) || !tokenPattern.test(expected)) return false;
  let diff = candidate.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) {
    diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function fromAdminProxy(request: Request, config: Config) {
  const origin = request.headers.get("Origin");
  return new URL(request.url).origin === config.origin &&
    (origin === config.origin || (request.method === "GET" && origin === null)) &&
    matchesToken(request.headers.get("X-Aetheris-Admin-Proxy") ?? "", config.proxySecret);
}

async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function tokenHash(token: string, config: Config) {
  // Only a per-session HMAC goes to D1. A changed password cannot look up old sessions.
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    // Frame the key so passwords differing by trailing NUL bytes cannot share an HMAC key.
    "raw", encoder.encode(JSON.stringify(config.password)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode("session:" + token))));
}

async function matchesPassword(candidate: string, expected: string) {
  const encoder = new TextEncoder();
  const subtle = crypto.subtle as SubtleCrypto;
  const [submitted, configured] = await Promise.all([
    subtle.digest("SHA-256", encoder.encode(candidate)),
    subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return subtle.timingSafeEqual(new Uint8Array(submitted), new Uint8Array(configured));
}

function csrfToken(token: string) {
  return sha256("csrf:" + token);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function readSessionCookie(request: Request) {
  const prefix = sessionCookie + "=";
  const values = (request.headers.get("Cookie") ?? "").split(";").map((value) => value.trim())
    .filter((value) => value.startsWith(prefix));
  const token = values.length === 1 ? values[0].slice(prefix.length) : "";
  return tokenPattern.test(token) ? token : null;
}

function cookie(token: string, maxAge: number) {
  return sessionCookie + "=" + token + "; Path=/; Max-Age=" + maxAge + "; Secure; HttpOnly; SameSite=Strict";
}

async function reserveLoginAttempt(request: Request, db: D1Database, config: Config) {
  // Pages overwrites this header before forwarding through the authenticated binding.
  const ip = request.headers.get("X-Aetheris-Admin-Client-IP") ?? "";
  const clientKey = await sha256("login:" + config.proxySecret + ":" + (/^[0-9a-f:.]{2,45}$/i.test(ip) ? ip : "unknown"));
  const now = nowSeconds();
  // D1 runs both statements in one transaction, so concurrent requests share the same limits.
  const [, attempt] = await db.batch<{ attempted_at: number }>([
    db.prepare("DELETE FROM admin_login_attempts WHERE attempted_at <= ?").bind(now - loginWindowSeconds),
    db.prepare(
      `INSERT INTO admin_login_attempts (client_key, attempted_at)
       SELECT ?, ? WHERE (SELECT count(*) FROM admin_login_attempts) < ?
       AND (SELECT count(*) FROM admin_login_attempts WHERE client_key = ?) < ?
       RETURNING attempted_at`,
    ).bind(clientKey, now, attemptsTotal, clientKey, attemptsPerClient),
  ]);
  return attempt.results.length === 1;
}

export function sessionInfo(token: string) {
  return { reviewer, csrfToken: token };
}

export async function reviewerLogin(request: Request, db: D1Database, config: Config) {
  if (request.method !== "POST") return error("METHOD_NOT_ALLOWED", 405, { Allow: "POST" });
  const input = await readJson(request, 1024);
  if (input instanceof Response) return input;
  if (!input || typeof input !== "object" || !("password" in input) ||
    Object.keys(input).length !== 1 || typeof input.password !== "string" ||
    input.password.length > 256) {
    return error("INVALID_REQUEST", 400);
  }
  if (!await reserveLoginAttempt(request, db, config)) {
    return error("RATE_LIMITED", 429, { "Retry-After": String(loginWindowSeconds) });
  }
  if (!await matchesPassword(input.password, config.password)) {
    return error("UNAUTHORIZED", 401);
  }

  const previous = readSessionCookie(request);
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = nowSeconds();
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ? OR token_sha256 = ?")
      .bind(now, previous === null ? null : await tokenHash(previous, config)),
    db.prepare("INSERT INTO admin_sessions (token_sha256, expires_at) VALUES (?, ?)")
      .bind(await tokenHash(token, config), now + sessionSeconds),
  ]);
  return json(sessionInfo(await csrfToken(token)), 200, { "Set-Cookie": cookie(token, sessionSeconds) });
}

export async function authenticateReviewer(request: Request, db: D1Database, config: Config) {
  const token = readSessionCookie(request);
  if (!token) return error("UNAUTHORIZED", 401);
  const key = await tokenHash(token, config);
  const session = await db.prepare("SELECT token_sha256 FROM admin_sessions WHERE token_sha256 = ? AND expires_at > ?")
    .bind(key, nowSeconds()).first();
  if (!session) return error("UNAUTHORIZED", 401);
  return { tokenHash: key, csrfToken: await csrfToken(token) };
}

export function hasCsrfToken(request: Request, expected: string) {
  return matchesToken(request.headers.get("X-CSRF-Token") ?? "", expected);
}

export async function logout(db: D1Database, tokenHash: string) {
  await db.prepare("DELETE FROM admin_sessions WHERE token_sha256 = ?").bind(tokenHash).run();
  return json({ signedOut: true }, 200, { "Set-Cookie": cookie("", 0) });
}