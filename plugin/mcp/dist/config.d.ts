declare const LOCALES: readonly ["en", "lt", "de", "pl"];
declare const LOG_LEVELS: readonly ["silent", "error", "warn", "info", "debug"];
export type Locale = (typeof LOCALES)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type TripdremoConfig = {
    apiBaseUrl: string;
    siteUrl: string;
    locale: Locale;
    configDir: string;
    devUser: string | undefined;
    timeoutMs: number;
    submitTimeoutMs: number;
    logLevel: LogLevel;
};
export declare function loadConfig(env?: NodeJS.ProcessEnv): TripdremoConfig;
export {};
//# sourceMappingURL=config.d.ts.map