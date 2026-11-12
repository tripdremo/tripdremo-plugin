import { TripdremoError } from "../errors.js";
function driveSummary(day) {
    const estimate = day.drive?.estimate?.trim();
    if (estimate)
        return estimate;
    const from = day.drive?.from?.trim();
    const to = day.drive?.to?.trim();
    if (from && to)
        return `${from} → ${to}`;
    if (from || to)
        return from || to || "driving details unavailable";
    const distance = day.drive?.distance_km;
    if (typeof distance === "number" && Number.isFinite(distance))
        return `${distance} km drive`;
    return day.drive_summary?.trim() || "driving details unavailable";
}
function projectDay(day, fallbackIndex) {
    const index = Number.isInteger(day.day) && Number(day.day) > 0
        ? Number(day.day)
        : Number.isInteger(day.index) && Number(day.index) > 0
            ? Number(day.index)
            : fallbackIndex;
    return {
        index,
        title: day.title?.trim() || `Day ${index}`,
        stop_count: Array.isArray(day.places) ? day.places.length : Number(day.stop_count ?? 0),
        drive_summary: driveSummary(day),
    };
}
function malformed(field) {
    throw new TripdremoError("internal", "Tripdremo returned a malformed plan payload.", {
        details: { invalid_field: field },
    });
}
function requiredString(value, field, allowEmpty = true) {
    if (typeof value !== "string" || (!allowEmpty && value.trim() === ""))
        malformed(field);
    return value;
}
function requiredDate(value, field) {
    const date = requiredString(value, field, false);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date)
        malformed(field);
    return date;
}
function validateRawDay(day, index) {
    if (typeof day !== "object" || day === null || Array.isArray(day))
        malformed(`trip_payload.data.days[${index}]`);
    const raw = day;
    if (raw.day !== undefined && (!Number.isInteger(raw.day) || Number(raw.day) < 1))
        malformed(`trip_payload.data.days[${index}].day`);
    if (raw.index !== undefined && (!Number.isInteger(raw.index) || Number(raw.index) < 1))
        malformed(`trip_payload.data.days[${index}].index`);
    if (typeof raw.title !== "string")
        malformed(`trip_payload.data.days[${index}].title`);
    if (raw.places !== undefined && !Array.isArray(raw.places))
        malformed(`trip_payload.data.days[${index}].places`);
    if (raw.stop_count !== undefined && (!Number.isInteger(raw.stop_count) || raw.stop_count < 0))
        malformed(`trip_payload.data.days[${index}].stop_count`);
    if (raw.drive !== undefined && (typeof raw.drive !== "object" || raw.drive === null || Array.isArray(raw.drive)))
        malformed(`trip_payload.data.days[${index}].drive`);
    if (raw.drive) {
        for (const field of ["from", "to", "estimate"]) {
            if (raw.drive[field] !== undefined && typeof raw.drive[field] !== "string")
                malformed(`trip_payload.data.days[${index}].drive.${field}`);
        }
        if (raw.drive.distance_km !== undefined && (typeof raw.drive.distance_km !== "number" || !Number.isFinite(raw.drive.distance_km)))
            malformed(`trip_payload.data.days[${index}].drive.distance_km`);
    }
    if (raw.drive_summary !== undefined && typeof raw.drive_summary !== "string")
        malformed(`trip_payload.data.days[${index}].drive_summary`);
}
export function compactLineCount(days, max = 8) {
    return days
        .filter((day) => typeof day === "object" && day !== null)
        .slice(0, max)
        .map((day, index) => {
        const projected = projectDay(day, index + 1);
        return `Day ${projected.index}: ${projected.title} · ${projected.stop_count} stops · ${projected.drive_summary}`;
    });
}
export function projectPlan(raw, includePayload = false, ownerKind) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        malformed("plan");
    const shareHash = requiredString(raw.share_hash, "share_hash", false);
    const shareUrl = requiredString(raw.share_url, "share_url", false);
    try {
        const parsedShareUrl = new URL(shareUrl);
        if ((parsedShareUrl.protocol !== "http:" && parsedShareUrl.protocol !== "https:")
            || parsedShareUrl.username
            || parsedShareUrl.password
            || parsedShareUrl.search
            || parsedShareUrl.hash
            || !/^\/(en|lt|de|pl)\/plans\/[^/?#]+\/?$/.test(parsedShareUrl.pathname))
            malformed("share_url");
    }
    catch {
        malformed("share_url");
    }
    const title = requiredString(raw.title, "title");
    const subtitle = requiredString(raw.subtitle, "subtitle");
    const destination = requiredString(raw.destination, "destination");
    if (typeof raw.dates !== "object" || raw.dates === null || Array.isArray(raw.dates))
        malformed("dates");
    const start = requiredDate(raw.dates.start, "dates.start");
    const end = requiredDate(raw.dates.end, "dates.end");
    if (!(raw.status === "draft" || raw.status === "generating" || raw.status === "ready" || raw.status === "failed"))
        malformed("status");
    if (raw.trip_payload !== undefined && (typeof raw.trip_payload !== "object" || raw.trip_payload === null || Array.isArray(raw.trip_payload)))
        malformed("trip_payload");
    if (raw.trip_payload?.data !== undefined && (typeof raw.trip_payload.data !== "object" || raw.trip_payload.data === null || Array.isArray(raw.trip_payload.data)))
        malformed("trip_payload.data");
    const rawDays = raw.trip_payload?.data?.days;
    if (rawDays !== undefined && !Array.isArray(rawDays))
        malformed("trip_payload.data.days");
    const days = (rawDays ?? []).map((day, index) => {
        validateRawDay(day, index);
        return projectDay(day, index + 1);
    });
    const resolvedOwnerKind = ownerKind ?? raw.owner_kind ?? "guest";
    if (resolvedOwnerKind !== "guest" && resolvedOwnerKind !== "user")
        malformed("owner_kind");
    const projected = {
        share_hash: shareHash,
        share_url: shareUrl,
        title,
        subtitle,
        destination,
        dates: { start, end },
        day_count: days.length,
        status: raw.status,
        owner_kind: resolvedOwnerKind,
        days,
    };
    if (includePayload === true && raw.trip_payload) {
        projected.trip_payload = raw.trip_payload;
    }
    return projected;
}
//# sourceMappingURL=summary.js.map