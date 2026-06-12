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
  const regex = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(headerLine)) !== null) {
    columns.push({
      name: match[0],
      start: match.index,
    });
  }

  return columns;
}

/**
 * Format bytes into a human-readable string (e.g., "1.2 GB").
 *
 * @param bytes - Number of bytes
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted string like "256 MB" or "1.2 GB"
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(decimals)} ${sizes[i] ?? 'B'}`;
}

/**
 * Format a timestamp or duration into a human-readable relative time string.
 *
 * @param timestamp - ISO 8601 timestamp string or Date object
 * @returns Human-readable relative time (e.g., "2 hours ago", "5 minutes ago")
 */
export function formatRelativeTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (isNaN(diffMs)) return timestamp.toString();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (seconds < 60) return `${seconds} seconds ago`;
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
  if (weeks < 4) return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  return `${months} month${months !== 1 ? 's' : ''} ago`;
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
  // OCI names: lowercase alphanumeric, hyphens, underscores, dots, slashes, colons for tags
  return /^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]*$/.test(name);
}

/**
 * Validate a port mapping string (e.g., "8080:80", "8080:80/tcp").
 *
 * @param mapping - The port mapping string
 * @returns true if the mapping is valid
 */
export function isValidPortMapping(mapping: string): boolean {
  return /^\d+:\d+(\/(?:tcp|udp))?$/.test(mapping);
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
 * Truncate a string to a maximum length, adding ellipsis if truncated.
 *
 * @param str - The string to truncate
 * @param maxLength - Maximum length (default: 200)
 * @returns The original or truncated string
 */
export function truncate(str: string, maxLength = 200): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}
