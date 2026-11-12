import crypto from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const MAX_DEVICE_BYTES = 4 * 1024;
const MAX_PENDING_REVOCATION_BYTES = 64 * 1024;
const MAX_PENDING_SUBMISSION_BYTES = 4 * 1024;
const MAX_PLANS_BYTES = 128 * 1024;
const FILE_PERMS = 0o600;
const CONFIG_DIR_PERMS = 0o700;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
// Ambiguous writes may be resumed for one day; older state is deleted rather
// than risking an indefinitely stale replay.
export const PENDING_SUBMISSION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
function paths(configDir = loadConfig().configDir) {
    return {
        base: configDir,
        credentials: path.join(configDir, "credentials.json"),
        device: path.join(configDir, "device.json"),
        pendingRevocation: path.join(configDir, "pending-revocation.json"),
        pendingSubmission: path.join(configDir, "pending-submission.json"),
        plans: path.join(configDir, "plans.json"),
    };
}
function ensureNotSymlink(filePath) {
    if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) {
        throw new Error(`Refusing to use symlink path: ${filePath}`);
    }
}
function ensureBaseDirectory(base) {
    ensureNotSymlink(base);
    mkdirSync(base, { recursive: true, mode: CONFIG_DIR_PERMS });
    const stats = lstatSync(base);
    if (!stats.isDirectory())
        throw new Error(`Config path is not a directory: ${base}`);
    chmodSync(base, CONFIG_DIR_PERMS);
}
function writeAtomically(filePath, data) {
    ensureBaseDirectory(path.dirname(filePath));
    ensureNotSymlink(filePath);
    const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
        writeFileSync(tmpPath, data, { encoding: "utf8", mode: FILE_PERMS, flag: "wx" });
        chmodSync(tmpPath, FILE_PERMS);
        renameSync(tmpPath, filePath);
        chmodSync(filePath, FILE_PERMS);
    }
    catch (error) {
        try {
            if (existsSync(tmpPath))
                unlinkSync(tmpPath);
        }
        catch {
            // Preserve the original error.
        }
        throw error;
    }
}
function safeReadJson(filePath, maxBytes) {
    ensureNotSymlink(filePath);
    if (!existsSync(filePath))
        throw new Error("file missing");
    const stats = lstatSync(filePath);
    if (!stats.isFile())
        throw new Error("invalid config file");
    if (stats.size > maxBytes)
        throw new Error("config file too large");
    chmodSync(filePath, FILE_PERMS);
    const text = readFileSync(filePath, "utf8");
    if (Buffer.byteLength(text, "utf8") > maxBytes)
        throw new Error("config payload too large");
    return text;
}
export function redactedToken(token) {
    if (!token)
        return "none";
    const clean = token.trim();
    if (clean.length <= 4)
        return `${clean.slice(0, 3)}…`;
    const prefix = clean.startsWith("cli_") ? "cli_" : clean.slice(0, 4);
    return `${prefix}…${clean.slice(-4)}`;
}
export function ensureDeviceId() {
    const { device } = paths();
    if (existsSync(device)) {
        const text = safeReadJson(device, MAX_DEVICE_BYTES);
        try {
            const parsed = JSON.parse(text);
            if (typeof parsed.deviceId === "string" && UUID_PATTERN.test(parsed.deviceId))
                return parsed.deviceId;
        }
        catch {
            // A malformed non-secret identity file is safely replaced below.
        }
    }
    const deviceId = crypto.randomUUID();
    writeAtomically(device, JSON.stringify({ deviceId }, null, 2));
    return deviceId;
}
export function readCredential() {
    const deviceId = ensureDeviceId();
    try {
        const parsed = JSON.parse(safeReadJson(paths().credentials, MAX_CREDENTIAL_BYTES));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
            throw new Error("corrupt credential");
        if (parsed.token !== undefined && typeof parsed.token !== "string")
            throw new Error("corrupt credential");
        if (parsed.planType !== undefined && parsed.planType !== "guest" && parsed.planType !== "user")
            throw new Error("corrupt credential");
        return { ...parsed, deviceId };
    }
    catch {
        return { deviceId };
    }
}
export function writeCredential(payload) {
    const previous = readCredential();
    const { deviceId: _ignoredDeviceId, ...previousCredential } = previous;
    const { deviceId: _ignoredPayloadDeviceId, ...credentialPayload } = payload;
    const next = {
        ...previousCredential,
        ...credentialPayload,
        createdAt: credentialPayload.createdAt ?? previousCredential.createdAt ?? new Date().toISOString(),
    };
    if (previousCredential.token !== next.token) {
        deletePendingSubmission();
    }
    writeAtomically(paths().credentials, JSON.stringify(next, null, 2));
}
export function deleteCredential() {
    const { credentials } = paths();
    ensureNotSymlink(credentials);
    if (existsSync(credentials))
        unlinkSync(credentials);
    deletePendingSubmission();
}
export function currentSubmissionIdentityHash() {
    const config = loadConfig();
    if (config.devUser)
        return crypto.createHash("sha256").update(`dev:${config.devUser}`).digest("hex");
    const credential = readCredential();
    const identity = credential.token
        ? `credential:${credential.token}`
        : `device:${credential.deviceId}:none`;
    return crypto.createHash("sha256").update(identity).digest("hex");
}
export function writePendingSubmission(pending) {
    writeAtomically(paths().pendingSubmission, JSON.stringify(pending, null, 2));
}
export function readPendingSubmission(identityHash, nowMs = Date.now()) {
    try {
        const parsed = JSON.parse(safeReadJson(paths().pendingSubmission, MAX_PENDING_SUBMISSION_BYTES));
        const keys = Object.keys(parsed).sort();
        if (keys.join("\0") !== ["created_at", "identity_hash", "payload_hash", "submission_id"].join("\0")) {
            throw new Error("invalid pending submission fields");
        }
        if (typeof parsed.submission_id !== "string" || !UUID_PATTERN.test(parsed.submission_id))
            throw new Error("invalid submission id");
        if (typeof parsed.payload_hash !== "string" || !SHA256_PATTERN.test(parsed.payload_hash))
            throw new Error("invalid payload hash");
        if (typeof parsed.identity_hash !== "string" || !SHA256_PATTERN.test(parsed.identity_hash))
            throw new Error("invalid identity hash");
        if (typeof parsed.created_at !== "string")
            throw new Error("invalid created timestamp");
        const createdAtMs = Date.parse(parsed.created_at);
        if (!Number.isFinite(createdAtMs) || createdAtMs > nowMs || nowMs - createdAtMs > PENDING_SUBMISSION_MAX_AGE_MS) {
            deletePendingSubmission();
            return undefined;
        }
        if (parsed.identity_hash !== identityHash) {
            deletePendingSubmission();
            return undefined;
        }
        return parsed;
    }
    catch {
        try {
            deletePendingSubmission();
        }
        catch {
            // A hostile path remains unusable and will be rejected on the next write.
        }
        return undefined;
    }
}
export function deletePendingSubmission() {
    const { pendingSubmission } = paths();
    ensureNotSymlink(pendingSubmission);
    if (existsSync(pendingSubmission))
        unlinkSync(pendingSubmission);
}
export function writePendingRevocation(token) {
    writeAtomically(paths().pendingRevocation, JSON.stringify({ token }, null, 2));
}
export function readPendingRevocation() {
    try {
        const parsed = JSON.parse(safeReadJson(paths().pendingRevocation, MAX_PENDING_REVOCATION_BYTES));
        return typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : undefined;
    }
    catch {
        return undefined;
    }
}
export function deletePendingRevocation() {
    const { pendingRevocation } = paths();
    ensureNotSymlink(pendingRevocation);
    if (existsSync(pendingRevocation))
        unlinkSync(pendingRevocation);
}
export function readDeviceHeaders() {
    return { "X-Tripdremo-Device-Id": ensureDeviceId() };
}
export async function hasToken() {
    return Boolean(readCredential().token);
}
export function getToken() {
    return readCredential().token;
}
export function setToken(token, kind = "guest") {
    writeCredential({ token, planType: kind, createdAt: new Date().toISOString() });
}
export function setAuthMeta(meta) {
    writeCredential(meta);
}
export async function readPlans() {
    return readPlansSync();
}
export function writePlans(plans) {
    writeAtomically(paths().plans, JSON.stringify(plans.slice(0, 50), null, 2));
}
export function appendPlan(plan) {
    const existing = readPlansSync();
    const next = existing.filter((entry) => entry.share_hash !== plan.share_hash);
    next.unshift({
        share_hash: plan.share_hash,
        title: plan.title || "(untitled)",
        created_at: new Date().toISOString(),
    });
    writePlans(next);
}
function readPlansSync() {
    try {
        const parsed = JSON.parse(safeReadJson(paths().plans, MAX_PLANS_BYTES));
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=store.js.map