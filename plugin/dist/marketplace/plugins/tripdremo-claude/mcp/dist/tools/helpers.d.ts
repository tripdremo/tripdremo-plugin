import { ERROR_CODES } from "../errors.js";
export declare function resolveShareUrl(relativeSharePath: string): string;
export declare function withRedactedToken(token: string): string;
export declare function redactSensitive(value: unknown): unknown;
export declare function parseJsonSafely<T>(value: unknown): T;
export declare function assertLocale(value: unknown): asserts value is "en" | "lt" | "de" | "pl";
export declare function isTripdremoErrorCode(value: unknown): value is (typeof ERROR_CODES)[number];
//# sourceMappingURL=helpers.d.ts.map