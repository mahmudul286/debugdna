/**
 * Thin structured logger — emits newline-delimited JSON to stdout/stderr.
 * Every call appends a `timestamp` field automatically as log metadata.
 */

export type LogRecord = Record<string, unknown>;

function emit(level: "info" | "error", data: LogRecord): void {
  const record = { level, timestamp: new Date().toISOString(), ...data };
  const line = JSON.stringify(record);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  info(data: LogRecord): void {
    emit("info", data);
  },
  error(data: LogRecord): void {
    emit("error", data);
  },
};
