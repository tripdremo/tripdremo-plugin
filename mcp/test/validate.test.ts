import test from "node:test";
import assert from "node:assert/strict";
import { validateDateRange } from "../src/tools/validate";
import { TripdremoError } from "../src/errors";

test("reject invalid date spans", () => {
  assert.throws(() => validateDateRange("2026-09-20", "2026-09-10"), TripdremoError);
});

test("reject span over 45 days", () => {
  assert.throws(() => validateDateRange("2026-09-01", "2026-10-20"), TripdremoError);
});
