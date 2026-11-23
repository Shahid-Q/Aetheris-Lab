interface Context {
  request: Request;
  env: {
    AETHERIS_API?: { fetch(request: Request): Promise<Response> };
    ADMIN_ORIGIN?: string;
    ADMIN_PROXY_SECRET?: string;
  };
}

function error(code: string, status: number) {
  return Response.json({ error: code }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function onRequest({ request, env }: Context) {
  const { origin, pathname } = new URL(request.url);
  if (pathname !== "/api/admin" && !pathname.startsWith("/api/admin/")) {
    return error("NOT_FOUND", 404);
  }
  const { AETHERIS_API, ADMIN_ORIGIN, ADMIN_PROXY_SECRET } = env;
  if (!AETHERIS_API || !ADMIN_ORIGIN?.startsWith("https://") ||
    !ADMIN_PROXY_SECRET || !/^[a-f0-9]{64}$/.test(ADMIN_PROXY_SECRET)) return error("SERVICE_UNAVAILABLE", 503);

  const caller = request.headers.get("Origin");
  if (origin !== ADMIN_ORIGIN || (caller !== null && caller !== ADMIN_ORIGIN) ||
    (request.method !== "GET" && caller !== ADMIN_ORIGIN)) return error("FORBIDDEN", 403);

  const headers = new Headers(request.headers);
  headers.set("X-Aetheris-Admin-Proxy", ADMIN_PROXY_SECRET);
  headers.set("X-Aetheris-Admin-Client-IP", request.headers.get("CF-Connecting-IP") ?? "");
  try {
    return await AETHERIS_API.fetch(new Request(request, { headers, redirect: "manual" }));
  } catch {
    return error("SERVICE_UNAVAILABLE", 503);
  }
}
