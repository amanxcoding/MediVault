import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  const response = NextResponse.json(data, { status, headers });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }
  // Database errors can contain table names, SQL details, or private identifiers.
  return json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } }, 500);
}

export async function readJson(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 64_000) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("missing body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 64_000) {
        await reader.cancel();
        throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

export async function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new HttpError(403, "ORIGIN_REJECTED", "Request origin is not allowed.");
}
