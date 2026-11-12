import assert from "node:assert/strict";
import test from "node:test";
import { projectPlan } from "../src/format/summary";
import { TripdremoError } from "../src/errors";

const rawPlan = {
  id: 42,
  share_hash: "ab12cd34",
  share_url: "https://tripdremo.com/en/plans/ab12cd34",
  title: "Dolomites",
  subtitle: "Slow mornings",
  destination: "Dolomites",
  dates: { start: "2026-07-04", end: "2026-07-06" },
  status: "ready",
  trip_payload: {
    data: {
      days: [
        {
          day: 1,
          title: "Bolzano to Ortisei",
          places: [{}, {}],
          drive: { from: "Bolzano", to: "Ortisei", estimate: "48 min drive", distance_km: 36 },
        },
        {
          day: 2,
          title: "Alpe di Siusi",
          places: [{}, {}, {}],
          drive: { from: "Ortisei", to: "Alpe di Siusi", distance_km: 18 },
        },
      ],
    },
  },
};

test("projects the real TripDetail day shape into the exact compact schema", () => {
  const result = projectPlan(rawPlan, false, "user");
  assert.deepEqual(result.days, [
    { index: 1, title: "Bolzano to Ortisei", stop_count: 2, drive_summary: "48 min drive" },
    { index: 2, title: "Alpe di Siusi", stop_count: 3, drive_summary: "Ortisei → Alpe di Siusi" },
  ]);
  assert.equal(result.day_count, 2);
  assert.equal(result.owner_kind, "user");
  assert.equal("plan_id" in result, false);
  assert.equal("status_detail" in result, false);
  assert.equal("trip_payload" in result, false);
});

test("includes the source payload only when explicitly requested", () => {
  assert.equal("trip_payload" in projectPlan(rawPlan), false);
  assert.equal("trip_payload" in projectPlan(rawPlan, true), true);
});

test("rejects incomplete or unknown 2xx plan payloads without echoing them", () => {
  const marker = "must-not-be-echoed";
  for (const malformed of [
    { ...rawPlan, status: "mystery", provider_payload: marker },
    { ...rawPlan, share_hash: "", provider_payload: marker },
    { ...rawPlan, share_url: "ftp://tripdremo.com/en/plans/ab12cd34", provider_payload: marker },
    { ...rawPlan, dates: { start: "2026-02-31", end: "2026-03-02" }, provider_payload: marker },
    { ...rawPlan, trip_payload: { data: { days: [{ day: 1, title: 42 }] } }, provider_payload: marker },
  ]) {
    assert.throws(() => projectPlan(malformed as never), (error: unknown) => {
      assert.ok(error instanceof TripdremoError);
      assert.equal(error.code, "internal");
      assert.equal(JSON.stringify(error.toJson()).includes(marker), false);
      return true;
    });
  }
});
