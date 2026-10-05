type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const secrets = new Set<string>();
let minLevel: Level = "info";

/** Values registered here are replaced with *** in every log line. */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 4) secrets.add(value);
}

export function setLogLevel(level: Level): void {
  minLevel = level;
}

function redact(s: string): string {
  let out = s;
  for (const secret of secrets) out = out.split(secret).join("***");
  return out;
}

function serialize(v: unknown): unknown {
  if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
  return v;
}

function write(level: Level, scope: string, msg: string, data?: Record<string, unknown>): void {
  if (order[level] < order[minLevel]) return;
  const entry: Record<string, unknown> = { t: new Date().toISOString(), level, scope, msg };
  if (data) for (const [k, v] of Object.entries(data)) entry[k] = serialize(v);
  const line = redact(JSON.stringify(entry));
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, d) => write("debug", scope, m, d),
    info: (m, d) => write("info", scope, m, d),
    warn: (m, d) => write("warn", scope, m, d),
    error: (m, d) => write("error", scope, m, d),
  };
}
