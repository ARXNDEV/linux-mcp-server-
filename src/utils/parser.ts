/**
 * Output parsers for container CLI responses.
 * Handles JSON parsing, table parsing, and value formatting.
 * @module utils/parser
 */

/**
 * Safely parse a JSON string, returning a default value on failure.
 *
 * @param input - The string to parse as JSON
 * @param defaultValue - Default value if parsing fails (default: null)
 * @returns Parsed JSON value or the default
 */
export function safeJsonParse<T>(input: string, defaultValue: T | null = null): T | null {
  try {
    return JSON.parse(input) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Parse a table-formatted CLI output into an array of objects.
 * Assumes the first line is a header row with column names separated by whitespace.
 *
 * @param input - Raw table output string
 * @returns Array of objects with keys from the header row
 *
 * @example
 * ```typescript
 * const data = parseTableOutput("NAME  STATUS  IMAGE\nweb   running nginx");
 * // [{ name: "web", status: "running", image: "nginx" }]
 * ```
 */
export function parseTableOutput(input: string): Array<Record<string, string>> {
  const lines = input.trim().split('\n').filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return [];
  }

  const headerLine = lines[0]!;
  const headers = extractColumnPositions(headerLine);

  return lines.slice(1).map((line) => {
    const record: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i]!;
      const start = header.start;
      const end = i < headers.length - 1 ? headers[i + 1]!.start : line.length;
      record[header.name.toLowerCase()] = line.substring(start, end).trim();
    }
    return record;
  });
}

/**
 * Extract column positions from a header line.
 * Uses whitespace boundaries to determine column boundaries.
 */
function extractColumnPositions(headerLine: string): Array<{ name: string; start: number }> {
  const columns: Array<{ name: string; start: number }> = [];
  // Split on 2+ consecutive spaces to find column boundaries
  const regex = /\S.*?(?=\s{2,}|$)/g;
  let match;
  while ((match = regex.exec(headerLine)) !== null) {
    columns.push({ name: match[0].trim(), start: match.index });
  }
  return columns;
}


/**
 * Validate a container or image name against OCI naming conventions.
 * Allows alphanumeric characters, hyphens, underscores, dots, slashes, and colons.
 *
 * @param name - The name to validate
 * @returns true if the name is valid
 */
export function isValidOciName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 255) return false;
  // OCI names: alphanumeric, hyphens, underscores, dots, slashes, colons for tags
  return /^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]*$/.test(name);
}

/**
 * Validate a port mapping string (e.g., "8080:80", "8080:80/tcp").
 *
 * @param mapping - The port mapping string
 * @returns true if the mapping is valid
 */
export function isValidPortMapping(mapping: string): boolean {
  return /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:)?\d+:\d+(\/(?:tcp|udp))?$/.test(mapping);
}

/**
 * Validate an environment variable string (e.g., "KEY=value").
 *
 * @param envVar - The environment variable string
 * @returns true if the format is valid
 */
export function isValidEnvVar(envVar: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*=.*$/.test(envVar);
}

/**
 * Format bytes into a human-readable string.
 *
 * @param bytes - The number of bytes
 * @param decimals - Number of decimal places
 * @returns Formatted string
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!+bytes || bytes < 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(dm)} ${sizes[i]}`;
}

/**
 * Format a date into a relative time string.
 *
 * @param dateInput - The date to format
 * @returns Relative time string
 */
export function formatRelativeTime(dateInput: Date | string): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return String(dateInput);

  const diffMs = date.getTime() - new Date().getTime();
  const diffMins = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (Math.abs(diffDays) > 0) return rtf.format(diffDays, 'day');
  if (Math.abs(diffHours) > 0) return rtf.format(diffHours, 'hour');
  if (Math.abs(diffMins) > 0) return rtf.format(diffMins, 'minute');
  return 'just now';
}

/**
 * Parse a relative duration string (e.g. "5m", "1h") into an absolute ISO timestamp.
 */
export function parseRelativeDuration(duration: string): string | null {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  const val = parseInt(match[1]!, 10);
  const unit = match[2]!;
  let multiplier = 0;
  if (unit === 's') multiplier = 1000;
  if (unit === 'm') multiplier = 60000;
  if (unit === 'h') multiplier = 3600000;
  if (unit === 'd') multiplier = 86400000;
  return new Date(Date.now() - val * multiplier).toISOString();
}

/**
 * Truncate a string to a maximum length.
 *
 * @param str - The string to truncate
 * @param maxLength - Maximum allowed length
 * @returns Truncated string
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

