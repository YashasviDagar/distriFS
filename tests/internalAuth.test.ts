import { describe, expect, it } from "vitest";
import { signInternalRequest, verifyInternalRequest } from "@distrifs/shared";

describe("internal HMAC auth", () => {
  const secret = "unit-test-secret";

  it("accepts a freshly signed request", () => {
    const headers = signInternalRequest(secret, "PUT", "/chunks/abc");
    expect(verifyInternalRequest(secret, "PUT", "/chunks/abc", headers)).toBe(true);
  });

  it("ignores the query string when verifying", () => {
    const headers = signInternalRequest(secret, "GET", "/chunks/abc");
    expect(verifyInternalRequest(secret, "GET", "/chunks/abc?x=1", headers)).toBe(true);
  });

  it("rejects a different secret, method or path", () => {
    const headers = signInternalRequest(secret, "GET", "/chunks/abc");
    expect(verifyInternalRequest("other", "GET", "/chunks/abc", headers)).toBe(false);
    expect(verifyInternalRequest(secret, "DELETE", "/chunks/abc", headers)).toBe(false);
    expect(verifyInternalRequest(secret, "GET", "/chunks/xyz", headers)).toBe(false);
  });

  it("rejects missing headers and expired timestamps", () => {
    expect(verifyInternalRequest(secret, "GET", "/x", {})).toBe(false);
    const old = signInternalRequest(secret, "GET", "/x", Date.now() - 5 * 60_000);
    expect(verifyInternalRequest(secret, "GET", "/x", old)).toBe(false);
  });

  it("rejects malformed signatures", () => {
    const headers = signInternalRequest(secret, "GET", "/x");
    headers["x-internal-signature"] = "zz";
    expect(verifyInternalRequest(secret, "GET", "/x", headers)).toBe(false);
  });
});
