// Structured logs. On Cloud Run each line is JSON with a `severity` field,
// which Cloud Logging reads directly. Client contact details and secrets are
// masked so they never end up in logs.

export type LogLevel = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SEVERITY: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
};

const SENSITIVE_KEY =
  /phone|mobile|email|token|secret|password|authorization|cookie|api_?key|database_?url/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Fields = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

export function createLogger(
  base: Fields = {},
  minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info",
  write: (line: string) => void = (line) => process.stdout.write(line + "\n"),
): Logger {
  const log = (level: LogLevel, message: string, fields?: Fields) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const entry = {
      severity: SEVERITY[level],
      time: new Date().toISOString(),
      message,
      ...(redact({ ...base, ...fields }) as Fields),
    };
    write(JSON.stringify(entry));
  };
  return {
    debug: (m, f) => log("debug", m, f),
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }, minLevel, write),
  };
}

export const logger = createLogger({ service: "web" });
