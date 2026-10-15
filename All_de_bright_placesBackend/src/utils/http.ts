// Applies shared request bounds, CSRF checks, and sanitized API errors.
import "server-only";
import { z } from "zod";

export class HttpError extends Error {
  /** Creates an intentionally public error with a controlled status. */
  constructor(public status: number, message: string) { super(message); }
}
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

/** Checks browser origin before any state-changing operation. */
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.SITE_URL) allowed.add(new URL(process.env.SITE_URL).origin);
  if (!origin || !allowed.has(origin)) throw new HttpError(403, "This request is not allowed.");
}

/** Reads a bounded JSON stream and validates its complete payload. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(400, "Send JSON content.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing request content.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > 32_768) { await reader.cancel(); throw new HttpError(413, "Request content is too large."); }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    if (!parsed.success) throw new HttpError(400, "Please check the supplied values.");
    return parsed.data;
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Invalid request content."); }
}

/** Maps database errors without exposing SQL, account data, or provider messages. */
export function databaseError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "P0001") {
    if (error.message === "CONFLICT") throw new HttpError(409, "This entry changed. Reload it before saving.");
    if (error.message === "PROFILE_BUSY") throw new HttpError(409, "A picture change is still in progress. Try again shortly.");
    if (error.message === "NOT_FOUND") throw new HttpError(404, "Entry not found.");
    if (["TRASHED", "PHOTO_LIMIT", "INVALID_ACTION", "INVALID_DIRECTION", "INVALID_PARTICIPANT", "INVALID_PARTICIPANTS"].includes(error.message || "")) throw new HttpError(400, "Please check the supplied values.");
  }
  if (error.code === "40001" || error.code === "P0002" && error.message === "revision_conflict") throw new HttpError(409, "This entry changed. Reload it before saving.");
  if (error.code === "P0002") throw new HttpError(404, "Entry not found.");
  if (error.code === "42501") throw new HttpError(403, "This request is not allowed.");
  if (["22023", "23514", "23503"].includes(error.code || "")) throw new HttpError(400, "Please check the supplied values.");
  throw new HttpError(503, "The journal is temporarily unavailable.");
}

/** Runs an API operation and returns a sanitized, uncached response on failure. */
export async function api(operation: () => Promise<Response>): Promise<Response> {
  try { return await operation(); } catch (error) {
    const known = error instanceof HttpError ? error : new HttpError(503, "The journal is temporarily unavailable.");
    return Response.json({ error: known.message }, { status: known.status, headers: PRIVATE_HEADERS });
  }
}

/** Emits JSON that may contain personal journal content and must never be cached. */
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: PRIVATE_HEADERS }); }

/** Validates route identifiers before using them in database or storage queries. */
export function identifier(value: string) { if (!z.uuid().safeParse(value).success) throw new HttpError(400, "Invalid entry identifier."); return value; }

/** Bounds multipart upload bytes even when Content-Length is missing or dishonest. */
export async function readUpload(request: Request, limit: number): Promise<FormData> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) throw new HttpError(413, "Choose a photograph smaller than 3 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing photograph upload.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const result = await reader.read(); if (result.done) break;
    size += result.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, "Choose a photograph smaller than 3 MB."); }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData(); }
  catch { throw new HttpError(400, "Invalid photograph upload."); }
}
