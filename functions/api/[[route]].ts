interface Context {
  request: Request;
  env: { AETHERIS_API?: { fetch(request: Request): Promise<Response> } };
}

function error(code: string, status: number) {
  return Response.json(
    { error: code },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function onRequest({ request, env }: Context) {
  const { origin, pathname } = new URL(request.url);
  if (
    pathname !== "/api/health" &&
    !/^\/api\/requests(?:\/[^/]+)?$/.test(pathname)
  ) {
    return error("NOT_FOUND", 404);
  }

  const caller = request.headers.get("Origin");
  if (caller !== null && caller !== origin) return error("FORBIDDEN", 403);
  if (!env.AETHERIS_API) return error("SERVICE_UNAVAILABLE", 503);

  try {
    return await env.AETHERIS_API.fetch(request);
  } catch {
    return error("SERVICE_UNAVAILABLE", 503);
  }
}
