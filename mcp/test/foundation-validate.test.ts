import assert from "node:assert/strict";
import test from "node:test";
import { TripdremoError } from "../src/errors";
import { normalizeChildren, validateDateRange, validatePromptPayload } from "../src/tools/validate";

const valid = {
  prompt: "Plan Vilnius",
  start_date: "2026-09-01",
  end_date: "2026-10-16",
  adults: 2,
  children: [{ age: 0 }, { age: 17 }],
  style: "balanced" as const,
  budget: "comfortable" as const,
  constraints: {},
};

test("foundation date validation matches Django's greater-than-45-days rule", () => {
  assert.doesNotThrow(() => validateDateRange("2026-09-01", "2026-10-16"));
  assert.throws(() => validateDateRange("2026-09-01", "2026-10-17"), TripdremoError);
  assert.throws(() => validateDateRange("2026-02-30", "2026-03-01"), TripdremoError);
  assert.throws(() => validateDateRange("2026-09-02", "2026-09-01"), TripdremoError);
});

test("foundation children accept only strict serializer objects with ages 0 through 17", () => {
  assert.deepEqual(normalizeChildren([{ age: 0 }, { age: 17 }]), [{ age: 0 }, { age: 17 }]);
  assert.throws(() => normalizeChildren([{ age: 18 }]), TripdremoError);
  assert.throws(() => normalizeChildren([{ age: "6" }]), TripdremoError);
  assert.throws(() => normalizeChildren([{ age: 6, name: "secret" }]), TripdremoError);
  assert.doesNotThrow(() => normalizeChildren(Array.from({ length: 12 }, () => ({ age: 6 }))));
  assert.throws(() => normalizeChildren(Array.from({ length: 13 }, () => ({ age: 6 }))), TripdremoError);
});

test("foundation payload validation rejects unknown fields and invalid enums", () => {
  assert.doesNotThrow(() => validatePromptPayload(valid));
  assert.throws(() => validatePromptPayload({ ...valid, style: "fast" } as never), TripdremoError);
  assert.throws(() => validatePromptPayload({ ...valid, budget: "cheap" } as never), TripdremoError);
  assert.throws(() => validatePromptPayload({ ...valid, surprise: true } as never), TripdremoError);
  assert.throws(() => validatePromptPayload({ ...valid, origin: 123 } as never), TripdremoError);
});
