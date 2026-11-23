import type { PublicRequestStatus } from "../../src/domain";
import type { AdminManageAction, AdminRequestDetail, AdminRequestList } from "../../src/review";

const root = "/api/admin/requests";
export const sessionQueryKey = ["reviewer-session"] as const;

interface ReviewerSession {
  reviewer: { login: string };
  csrfToken: string;
}

export class AdminError extends Error {
  constructor(public readonly status: number) {
    super("Review request failed");
  }
}

async function adminRequest<T>(path: string, signal?: AbortSignal, body?: unknown, csrfToken?: string): Promise<T> {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new AdminError(response.status);
  if (response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    // Static-only Pages deployments can serve index.html on API URLs.
    throw new AdminError(404);
  }
  return response.json() as Promise<T>;
}

export async function adminSession(signal: AbortSignal): Promise<ReviewerSession | null> {
  try {
    return await adminRequest<ReviewerSession>("/api/admin/session", signal);
  } catch (error) {
    if (error instanceof AdminError && [401, 403].includes(error.status)) return null;
    throw error;
  }
}

export function adminSignIn(password: string) {
  return adminRequest<ReviewerSession>("/api/admin/auth/login", undefined, { password });
}

export async function adminSignOut(csrfToken: string) {
  try {
    await adminRequest("/api/admin/auth/logout", undefined, {}, csrfToken);
  } catch (error) {
    if (!(error instanceof AdminError) || error.status !== 401) throw error;
  }
}

export function adminList(status: PublicRequestStatus | "", archived: boolean, after: string | null, signal: AbortSignal) {
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (archived) query.set("archived", "true");
  if (after) query.set("after", after);
  return adminRequest<AdminRequestList>(root + "?" + query.toString(), signal);
}

export function adminManage(action: AdminManageAction, ids: string[], csrfToken: string) {
  return adminRequest<{ changed: number }>(root + "/manage", undefined, { action, ids }, csrfToken);
}

export function adminDetail(id: string, signal: AbortSignal) {
  return adminRequest<AdminRequestDetail>(root + "/" + id, signal);
}

export function adminAction(id: string, action: "decision" | "retry", body: unknown, csrfToken: string) {
  return adminRequest<{ status: PublicRequestStatus }>(root + "/" + id + "/" + action, undefined, body, csrfToken);
}

export function adminImage(id: string, imageId: string) {
  return root + "/" + id + "/images/" + imageId;
}
