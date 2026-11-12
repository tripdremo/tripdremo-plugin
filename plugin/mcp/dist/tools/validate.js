import { TripdremoError } from "../errors.js";
const STYLES = ["relaxed", "balanced", "active", "camper", "luxury"];
const BUDGETS = ["value", "comfortable", "premium"];
const PLAN_KEYS = new Set([
    "prompt", "origin", "destination", "start_date", "end_date", "adults", "children", "style", "budget", "constraints", "wait_seconds",
]);
function invalid(message, details = {}) {
    throw new TripdremoError("invalid_request", message, { details });
}
function parseIsoDate(field, value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return invalid(`${field} must be YYYY-MM-DD`, { field });
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
        return invalid(`${field} must be a valid calendar date`, { field });
    }
    return timestamp;
}
export function validateDateRange(startDate, endDate) {
    const start = parseIsoDate("start_date", startDate);
    const end = parseIsoDate("end_date", endDate);
    if (end < start)
        invalid("end_date must be on or after start_date", { field: "end_date" });
    if ((end - start) / 86_400_000 > 45)
        invalid("Trip date difference must be 45 days or less", { field: "end_date" });
}
export function normalizeChildren(children) {
    if (children === undefined)
        return [];
    if (!Array.isArray(children))
        invalid("children must be an array", { field: "children" });
    if (children.length > 12)
        invalid("children may contain at most 12 travellers", { field: "children" });
    return children.map((child, index) => {
        if (typeof child !== "object" || child === null || Array.isArray(child)) {
            return invalid("Each child must be an object with an age", { field: `children.${index}` });
        }
        const keys = Object.keys(child);
        if (keys.length !== 1 || keys[0] !== "age")
            return invalid("Each child may contain only age", { field: `children.${index}` });
        const age = child.age;
        if (!Number.isInteger(age) || age < 0 || age > 17) {
            return invalid("child age must be an integer 0..17", { field: `children.${index}.age` });
        }
        return { age: age };
    });
}
function optionalString(payload, field) {
    const value = payload[field];
    if (value !== undefined && (typeof value !== "string" || value.length > 255)) {
        invalid(`${field} must be a string of at most 255 characters`, { field });
    }
}
export function validatePromptPayload(payload) {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload))
        invalid("request must be an object");
    const record = payload;
    const unknown = Object.keys(record).filter((key) => !PLAN_KEYS.has(key));
    if (unknown.length > 0)
        invalid("Request contains unknown fields", { fields: unknown });
    if (typeof record.prompt !== "string" || record.prompt.length < 1)
        invalid("prompt is required", { field: "prompt" });
    if (record.prompt.length > 4000)
        invalid("prompt exceeds max 4000 characters", { field: "prompt" });
    optionalString(record, "origin");
    optionalString(record, "destination");
    validateDateRange(record.start_date, record.end_date);
    if (record.adults !== undefined && (!Number.isInteger(record.adults) || record.adults < 1 || record.adults > 12)) {
        invalid("adults must be an integer 1..12", { field: "adults" });
    }
    normalizeChildren(record.children);
    if (record.style !== undefined && !STYLES.includes(record.style)) {
        invalid(`style must be one of: ${STYLES.join(", ")}`, { field: "style" });
    }
    if (record.budget !== undefined && !BUDGETS.includes(record.budget)) {
        invalid(`budget must be one of: ${BUDGETS.join(", ")}`, { field: "budget" });
    }
    if (record.constraints !== undefined && (typeof record.constraints !== "object" || record.constraints === null || Array.isArray(record.constraints))) {
        invalid("constraints must be an object", { field: "constraints" });
    }
    if (record.wait_seconds !== undefined && (!Number.isInteger(record.wait_seconds) || record.wait_seconds < 0 || record.wait_seconds > 120)) {
        invalid("wait_seconds must be an integer 0..120", { field: "wait_seconds" });
    }
}
//# sourceMappingURL=validate.js.map