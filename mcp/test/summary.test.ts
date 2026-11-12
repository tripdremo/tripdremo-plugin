import test from "node:test";
import assert from "node:assert/strict";
import { compactLineCount, projectPlan } from "../src/format/summary";

test("compact lines stay bounded", () => {
  const lines = compactLineCount(
    Array.from({ length: 20 }).map((_, index) => ({
      index: index + 1,
      title: `Day ${index + 1}`,
      stop_count: 2,
      drive_summary: "2h drive",
    })),
  );
  assert.equal(lines.length, 8);
});

test("projectPlan hides trip payload unless requested", () => {
  const projected = projectPlan(
    {
      share_hash: "abc123",
      share_url: "https://tripdremo.com/en/plans/abc123",
      title: "Demo",
      subtitle: "Demo trip",
      destination: "Demo",
      dates: { start: "2026-09-01", end: "2026-09-05" },
      status: "ready",
      id: 1,
      trip_payload: { data: { days: [{ title: "Day 1", places: [1, 2], drive_summary: "walk" }] } },
    },
    false,
  ) as {
    trip_payload?: unknown;
  };
  assert.equal(projected.trip_payload === undefined, true);
});
