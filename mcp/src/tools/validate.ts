import { TripdremoError } from "../errors.js";

const STYLES = ["relaxed", "balanced", "active", "camper", "luxury"] as const;
const BUDGETS = ["value", "comfortable", "premium"] as const;
const PLAN_KEYS = new Set([
  "prompt", "origin", "destination", "start_date", "end_date", "adults", "children", "style", "budget", "constraints", "wait_seconds",
]);

export type PlanPayload = {
  prompt: string;
  origin?: string;
  destination?: string;
  start_date: string;
  end_date: string;
  adults?: number;
  children?: { age: number }[];
  style?: (typeof STYLES)[number];
  budget?: (typeof BUDGETS)[number];
  constraints?: Record<string, unknown>;
  wait_seconds?: number;
};

function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new TripdremoError("invalid_request", message, { details });
}

function parseIsoDate(field: string, value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid(`${field} must be YYYY-MM-DD`, { field });
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    return invalid(`${field} must be a valid calendar date`, { field });
  }
  return timestamp;
}

export function validateDateRange(startDate: string, endDate: string): void {
  const start = parseIsoDate("start_date", startDate);
  const end = parseIsoDate("end_date", endDate);
  if (end < start) invalid("end_date must be on or after start_date", { field: "end_date" });
  if ((end - start) / 86_400_000 > 45) invalid("Trip date difference must be 45 days or less", { field: "end_date" });
}

export function normalizeChildren(children: unknown): { age: number }[] {
  if (children === undefined) return [];
  if (!Array.isArray(children)) invalid("children must be an array", { field: "children" });
  if (children.length > 12) invalid("children may contain at most 12 travellers", { field: "children" });
  return children.map((child, index) => {
    if (typeof child !== "object" || child === null || Array.isArray(child)) {
      return invalid("Each child must be an object with an age", { field: `children.${index}` });
    }
    const keys = Object.keys(child);
    if (keys.length !== 1 || keys[0] !== "age") return invalid("Each child may contain only age", { field: `children.${index}` });
    const age = (child as { age?: unknown }).age;
    if (!Number.isInteger(age) || (age as number) < 0 || (age as number) > 17) {
      return invalid("child age must be an integer 0..17", { field: `children.${index}.age` });
    }
    return { age: age as number };
  });
}

function optionalString(payload: Record<string, unknown>, field: "origin" | "destination"): void {
  const value = payload[field];
  if (value !== undefined && (typeof value !== "string" || value.length > 255)) {
    invalid(`${field} must be a string of at most 255 characters`, { field });
  }
}

export function validatePromptPayload(payload: PlanPayload): void {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) invalid("request must be an object");
  const record = payload as unknown as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !PLAN_KEYS.has(key));
  if (unknown.length > 0) invalid("Request contains unknown fields", { fields: unknown });
  if (typeof record.prompt !== "string" || record.prompt.length < 1) invalid("prompt is required", { field: "prompt" });
  if (record.prompt.length > 4000) invalid("prompt exceeds max 4000 characters", { field: "prompt" });
  optionalString(record, "origin");
  optionalString(record, "destination");
  validateDateRange(record.start_date as string, record.end_date as string);
  if (record.adults !== undefined && (!Number.isInteger(record.adults) || (record.adults as number) < 1 || (record.adults as number) > 12)) {
    invalid("adults must be an integer 1..12", { field: "adults" });
  }
  normalizeChildren(record.children);
  if (record.style !== undefined && !STYLES.includes(record.style as (typeof STYLES)[number])) {
    invalid(`style must be one of: ${STYLES.join(", ")}`, { field: "style" });
  }
  if (record.budget !== undefined && !BUDGETS.includes(record.budget as (typeof BUDGETS)[number])) {
    invalid(`budget must be one of: ${BUDGETS.join(", ")}`, { field: "budget" });
  }
  if (record.constraints !== undefined && (typeof record.constraints !== "object" || record.constraints === null || Array.isArray(record.constraints))) {
    invalid("constraints must be an object", { field: "constraints" });
  }
  if (record.wait_seconds !== undefined && (!Number.isInteger(record.wait_seconds) || (record.wait_seconds as number) < 0 || (record.wait_seconds as number) > 120)) {
    invalid("wait_seconds must be an integer 0..120", { field: "wait_seconds" });
  }
}
