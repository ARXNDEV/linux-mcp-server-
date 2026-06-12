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
const currentLevel: LogLevel = (process.env['CONTAINER_MCP_LOG_LEVEL'] as LogLevel) || 'info';

/**
 * Write a structured log entry to stderr.
 * @param level - The log level
 * @param message - The log message
 * @param data - Optional structured data to include
 */
function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
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
