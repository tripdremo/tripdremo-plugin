import test from "node:test";
import assert from "node:assert/strict";
import { TripdremoError } from "../src/errors";

test("error contract supports every v1 code", () => {
  const codes = [
    "not_authenticated",
    "login_pending",
    "login_expired",
    "quota_exceeded",
    "invalid_request",
    "generation_failed",
    "generation_timeout",
    "backend_ai_disabled",
    "plan_not_found",
    "rate_limited",
    "backend_unreachable",
    "internal",
  ];
  for (const code of codes) {
    const err = new TripdremoError(code, `${code} message`, { retryable: false });
    const payload = err.toJson();
    assert.equal(payload.error.code, code);
    assert.equal(payload.error.retryable, false);
  }
});
