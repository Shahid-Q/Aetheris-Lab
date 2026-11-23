import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { publicRequestMaxBytes, validateImage } from "../src/domain";
import type { SolutionSide } from "../src/review";
import { error, identityEncoding, parseJson, readBytes, readJson } from "./http";

type Image = { solution: SolutionSide; file: File };
const imageMaxBytes = 10 * 1024 * 1024;
const multipartMaxBytes = 2 * imageMaxBytes + publicRequestMaxBytes + 8192;

function dimensions(width: number, height: number) {
  return width > 0 && height > 0 && width * height <= 100_000_000;
}

async function jpegDimensions(file: File) {
  const prefix = await file.slice(0, 256 * 1024).arrayBuffer();
  const bytes = new Uint8Array(prefix);
  const data = new DataView(prefix);
  let offset = 2;
  const frameMarkers = [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207];
  while (offset + 4 < bytes.length && bytes[offset] === 255) {
    while (bytes[offset] === 255) offset++;
    if (offset + 3 >= bytes.length || bytes[offset] === 218) return false;
    const marker = bytes[offset++];
    const size = data.getUint16(offset);
    if (size < 2 || offset + size > bytes.length) return false;
    if (frameMarkers.includes(marker)) {
      return size >= 8 && dimensions(data.getUint16(offset + 5), data.getUint16(offset + 3));
    }
    offset += size;
  }
  return false;
}

async function validImage(file: File) {
  if (validateImage(file)) return false;
  const signature = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const data = new DataView(signature.buffer);
  const matches = (bytes: number[], at = 0) => bytes.every((byte, i) => signature[at + i] === byte);
  switch (file.type) {
    case "image/png": {
      if (file.size < 45 || !matches([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
        || !dimensions(data.getUint32(16), data.getUint32(20))) return false;
      const footer = new Uint8Array(await file.slice(-12).arrayBuffer());
      return [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130].every((byte, i) => footer[i] === byte);
    }
    case "image/jpeg": {
      if (!matches([255, 216, 255])) return false;
      const trailer = new Uint8Array(await file.slice(-2).arrayBuffer());
      return trailer[0] === 255 && trailer[1] === 217 && await jpegDimensions(file);
    }
    case "image/webp": {
      if (signature.length < 30 || !matches([82, 73, 70, 70]) || !matches([87, 69, 66, 80, 86, 80, 56], 8)
        || data.getUint32(4, true) + 8 !== file.size || data.getUint32(16, true) + 20 > file.size) return false;
      switch (signature[15]) {
        case 32:
          return matches([157, 1, 42], 23)
            && dimensions(data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff);
        case 76: {
          const bits = data.getUint32(21, true);
          return signature[20] === 47 && dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
        }
        case 88:
          return dimensions((data.getUint32(24, true) & 0xffffff) + 1,
            (data.getUint32(26, true) >>> 8) + 1);
        default:
          return false;
      }
    }
    default:
      return false;
  }
}

export async function readSubmission(request: Request) {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    const input = await readJson(request, publicRequestMaxBytes);
    return input instanceof Response ? input : { input, images: [] as Image[] };
  }
  if (!identityEncoding(request)) return error("UNSUPPORTED_MEDIA_TYPE", 415);
  const bytes = await readBytes(request, multipartMaxBytes);
  if (bytes instanceof Response) return bytes;
  const length = request.headers.get("Content-Length");
  if (length !== null && Number(length) !== bytes.byteLength) return error("INVALID_CONTENT_LENGTH", 400);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    return error("INVALID_BODY", 400);
  }
  const fields = form.getAll("input");
  if (fields.length !== 1 || typeof fields[0] !== "string"
    || [...form.keys()].some((key) => !["input", "imageA", "imageB"].includes(key))) {
    return error("INVALID_REQUEST", 400);
  }
  const inputBytes = new TextEncoder().encode(fields[0]);
  if (inputBytes.byteLength > publicRequestMaxBytes) return error("PAYLOAD_TOO_LARGE", 413);
  const input = parseJson(inputBytes);
  if (input instanceof Response) return input;
  const images: Image[] = [];
  for (const solution of ["A", "B"] as const) {
    const values = form.getAll("image" + solution);
    if (!values.length) continue;
    const file = values[0];
    if (values.length !== 1 || typeof file === "string" || !(await validImage(file))) {
      return error("INVALID_IMAGE", 400);
    }
    images.push({ solution, file });
  }
  return { input, images };
}

export async function storeImages(bucket: R2Bucket, requestId: string, images: Image[]) {
  const stored = [];
  try {
    for (const { solution, file } of images) {
      const id = crypto.randomUUID();
      const objectKey = "public-requests/" + requestId + "/" + id;
      stored.push({ id, solution, objectKey, mimeType: file.type, size: file.size });
      await bucket.put(objectKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    }
    return stored;
  } catch (cause) {
    await Promise.allSettled(stored.map(({ objectKey }) => bucket.delete(objectKey)));
    throw cause;
  }
}

export async function deleteQueuedImages(db: D1Database, bucket: R2Bucket) {
  if (!bucket) return;
  const { results } = await db.prepare(
    "SELECT object_key AS key FROM public_request_image_deletions ORDER BY queued_at, object_key LIMIT 50",
  ).all<{ key: string }>();
  const keys = results.map(({ key }) => key);
  if (!keys.length) return;
  try {
    await bucket.delete(keys);
  } catch {
    // Leave keys queued for the next scheduled invocation.
    return;
  }
  await db.prepare(
    "DELETE FROM public_request_image_deletions WHERE object_key IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(keys)).run();
}
