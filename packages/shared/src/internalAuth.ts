import { createHmac, timingSafeEqual } from "node:crypto";

export const INTERNAL_TIMESTAMP_HEADER = "x-internal-timestamp";
export const INTERNAL_SIGNATURE_HEADER = "x-internal-signature";
export const INTERNAL_MAX_SKEW_MS = 60_000;

function pathOnly(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function sign(secret: string, timestamp: string, method: string, url: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${method.toUpperCase()}.${pathOnly(url)}`)
    .digest("hex");
}

export function signInternalRequest(
  secret: string,
  method: string,
  url: string,
  now: number = Date.now(),
): Record<string, string> {
  const timestamp = String(now);
  return {
    [INTERNAL_TIMESTAMP_HEADER]: timestamp,
    [INTERNAL_SIGNATURE_HEADER]: sign(secret, timestamp, method, url),
  };
}

export function verifyInternalRequest(
  secret: string,
  method: string,
  url: string,
  headers: Record<string, string | string[] | undefined>,
  now: number = Date.now(),
): boolean {
  const timestamp = headers[INTERNAL_TIMESTAMP_HEADER];
  const signature = headers[INTERNAL_SIGNATURE_HEADER];
  if (typeof timestamp !== "string" || typeof signature !== "string") return false;

  const issuedAt = Number(timestamp);
  if (!Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > INTERNAL_MAX_SKEW_MS) return false;

  const expected = Buffer.from(sign(secret, timestamp, method, url), "hex");
  const provided = Buffer.from(signature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
