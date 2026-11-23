import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import { onRequest as adminApi } from "../admin/functions/api/admin/[[route]]";

function call(request: Request, fetch?: typeof globalThis.fetch) {
  return onRequest({ request, env: { AETHERIS_API: fetch && { fetch } } });
}

describe("public Pages API", () => {
  it("forwards the incoming request and returns the Worker's metadata and headers", async () => {
    const request = new Request(
      "https://aetheris-lab.pages.dev/api/requests/test",
      {
        headers: {
          Authorization: "Bearer test",
          "CF-Connecting-IP": "192.0.2.1",
        },
      },
    );
    const response = new Response(null, {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
    const fetch = vi.fn().mockResolvedValue(response);
    expect(await call(request, fetch)).toBe(response);
    expect(fetch).toHaveBeenCalledWith(request);
  });

  it("excludes unknown endpoints and rejects cross-origin preflights", async () => {
    const fetch = vi.fn();
    for (const path of ["/api/admin", "/api/admin/session", "/api/admin/auth/login", "/api/unknown"]) {
      const internal = await call(new Request("https://aetheris-lab.pages.dev" + path, {
        headers: { Cookie: "__Host-aetheris-session=test", "X-Aetheris-Admin-Proxy": "caller-supplied" },
      }), fetch);
      expect(internal.status).toBe(404);
    }
    const preflight = await call(
      new Request("https://aetheris-lab.pages.dev/api/requests", {
        method: "OPTIONS",
        headers: {
          Origin: "https://other.example",
          "Access-Control-Request-Method": "POST",
        },
      }),
      fetch,
    );
    expect(preflight.status).toBe(403);
    expect(preflight.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });


  it("returns a non-cacheable 503 when the Worker binding is missing or fails", async () => {
    const request = new Request("https://aetheris-lab.pages.dev/api/health");
    for (const fetch of [
      undefined,
      vi.fn().mockRejectedValue(new Error("private details")),
    ]) {
      const response = await call(request, fetch);
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
    }
  });
});

describe("admin Pages API", () => {
  const adminOrigin = "https://aetheris-admin.pages.dev";
  const proxySecret = "a".repeat(64);
  const settings = { ADMIN_ORIGIN: adminOrigin, ADMIN_PROXY_SECRET: proxySecret };

  function callAdmin(request: Request, fetch?: typeof globalThis.fetch, env = settings) {
    return adminApi({ request, env: { ...env, AETHERIS_API: fetch && { fetch } } });
  }

  it("forwards the same-origin password request with trusted proxy headers and returns the session cookie", async () => {
    const request = new Request(adminOrigin + "/api/admin/auth/login", {
      method: "POST",
      headers: {
        Origin: adminOrigin,
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.23",
        "X-Aetheris-Admin-Client-IP": "192.0.2.99",
        "X-Aetheris-Admin-Proxy": "caller-supplied",
      },
      body: JSON.stringify({ password: "test-only" }),
    });
    const sessionCookie = "__Host-aetheris-session=test; Path=/; Secure; HttpOnly; SameSite=Strict";
    const signedIn = Response.json({ reviewer: { login: "admin" }, csrfToken: "test-csrf" }, {
      headers: { "Set-Cookie": sessionCookie, "Cache-Control": "no-store" },
    });
    const fetch = vi.fn().mockResolvedValue(signedIn);

    const response = await callAdmin(request, fetch);
    expect(response).toBe(signedIn);
    expect(response.headers.getSetCookie()).toEqual([sessionCookie]);
    expect(response.headers.has("X-Aetheris-Admin-Proxy")).toBe(false);
    expect(response.headers.has("X-Aetheris-Admin-Client-IP")).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    const forwarded = fetch.mock.calls[0][0] as Request;
    expect(forwarded.url).toBe(request.url);
    expect(forwarded.redirect).toBe("manual");
    expect(forwarded.headers.get("X-Aetheris-Admin-Proxy")).toBe(proxySecret);
    expect(forwarded.headers.get("X-Aetheris-Admin-Client-IP")).toBe("192.0.2.23");
    expect(await forwarded.json()).toEqual({ password: "test-only" });
  });

  it("blocks public endpoints, preview hosts, foreign origins and unsafe methods without an origin", async () => {
    const fetch = vi.fn();
    const endpoint = "/api/admin/session";
    const preview = "https://preview.aetheris-admin.pages.dev";
    expect((await callAdmin(new Request(adminOrigin + "/api/requests"), fetch)).status).toBe(404);
    for (const request of [
      new Request(preview + endpoint),
      new Request(adminOrigin + endpoint, { headers: { Origin: preview } }),
      new Request(adminOrigin + endpoint, { method: "OPTIONS", headers: { Origin: preview } }),
      new Request(adminOrigin + "/api/admin/auth/logout", { method: "POST" }),
    ]) {
      const response = await callAdmin(request, fetch);
      expect(response.status).toBe(403);
      expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards a same-origin mutation and fails closed if the proxy configuration or binding is missing", async () => {
    const endpoint = adminOrigin + "/api/admin/requests/fixture/retry";
    const request = new Request(endpoint, {
      method: "POST",
      headers: {
        Origin: adminOrigin,
        "Content-Type": "application/json",
        Cookie: "__Host-aetheris-session=test",
        "X-CSRF-Token": "test-csrf",
        "X-Aetheris-Admin-Client-IP": "192.0.2.99",
      },
      body: JSON.stringify({ runId: "fixture" }),
    });
    const fetch = vi.fn().mockResolvedValue(Response.json({ retried: true }));
    const invalidSettings = { ...settings, ADMIN_PROXY_SECRET: "" };
    for (const unavailable of [await callAdmin(request), await callAdmin(request, fetch, invalidSettings)]) {
      expect(unavailable.status).toBe(503);
      expect(unavailable.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(fetch).not.toHaveBeenCalled();
    expect((await callAdmin(request, fetch)).status).toBe(200);
    const forwarded = fetch.mock.calls[0][0] as Request;
    expect(forwarded.headers.get("Origin")).toBe(adminOrigin);
    expect(forwarded.headers.get("Cookie")).toBe("__Host-aetheris-session=test");
    expect(forwarded.headers.get("X-CSRF-Token")).toBe("test-csrf");
    expect(forwarded.headers.get("X-Aetheris-Admin-Client-IP")).toBe("");
    expect(await forwarded.json()).toEqual({ runId: "fixture" });
  });
});
