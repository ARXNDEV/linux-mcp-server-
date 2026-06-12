/**
 * Structured logger for the container-mcp server.
 * Outputs JSON logs to stderr to keep stdout clean for MCP protocol messages.
 * @module utils/logger
 */

/** Log level type. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Numeric priority for log levels. */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Current minimum log level (configurable via CONTAINER_MCP_LOG_LEVEL env var). */
const VALID_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const rawLevel = process.env['CONTAINER_MCP_LOG_LEVEL'];
const currentLevel: LogLevel =
  rawLevel && (VALID_LEVELS as string[]).includes(rawLevel)
    ? (rawLevel as LogLevel)
    : 'info';

/**
 * Write a structured log entry to stderr.
 * @param level - The log level
 * @param message - The log message
 * @param data - Optional structured data to include
 */
function sanitize(val: unknown): unknown {
  // eslint-disable-next-line no-control-regex
  if (typeof val === 'string') return val.replace(/[\r\n\t]/g, ' ').replace(/[\x00-\x1f]/g, '');
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, sanitize(v)])
    );
  }
  return val;
}

function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if ((LOG_LEVELS[level] ?? 0) < (LOG_LEVELS[currentLevel] ?? 1)) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: sanitize(message) as string,
    ...(data ? (sanitize(data) as Record<string, unknown>) : {}),
  };

  process.stderr.write(JSON.stringify(entry) + '\n');
}

/**
 * Logger instance with methods for each log level.
 * All output goes to stderr to avoid interfering with MCP protocol on stdout.
 */
export const logger = {
  /** Log a debug message. */
  debug: (message: string, data?: Record<string, unknown>) => log('debug', message, data),
  /** Log an info message. */
  info: (message: string, data?: Record<string, unknown>) => log('info', message, data),
  /** Log a warning message. */
  warn: (message: string, data?: Record<string, unknown>) => log('warn', message, data),
  /** Log an error message. */
  error: (message: string, data?: Record<string, unknown>) => log('error', message, data),
};
