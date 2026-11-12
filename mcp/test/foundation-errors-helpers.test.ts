import assert from "node:assert/strict";
import test from "node:test";
import { ERROR_CODES, TripdremoError, isTripdremoError } from "../src/errors";
import { parseJsonSafely, redactSensitive, withRedactedToken } from "../src/tools/helpers";

test("foundation errors serialize the exact closed contract", () => {
  for (const code of ERROR_CODES) {
    const payload = new TripdremoError(code, "Message", { incidentId: "inc-fixed" }).toJson();
    assert.deepEqual(Object.keys(payload), ["error"]);
    assert.deepEqual(Object.keys(payload.error), ["code", "message", "retryable", "details"]);
    assert.equal("short_id" in payload.error, false);
    assert.equal(payload.error.code, code);
    if (code === "internal") assert.equal(payload.error.details.incident_id, "inc-fixed");
    else assert.equal("incident_id" in payload.error.details, false);
  }
});

test("foundation error guard rejects name-only impostors", () => {
  assert.equal(isTripdremoError({ name: "TripdremoError" }), false);
  assert.equal(isTripdremoError(new TripdremoError("internal", "broken")), true);
});

test("foundation redaction removes tokens and sensitive headers recursively", () => {
  const sampleToken = ["cli", "super", "secret", "abcd"].join("_");
  const bearer = ["Bearer", sampleToken].join(" ");
  const redacted = redactSensitive({
    token: sampleToken,
    headers: { Authorization: bearer, Cookie: "session=secret" },
    message: `failed for ${bearer}`,
  });
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes("super_secret"), false);
  assert.match(serialized, /\[REDACTED\]/);
  assert.equal(withRedactedToken(sampleToken), "cli_…abcd");
});

test("foundation malformed payload errors do not echo the payload", () => {
  const sampleToken = ["cli", "super", "secret", "abcd"].join("_");
  assert.throws(() => parseJsonSafely(sampleToken), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(JSON.stringify(error.toJson()).includes("super_secret"), false);
    return true;
  });
});
