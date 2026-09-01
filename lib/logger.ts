const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  scope: string;
  message: string;
  details?: Record<string, unknown>;
}

function write(level: LogLevel, context: LogContext) {
  if (!isDev && level !== "error") {
    return;
  }

  const payload = context.details ? { ...context.details } : undefined;
  const line = `[${context.scope}] ${context.message}`;

  switch (level) {
    case "debug":
      console.debug(line, payload ?? "");
      break;
    case "info":
      console.info(line, payload ?? "");
      break;
    case "warn":
      console.warn(line, payload ?? "");
      break;
    case "error":
      console.error(line, payload ?? "");
      break;
  }
}

export const logger = {
  debug: (context: LogContext) => write("debug", context),
  info: (context: LogContext) => write("info", context),
  warn: (context: LogContext) => write("warn", context),
  error: (context: LogContext) => write("error", context),
};
