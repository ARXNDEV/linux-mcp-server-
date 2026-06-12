/**
 * AI-powered diagnostic and explanation tools for containers.
 *
 * This module is the **signature feature** of the container-mcp server.
 * It provides deep, automated analysis of container health without
 * requiring an external LLM — all pattern matching is deterministic
 * and runs locally.
 *
 * Tools registered:
 * - **diagnose_container** — Analyze logs and inspect data to surface
 *   probable causes, suggested fixes, and severity.
 * - **explain_container** — Produce a human-readable paragraph that
 *   describes what a container is, what it's doing, and how it's
 *   configured.
 *
 * @module tools/diagnostics
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  runContainerCommand,
  runContainerCommandStrict,
  buildSuccessResponse,
  buildErrorResponse,
} from '../utils/cli.js';
import { safeJsonParse, parseTableOutput } from '../utils/parser.js';
import type { DiagnosisResult, ContainerExplanation, Severity } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// Internal types
// ═══════════════════════════════════════════════════════════════════

/** A single detected issue with its recommended fix. */
interface DetectedIssue {
  /** Human-readable description of the probable cause. */
  cause: string;
  /** Actionable fix the user can apply. */
  fix: string;
  /** How severe this issue is. */
  severity: Severity;
}

// ═══════════════════════════════════════════════════════════════════
// Pattern definitions for log / inspect analysis
// ═══════════════════════════════════════════════════════════════════

/**
 * Each pattern maps a set of log substrings (case-insensitive)
 * to a cause, fix, and severity so the analyser can surface
 * actionable diagnostics without an LLM round-trip.
 */
interface DiagnosticPattern {
  /** Strings to search for (case-insensitive). Any match triggers. */
  logPatterns: string[];
  cause: string;
  fix: string;
  severity: Severity;
}

const LOG_DIAGNOSTIC_PATTERNS: DiagnosticPattern[] = [
  {
    logPatterns: ['address already in use', 'port is already allocated', 'bind: address already in use'],
    cause: 'Port conflict — another process is already bound to the requested port.',
    fix: 'Change the host port mapping (-p HOST:CONTAINER) or stop the conflicting service with `lsof -i :PORT`.',
    severity: 'high',
  },
  {
    logPatterns: ['permission denied', 'eacces', 'operation not permitted', 'eperm'],
    cause: 'Permission error — the container process lacks required filesystem or system permissions.',
    fix: 'Run the container with elevated capabilities (--cap-add), adjust file ownership inside the image, or use a non-root USER with correct group membership.',
    severity: 'high',
  },
  {
    logPatterns: ['connection refused', 'network unreachable', 'no route to host'],
    cause: 'Network connectivity failure — the container cannot reach an upstream service or the network is misconfigured.',
    fix: 'Verify the target service is running and listening, check container network mode, and ensure DNS resolution works inside the container.',
    severity: 'high',
  },
  {
    logPatterns: ['dns', 'could not resolve', 'name resolution', 'getaddrinfo', 'nxdomain'],
    cause: 'DNS resolution failure — the container cannot resolve hostnames.',
    fix: 'Check the container DNS configuration (--dns flag), verify the DNS server is reachable, or use IP addresses directly as a workaround.',
    severity: 'high',
  },
  {
    logPatterns: ['no space left on device', 'disk quota exceeded', 'enospc'],
    cause: 'Disk space exhaustion — the container or host filesystem is full.',
    fix: 'Run `container system prune` to reclaim space, increase the disk allocation, or add volume mounts for large data directories.',
    severity: 'high',
  },
  {
    logPatterns: ['out of memory', 'oom', 'cannot allocate memory', 'memory allocation failed', 'enomem'],
    cause: 'Memory exhaustion — the container is running out of available memory.',
    fix: 'Increase the memory limit (--memory), optimise the application memory footprint, or add swap space.',
    severity: 'high',
  },
  {
    logPatterns: ['missing environment variable', 'env var not set', 'required variable', 'environment variable is not defined'],
    cause: 'Missing or undefined environment variable — the application is referencing a configuration value that was not provided.',
    fix: 'Pass the required environment variables with -e KEY=VALUE or via an --env-file. Check the image documentation for required variables.',
    severity: 'medium',
  },
  {
    logPatterns: ['segfault', 'segmentation fault', 'sigsegv', 'core dumped', 'signal 11'],
    cause: 'Segmentation fault — the application crashed due to invalid memory access.',
    fix: 'Check for known bugs in the application version, ensure native dependencies are compatible with the container architecture (arm64 vs amd64), and review core dumps if available.',
    severity: 'high',
  },
  {
    logPatterns: ['killed', 'signal 9', 'sigkill'],
    cause: 'Process was forcibly killed (SIGKILL) — likely by the OOM killer or an external signal.',
    fix: 'Increase memory limits, check host-level OOM killer logs (`dmesg`), and consider adding health checks to restart gracefully.',
    severity: 'high',
  },
  {
    logPatterns: ['timeout', 'timed out', 'deadline exceeded', 'context deadline'],
    cause: 'Operation timeout — a network call or internal operation exceeded its deadline.',
    fix: 'Increase timeout values in the application configuration, check the latency to upstream services, and verify connection pool sizing.',
    severity: 'medium',
  },
  {
    logPatterns: ['certificate', 'tls', 'ssl', 'x509', 'certificate verify failed', 'cert_not_yet_valid'],
    cause: 'TLS / certificate error — the application failed to validate or establish a secure connection.',
    fix: 'Mount up-to-date CA certificates, set NODE_TLS_REJECT_UNAUTHORIZED=0 for dev (never in production), or update the trusted root bundle.',
    severity: 'medium',
  },
  {
    logPatterns: ['exec format error', 'cannot execute binary'],
    cause: 'Architecture mismatch — the binary inside the image is not compatible with the host CPU architecture.',
    fix: 'Pull or build an image that matches the host architecture (e.g., linux/arm64 for Apple Silicon).',
    severity: 'high',
  },
  {
    logPatterns: ['file not found', 'no such file or directory', 'enoent'],
    cause: 'Missing file — a required file or directory does not exist inside the container.',
    fix: 'Verify volume mounts, check the Dockerfile COPY / ADD directives, and ensure the working directory is set correctly.',
    severity: 'medium',
  },
];

// ═══════════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Analyse raw log output against known diagnostic patterns.
 *
 * @param logs - Raw log string (may be multi-line)
 * @returns Array of detected issues sorted by severity (high → low)
 */
function analyseLogPatterns(logs: string): DetectedIssue[] {
  const lowered = logs.toLowerCase();
  const issues: DetectedIssue[] = [];
  const seen = new Set<string>();

  for (const pattern of LOG_DIAGNOSTIC_PATTERNS) {
    const matched = pattern.logPatterns.some((p) => lowered.includes(p));
    if (matched && !seen.has(pattern.cause)) {
      seen.add(pattern.cause);
      issues.push({
        cause: pattern.cause,
        fix: pattern.fix,
        severity: pattern.severity,
      });
    }
  }

  return issues;
}

/**
 * Analyse the inspect JSON for state-level problems (OOM, non-zero exits, restarts).
 *
 * @param inspect - Parsed inspect JSON (may be a single object or an array)
 * @returns Array of detected issues
 */
function analyseInspectData(inspect: Record<string, unknown>): DetectedIssue[] {
  const issues: DetectedIssue[] = [];

  // Normalise: `container inspect` sometimes returns an array
  const data: Record<string, unknown> =
    Array.isArray(inspect) && inspect.length > 0
      ? (inspect[0] as Record<string, unknown>)
      : inspect;

  const state = data['State'] as Record<string, unknown> | undefined;
  if (!state) return issues;

  // OOMKilled
  if (state['OOMKilled'] === true) {
    issues.push({
      cause: 'Container was OOM-killed — it exceeded its memory limit.',
      fix: 'Increase the memory limit (--memory), profile the application for memory leaks, or optimise memory usage.',
      severity: 'high',
    });
  }

  // Non-zero exit code
  const exitCode = state['ExitCode'] as number | undefined;
  if (exitCode !== undefined && exitCode !== 0) {
    const exitHints: Record<number, string> = {
      1: 'Generic application error. Check application logs for details.',
      2: 'Shell misuse or incorrect command. Verify the CMD / ENTRYPOINT.',
      126: 'Command not executable. Check file permissions and shebang lines.',
      127: 'Command not found. Verify the binary exists in the image PATH.',
      137: 'SIGKILL (exit 137). Usually OOM-killed or manually stopped.',
      139: 'Segmentation fault (exit 139). Check for native library compatibility.',
      143: 'SIGTERM (exit 143). Container was gracefully stopped.',
    };
    const hint = exitHints[exitCode] ?? `Uncommon exit code ${exitCode}. Check application documentation.`;
    issues.push({
      cause: `Container exited with code ${exitCode}.`,
      fix: hint,
      severity: exitCode === 143 ? 'low' : 'high',
    });
  }

  // Restart count — crash loops
  const restartCount = (state['RestartCount'] ?? (data['RestartCount'] as number | undefined)) as number | undefined;
  if (restartCount !== undefined && restartCount > 3) {
    issues.push({
      cause: `Container has restarted ${restartCount} times — potential crash loop.`,
      fix: 'Inspect startup logs, verify the entrypoint succeeds, and check resource limits. Consider setting a restart policy with a max retry count.',
      severity: 'high',
    });
  }

  return issues;
}

/**
 * Derive the highest severity from a list of issues.
 * Returns 'low' when no issues are detected.
 *
 * @param issues - Array of detected issues
 * @returns The most severe level found
 */
function highestSeverity(issues: DetectedIssue[]): Severity {
  if (issues.some((i) => i.severity === 'high')) return 'high';
  if (issues.some((i) => i.severity === 'medium')) return 'medium';
  return 'low';
}

/**
 * Extract the last N lines from a multi-line string.
 *
 * @param text - Multi-line string
 * @param n - Number of trailing lines to keep (default 20)
 * @returns The last N lines joined by newlines
 */
function lastNLines(text: string, n = 20): string {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return lines.slice(-n).join('\n');
}

/**
 * Build a compact summary string from inspect JSON.
 *
 * @param inspect - Parsed inspect JSON
 * @returns A multi-line key-value summary
 */
function buildInspectSummary(inspect: Record<string, unknown>): string {
  const data: Record<string, unknown> =
    Array.isArray(inspect) && inspect.length > 0
      ? (inspect[0] as Record<string, unknown>)
      : inspect;

  const parts: string[] = [];

  const name = data['Name'] as string | undefined;
  if (name) parts.push(`Name: ${name}`);

  const id = data['Id'] as string | undefined;
  if (id) parts.push(`ID: ${id.substring(0, 12)}`);

  const state = data['State'] as Record<string, unknown> | undefined;
  if (state) {
    parts.push(`Status: ${state['Status'] ?? 'unknown'}`);
    if (state['StartedAt']) parts.push(`Started: ${state['StartedAt']}`);
    if (state['FinishedAt'] && state['FinishedAt'] !== '0001-01-01T00:00:00Z') {
      parts.push(`Finished: ${state['FinishedAt']}`);
    }
    if (state['ExitCode'] !== undefined) parts.push(`Exit Code: ${state['ExitCode']}`);
    if (state['OOMKilled']) parts.push(`OOMKilled: ${state['OOMKilled']}`);
  }

  const config = data['Config'] as Record<string, unknown> | undefined;
  if (config) {
    if (config['Image']) parts.push(`Image: ${config['Image']}`);
    if (config['Cmd']) parts.push(`Cmd: ${JSON.stringify(config['Cmd'])}`);
    if (config['Entrypoint']) parts.push(`Entrypoint: ${JSON.stringify(config['Entrypoint'])}`);
  }

  const hostConfig = data['HostConfig'] as Record<string, unknown> | undefined;
  if (hostConfig) {
    if (hostConfig['Memory']) parts.push(`Memory Limit: ${hostConfig['Memory']}`);
    if (hostConfig['CpuShares']) parts.push(`CPU Shares: ${hostConfig['CpuShares']}`);
    if (hostConfig['RestartPolicy']) {
      const rp = hostConfig['RestartPolicy'] as Record<string, unknown>;
      parts.push(`Restart Policy: ${rp['Name'] ?? 'none'} (max retries: ${rp['MaximumRetryCount'] ?? 0})`);
    }
  }

  return parts.join('\n');
}

/**
 * Redact environment variable values that are longer than a threshold.
 * Short values (e.g. "true", "production") are kept visible.
 *
 * @param envVars - Array of "KEY=VALUE" strings
 * @param maxLen - Maximum value length before redaction (default 50)
 * @returns Array with long values replaced by "***REDACTED***"
 */
function redactEnvVars(envVars: string[], maxLen = 50): string[] {
  return envVars.map((entry) => {
    const eqIdx = entry.indexOf('=');
    if (eqIdx === -1) return entry;
    const key = entry.substring(0, eqIdx);
    const value = entry.substring(eqIdx + 1);
    if (value.length > maxLen) {
      return `${key}=***REDACTED***`;
    }
    return entry;
  });
}

/**
 * Extract port mappings from inspect data into human-readable strings.
 *
 * @param inspect - Parsed inspect JSON
 * @returns Array of "HOST:CONTAINER/proto" strings
 */
function extractPorts(inspect: Record<string, unknown>): string[] {
  const data: Record<string, unknown> =
    Array.isArray(inspect) && inspect.length > 0
      ? (inspect[0] as Record<string, unknown>)
      : inspect;

  const ports: string[] = [];

  // NetworkSettings.Ports is usually the most reliable source
  const netSettings = data['NetworkSettings'] as Record<string, unknown> | undefined;
  const portsMap = netSettings?.['Ports'] as Record<string, Array<Record<string, string>> | null> | undefined;

  if (portsMap) {
    for (const [containerPort, bindings] of Object.entries(portsMap)) {
      if (bindings && Array.isArray(bindings)) {
        for (const binding of bindings) {
          const hostIp = binding['HostIp'] || '0.0.0.0';
          const hostPort = binding['HostPort'];
          if (hostPort) {
            ports.push(`${hostIp}:${hostPort} → ${containerPort}`);
          }
        }
      } else {
        ports.push(`${containerPort} (not published)`);
      }
    }
  }

  return ports;
}

/**
 * Extract volume mounts from inspect data.
 *
 * @param inspect - Parsed inspect JSON
 * @returns Array of "SOURCE → DESTINATION (mode)" strings
 */
function extractMounts(inspect: Record<string, unknown>): string[] {
  const data: Record<string, unknown> =
    Array.isArray(inspect) && inspect.length > 0
      ? (inspect[0] as Record<string, unknown>)
      : inspect;

  const mounts = data['Mounts'] as Array<Record<string, string>> | undefined;
  if (!mounts || !Array.isArray(mounts)) return [];

  return mounts.map((m) => {
    const source = m['Source'] || m['Name'] || 'anonymous';
    const dest = m['Destination'] || 'unknown';
    const mode = m['Mode'] || 'rw';
    return `${source} → ${dest} (${mode})`;
  });
}

/**
 * Extract the container status string from inspect data.
 *
 * @param inspect - Parsed inspect JSON
 * @returns Status string or "unknown"
 */
function extractStatus(inspect: Record<string, unknown>): string {
  const data: Record<string, unknown> =
    Array.isArray(inspect) && inspect.length > 0
      ? (inspect[0] as Record<string, unknown>)
      : inspect;

  const state = data['State'] as Record<string, unknown> | undefined;
  return (state?.['Status'] as string) ?? 'unknown';
}

// ═══════════════════════════════════════════════════════════════════
// Tool registration
// ═══════════════════════════════════════════════════════════════════

/**
 * Register AI-powered diagnostic and explanation tools on the MCP server.
 *
 * These tools combine multiple CLI calls (logs, inspect, stats, top) and
 * apply deterministic pattern matching to surface actionable insights.
 *
 * @param server - The McpServer instance to register tools on
 */
export function registerDiagnosticsTools(server: McpServer): void {
  // ──────────────────────────────────────────────────────────────────
  // diagnose_container — AI-powered container diagnosis
  // ──────────────────────────────────────────────────────────────────
  server.tool(
    'diagnose_container',
    'Diagnose a container by analysing its logs and runtime state. Returns probable causes, suggested fixes, and a severity rating. No external AI required — all analysis is deterministic pattern matching.',
    {
      name: z.string().describe('Container name or ID to diagnose'),
      question: z
        .string()
        .optional()
        .describe(
          'Optional specific question about the container (e.g. "why is it restarting?"). ' +
            'When provided the diagnosis focuses on patterns related to the question.',
        ),
    },
    async ({ name, question }) => {
      try {
        if (!name.trim() || /[\s;|&`$]/.test(name)) {
          return buildErrorResponse(`Invalid container name: "${name}". Names must not be empty or contain shell metacharacters.`);
        }
        // ── Step 1: Fetch logs (last 100 lines) ───────────────────
        const logsResult = await runContainerCommand(
          ['logs', '--tail', '100', name],
          { timeout: 15_000 },
        );
        // Logs may come on stderr for some runtimes; combine both streams
        let rawLogs = (logsResult.stdout || '') + '\n' + (logsResult.stderr || '');
        let logWarning = '';
        if (logsResult.exitCode !== 0) {
          logWarning = `⚠️ Warning: Failed to fetch logs (exit code ${logsResult.exitCode}). ` +
            `Log-based analysis may be incomplete.\n`;
          rawLogs = logsResult.stderr || '';
        }

        // ── Step 2: Fetch inspect data ────────────────────────────
        let inspectRaw: string;
        try {
          inspectRaw = await runContainerCommandStrict(['inspect', name]);
        } catch (inspectErr) {
          // If inspect fails the container likely doesn't exist
          const msg =
            inspectErr instanceof Error
              ? inspectErr.message
              : String(inspectErr);
          return buildErrorResponse(
            `Cannot inspect container "${name}". It may not exist.`,
            { details: msg },
          );
        }

        const inspectData = safeJsonParse<Record<string, unknown>>(inspectRaw);

        // ── Step 3: Analyse patterns ──────────────────────────────
        const allIssues: DetectedIssue[] = [];

        // 3a — Log-based analysis
        allIssues.push(...analyseLogPatterns(rawLogs));

        // 3b — Inspect-based analysis (OOM, exit codes, crash loops)
        if (inspectData) {
          allIssues.push(...analyseInspectData(inspectData));
        }

        // If user asked a specific question, boost patterns that
        // mention related keywords.
        if (question) {
          const qLower = question.toLowerCase();
          // Sort: issues whose cause text overlaps with the question come first
          allIssues.sort((a, b) => {
            const aRelevant = a.cause.toLowerCase().split(' ').some((w) => qLower.includes(w)) ? 0 : 1;
            const bRelevant = b.cause.toLowerCase().split(' ').some((w) => qLower.includes(w)) ? 0 : 1;
            return aRelevant - bRelevant;
          });
        }

        // ── Step 4: Build result ──────────────────────────────────
        const status = inspectData ? extractStatus(inspectData) : 'unknown';

        const inspectSummary = inspectData
          ? buildInspectSummary(inspectData)
          : 'Inspect data unavailable.';

        const severity = highestSeverity(allIssues);

        // If no issues found, still return useful info
        const possibleCauses =
          allIssues.length > 0
            ? allIssues.map((i) => i.cause)
            : ['No obvious issues detected in logs or runtime state.'];
        const suggestedFixes =
          allIssues.length > 0
            ? allIssues.map((i) => i.fix)
            : [
                'Container appears healthy. If problems persist, check application-level logs or increase the log tail count.',
              ];

        const logExcerpt = logWarning + lastNLines(rawLogs, 20);
        const diagnosis: DiagnosisResult = {
          containerName: name,
          status,
          possibleCauses,
          suggestedFixes,
          severity,
          logExcerpt,
          inspectSummary,
        };

        return buildSuccessResponse(diagnosis);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse(`Failed to diagnose container "${name}"`, {
          details: message,
        });
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────
  // explain_container — Human-readable container explanation
  // ──────────────────────────────────────────────────────────────────
  server.tool(
    'explain_container',
    'Generate a comprehensive, human-readable explanation of a container — what it is, how it is configured, and what it is doing right now. Covers image, status, ports, environment, volumes, resource usage, and processes.',
    {
      name: z.string().describe('Container name or ID to explain'),
    },
    async ({ name }) => {
      try {
        if (!name.trim() || /[\s;|&`$]/.test(name)) {
          return buildErrorResponse(`Invalid container name: "${name}". Names must not be empty or contain shell metacharacters.`);
        }
        // ── Inspect (required) ────────────────────────────────────
        let inspectRaw: string;
        try {
          inspectRaw = await runContainerCommandStrict(['inspect', name]);
        } catch (inspectErr) {
          const msg =
            inspectErr instanceof Error
              ? inspectErr.message
              : String(inspectErr);
          return buildErrorResponse(
            `Cannot inspect container "${name}". It may not exist.`,
            { details: msg },
          );
        }

        const inspectData = safeJsonParse<Record<string, unknown>>(inspectRaw);
        if (!inspectData) {
          return buildErrorResponse(
            `Failed to parse inspect data for container "${name}".`,
            { rawOutput: inspectRaw.substring(0, 500) },
          );
        }

        // Normalise array format
        const data: Record<string, unknown> =
          Array.isArray(inspectData) && inspectData.length > 0
            ? (inspectData[0] as Record<string, unknown>)
            : inspectData;

        // ── Extract core info from inspect ────────────────────────
        const config = (data['Config'] as Record<string, unknown>) ?? {};
        const state = (data['State'] as Record<string, unknown>) ?? {};
        const hostConfig = (data['HostConfig'] as Record<string, unknown>) ?? {};

        const imageName = (config['Image'] as string) ?? 'unknown';
        const containerName =
          ((data['Name'] as string) ?? name).replace(/^\//, '');
        const status = (state['Status'] as string) ?? 'unknown';
        const startedAt = (state['StartedAt'] as string) ?? '';
        const finishedAt = (state['FinishedAt'] as string) ?? '';
        const exitCode = state['ExitCode'] as number | undefined;

        // Uptime / finished
        let uptime = 'unknown';
        if (status === 'running' && startedAt) {
          const started = new Date(startedAt);
          const diffMs = Date.now() - started.getTime();
          if (!isNaN(diffMs) && diffMs > 0) {
            const secs = Math.floor(diffMs / 1000);
            const mins = Math.floor(secs / 60);
            const hrs = Math.floor(mins / 60);
            const days = Math.floor(hrs / 24);
            if (days > 0) uptime = `${days}d ${hrs % 24}h ${mins % 60}m`;
            else if (hrs > 0) uptime = `${hrs}h ${mins % 60}m`;
            else uptime = `${mins}m ${secs % 60}s`;
          }
        } else if (finishedAt && finishedAt !== '0001-01-01T00:00:00Z') {
          uptime = `stopped since ${finishedAt}`;
        }

        // Ports
        const ports = extractPorts(data as Record<string, unknown>);

        // Environment variables (redacted)
        const rawEnv = (config['Env'] as string[]) ?? [];
        const environment = redactEnvVars(rawEnv);

        // Mounts
        const mounts = extractMounts(data as Record<string, unknown>);

        // Network info
        const netSettings = data['NetworkSettings'] as Record<string, unknown> | undefined;
        const networks = netSettings?.['Networks'] as Record<string, Record<string, unknown>> | undefined;
        const networkNames = networks ? Object.keys(networks) : [];
        const ipAddress = networks
          ? Object.values(networks).map((n) => n['IPAddress'] as string).filter(Boolean).join(', ')
          : 'N/A';

        // Restart policy
        const restartPolicy = hostConfig['RestartPolicy'] as Record<string, unknown> | undefined;
        const restartPolicyName = (restartPolicy?.['Name'] as string) ?? 'none';

        // ── Stats (optional — container may not be running) ───────
        let resourceUsage = 'Stats unavailable (container may not be running).';
        try {
          const statsResult = await runContainerCommand(
            ['stats', '--no-stream', name],
            { timeout: 10_000 },
          );
          if (statsResult.exitCode === 0 && statsResult.stdout.trim()) {
            const statsRows = parseTableOutput(statsResult.stdout);
            if (statsRows.length > 0) {
              const s = statsRows[0]!;
              const cpuPct = s['cpu %'] ?? s['cpu'] ?? 'N/A';
              const memUsage = s['mem usage / limit'] ?? s['mem usage'] ?? 'N/A';
              const memPct = s['mem %'] ?? s['mem'] ?? 'N/A';
              const netIO = s['net i/o'] ?? 'N/A';
              const blockIO = s['block i/o'] ?? 'N/A';
              const pids = s['pids'] ?? 'N/A';
              resourceUsage =
                `CPU: ${cpuPct} | Memory: ${memUsage} (${memPct}) | ` +
                `Net I/O: ${netIO} | Block I/O: ${blockIO} | PIDs: ${pids}`;
            }
          }
        } catch {
          // Swallow — stats are optional
        }

        // ── Processes (optional — container may not be running) ───
        const processes: string[] = [];
        try {
          const topResult = await runContainerCommand(
            ['top', name],
            { timeout: 10_000 },
          );
          if (topResult.exitCode === 0 && topResult.stdout.trim()) {
            const topRows = parseTableOutput(topResult.stdout);
            for (const row of topRows) {
              const pid = row['pid'] ?? '?';
              const user = row['user'] ?? '?';
              const cmd = row['command'] ?? row['cmd'] ?? '?';
              processes.push(`PID ${pid} (${user}): ${cmd}`);
            }
          }
        } catch {
          // Swallow — processes are optional
        }

        // ── Build human-readable summary paragraph ────────────────
        const summaryParts: string[] = [];

        // Identity
        summaryParts.push(
          `"${containerName}" is a container running the image "${imageName}".`,
        );

        // Status
        if (status === 'running') {
          summaryParts.push(
            `It is currently **running** and has been up for ${uptime}.`,
          );
        } else if (status === 'exited') {
          summaryParts.push(
            `It has **exited** with code ${exitCode ?? 'unknown'} (${uptime}).`,
          );
        } else {
          summaryParts.push(`Its current status is **${status}** (${uptime}).`);
        }

        // Restart policy
        if (restartPolicyName !== 'none' && restartPolicyName !== '') {
          summaryParts.push(
            `Restart policy: ${restartPolicyName}.`,
          );
        }

        // Ports
        if (ports.length > 0) {
          summaryParts.push(`Exposed ports: ${ports.join(', ')}.`);
        } else {
          summaryParts.push('No ports are published to the host.');
        }

        // Network
        if (networkNames.length > 0) {
          summaryParts.push(
            `Connected to network(s): ${networkNames.join(', ')} (IP: ${ipAddress}).`,
          );
        }

        // Environment
        if (environment.length > 0) {
          summaryParts.push(
            `It has ${environment.length} environment variable(s) configured.`,
          );
        }

        // Volumes
        if (mounts.length > 0) {
          summaryParts.push(
            `Volume mounts: ${mounts.join('; ')}.`,
          );
        } else {
          summaryParts.push('No volume mounts are configured.');
        }

        // Resources
        summaryParts.push(`Resource usage: ${resourceUsage}`);

        // Processes
        if (processes.length > 0) {
          summaryParts.push(
            `Running processes: ${processes.join('; ')}.`,
          );
        } else if (status === 'running') {
          summaryParts.push('Process list is unavailable.');
        }

        const summary = summaryParts.join(' ');

        // ── Build response object ─────────────────────────────────
        const explanation: ContainerExplanation = {
          containerName,
          summary,
          image: imageName,
          status,
          uptime,
          ports,
          environment,
          mounts: mounts,
          resourceUsage,
          processes,
        };

        return buildSuccessResponse(explanation);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse(
          `Failed to explain container "${name}"`,
          { details: message },
        );
      }
    },
  );
}
