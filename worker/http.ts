export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function error(code: string, status: number, headers?: Record<string, string>) {
  return json({ error: code }, status, headers);
}

export async function readBytes(request: Request | Response, limit: number) {
  const length = request.headers.get("Content-Length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) return error("INVALID_CONTENT_LENGTH", 400);
    if (Number(length) > limit) return error("PAYLOAD_TOO_LARGE", 413);
  }
  if (!request.body) return error("INVALID_BODY", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        return error("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch {
    return error("INVALID_BODY", 400);
  } finally {
    reader.releaseLock();
  }
}

export function parseJson(bytes: Uint8Array) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
  } catch {
    return error("INVALID_JSON", 400);
  }
}

export function identityEncoding(request: Request) {
  const encoding = request.headers.get("Content-Encoding");
  return encoding === null || encoding.toLowerCase() === "identity";
}

export async function readJson(request: Request, limit: number) {
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(
      request.headers.get("Content-Type") ?? "",
    ) || !identityEncoding(request)
  ) return error("UNSUPPORTED_MEDIA_TYPE", 415);

  const bytes = await readBytes(request, limit);
  if (bytes instanceof Response) return bytes;
  const length = request.headers.get("Content-Length");
  if (length !== null && Number(length) !== bytes.byteLength) {
    return error("INVALID_CONTENT_LENGTH", 400);
  }
  return parseJson(bytes);
}

export function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
