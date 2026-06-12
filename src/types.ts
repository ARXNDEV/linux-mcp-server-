/**
 * Shared TypeScript types for the container-mcp server.
 * @module types
 */

/** Severity level for diagnostic output. */
export type Severity = 'low' | 'medium' | 'high';

/** Output format for list commands. */
export type OutputFormat = 'table' | 'json';

/** Result of executing a CLI command. */
export interface CliResult {
  /** Standard output from the command. */
  stdout: string;
  /** Standard error output from the command. */
  stderr: string;
  /** Process exit code. */
  exitCode: number;
}

/** Container information as returned by list/inspect operations. */
export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: string;
  ports: string[];
  mounts: string[];
  networks: string[];
  command: string;
  labels: Record<string, string>;
}

/** Image information as returned by list/inspect operations. */
export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
  digest: string;
}

/** Volume information. */
export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  created: string;
  size?: string;
  labels: Record<string, string>;
}

/** Network information. */
export interface NetworkInfo {
  name: string;
  id: string;
  driver: string;
  scope: string;
  subnet?: string;
  gateway?: string;
}

/** Container stats (CPU, memory, network). */
export interface ContainerStats {
  name: string;
  cpuPercent: string;
  memoryUsage: string;
  memoryLimit: string;
  memoryPercent: string;
  networkInput: string;
  networkOutput: string;
  blockInput: string;
  blockOutput: string;
  pids: string;
}

/** Process info from `container top`. */
export interface ProcessInfo {
  pid: string;
  user: string;
  cpu: string;
  mem: string;
  command: string;
}

/** Structured diagnosis result. */
export interface DiagnosisResult {
  containerName: string;
  status: string;
  possibleCauses: string[];
  suggestedFixes: string[];
  severity: Severity;
  logExcerpt: string;
  inspectSummary: string;
}

/** Human-readable container explanation. */
export interface ContainerExplanation {
  containerName: string;
  summary: string;
  image: string;
  status: string;
  uptime: string;
  ports: string[];
  environment: string[];
  mounts: string[];
  resourceUsage: string;
  processes: string[];
}

/** System info response shape. */
export interface SystemInfo {
  version: string;
  os: string;
  arch: string;
  cpus: string;
  memory: string;
  containers: {
    running: number;
    stopped: number;
    total: number;
  };
  images: number;
  storageDriver: string;
  rootDir: string;
}

/** MCP tool error shape for consistent error responses. */
export interface ToolError {
  error: string;
  command?: string;
  exitCode?: number;
  stderr?: string;
  hint?: string;
}

/** Union return type for all MCP tool handler functions. */
export type ToolResponse =
  | { content: Array<{ type: 'text'; text: string }> }
  | { content: Array<{ type: 'text'; text: string }>; isError: true };
