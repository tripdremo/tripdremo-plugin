import { ApiClient } from "../api/client.js";
import { TripdremoError } from "../errors.js";
import { parseJsonSafely } from "./helpers.js";

export type PlanSchemaResult = {
  name: string;
  version: "trip-plan.v3";
  sha256: string;
  schema: Record<string, unknown>;
};

function malformed(field: string): never {
  throw new TripdremoError("internal", "Tripdremo returned a malformed plan schema response.", {
    details: { invalid_field: field },
  });
}

export async function getPlanSchema(client: ApiClient): Promise<PlanSchemaResult> {
  const raw = parseJsonSafely<Record<string, unknown>>(
    await client.requestAnonymous<unknown>("get", "/agent/schemas/trip-plan/v3/"),
  );
  const expectedKeys = ["name", "schema", "sha256", "version"];
  if (Object.keys(raw).sort().join("\0") !== expectedKeys.join("\0")) malformed("response");
  if (typeof raw.name !== "string" || raw.name.trim() === "") malformed("name");
  if (raw.version !== "trip-plan.v3") malformed("version");
  if (typeof raw.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(raw.sha256)) malformed("sha256");
  if (typeof raw.schema !== "object" || raw.schema === null || Array.isArray(raw.schema)) malformed("schema");
  return {
    name: raw.name,
    version: raw.version,
    sha256: raw.sha256.toLowerCase(),
    schema: raw.schema as Record<string, unknown>,
  };
}
