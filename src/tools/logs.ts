/**
 * Logs & monitoring MCP tools for the Apple `container` CLI.
 *
 * Provides three tools for observing running containers:
 * - **get_logs** — Retrieve container log output with tail/since filtering.
 * - **get_container_stats** — One-shot resource usage snapshot (CPU, memory, I/O).
 * - **get_container_processes** — List processes running inside a container.
 *
 * @module tools/logs
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  runContainerCommand,
  buildSuccessResponse,
  buildErrorResponse,
} from '../utils/cli.js';
import { safeJsonParse, parseTableOutput } from '../utils/parser.js';
import type { ContainerStats, ProcessInfo } from '../types.js';

/**
 * Parse a single stats row (from `container stats --no-stream`) into a
 * structured {@link ContainerStats} object.
 *
 * The raw output columns produced by most container runtimes look like:
 * ```
 * CONTAINER ID   NAME   CPU %   MEM USAGE / LIMIT   MEM %   NET I/O   BLOCK I/O   PIDS
 * ```
 *
 * @param row - A record with lowercase keys produced by {@link parseTableOutput}
 * @returns A normalised {@link ContainerStats} object
 */
function parseStatsRow(row: Record<string, string>): ContainerStats {
  // Memory usage column is typically "X MiB / Y MiB" — split on "/"
  const memParts = (row['mem usage / limit'] ?? row['mem usage'] ?? '').split('/');
  const memoryUsage = memParts[0]?.trim() ?? 'N/A';
  const memoryLimit = memParts[1]?.trim() ?? 'N/A';

  // Network I/O column is typically "X kB / Y kB"
  const netParts = (row['net i/o'] ?? '').split('/');
  const networkInput = netParts[0]?.trim() ?? 'N/A';
  const networkOutput = netParts[1]?.trim() ?? 'N/A';

  // Block I/O column is typically "X MB / Y MB"
  const blockParts = (row['block i/o'] ?? '').split('/');
  const blockInput = blockParts[0]?.trim() ?? 'N/A';
  const blockOutput = blockParts[1]?.trim() ?? 'N/A';

  return {
    name: row['name'] ?? row['container id'] ?? 'unknown',
    cpuPercent: row['cpu %'] ?? 'N/A',
    memoryUsage,
    memoryLimit,
    memoryPercent: row['mem %'] ?? 'N/A',
    networkInput,
    networkOutput,
    blockInput,
    blockOutput,
    pids: row['pids'] ?? 'N/A',
  };
}

/**
 * Parse a single process row (from `container top`) into a structured
 * {@link ProcessInfo} object.
 *
 * Typical columns: PID  USER  %CPU  %MEM  COMMAND
 *
 * @param row - A record with lowercase keys produced by {@link parseTableOutput}
 * @returns A normalised {@link ProcessInfo} object
 */
function parseProcessRow(row: Record<string, string>): ProcessInfo {
  return {
    pid: row['pid'] ?? 'N/A',
    user: row['user'] ?? row['uid'] ?? 'N/A',
    cpu: row['%cpu'] ?? row['cpu'] ?? 'N/A',
    mem: row['%mem'] ?? row['mem'] ?? 'N/A',
    command: row['command'] ?? row['cmd'] ?? row['args'] ?? 'N/A',
  };
}

/**
 * Register all logs & monitoring tools on the given MCP server instance.
 *
 * @param server - The {@link McpServer} instance to attach tools to
 */
export function registerLogTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // Tool 1 — get_logs
  // ---------------------------------------------------------------------------

  /**
   * **get_logs** — Retrieve container log output.
   *
   * Runs `container logs [--tail N] [--since T] <name>` and returns the
   * captured log text.  The optional `follow` parameter is accepted for schema
   * completeness but, because MCP uses a request/response model (no streaming),
   * it simply returns the latest snapshot of logs.
   */
  server.tool(
    'get_logs',
    'Get container logs. Returns the latest log output from a container with optional tail line-count and since-timestamp filtering.',
    {
      name: z.string().describe('Container name or ID'),
      tail: z
        .number()
        .optional()
        .default(100)
        .describe('Number of lines from end'),
      since: z
        .string()
        .optional()
        .describe('Show logs since timestamp e.g. 2024-01-01T00:00:00'),
      follow: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'Note: follow mode returns latest snapshot, not streaming',
        ),
    },
    async ({ name, tail, since, follow }) => {
      try {
        // Build argument list
        const args: string[] = ['logs'];

        if (tail !== undefined && tail > 0) {
          args.push('--tail', String(tail));
        }

        if (since) {
          args.push('--since', since);
        }

        // `follow` is intentionally *not* passed to the CLI because MCP cannot
        // stream data back.  We document this in the tool description so callers
        // understand the limitation.

        args.push(name);

        const result = await runContainerCommand(args, { timeout: 15_000 });

        if (result.exitCode !== 0) {
          return buildErrorResponse(
            `Failed to retrieve logs for container "${name}"`,
            {
              exitCode: result.exitCode,
              stderr: result.stderr,
              hint: 'Verify the container name/ID with list_containers. The container must exist (running or stopped).',
            },
          );
        }

        const logOutput = result.stdout || '(no log output)';
        const lineCount = logOutput.split('\n').filter((l) => l.length > 0).length;

        return buildSuccessResponse({
          container: name,
          lineCount,
          tail,
          since: since ?? null,
          follow,
          note: follow
            ? 'follow=true returns a snapshot — MCP does not support streaming.'
            : undefined,
          logs: logOutput,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse(`Error fetching logs for container "${name}": ${message}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Tool 2 — get_container_stats
  // ---------------------------------------------------------------------------

  /**
   * **get_container_stats** — One-shot resource usage snapshot.
   *
   * Runs `container stats --no-stream <name>` and parses the tabular output
   * into structured fields: CPU %, memory usage/limit, network I/O, block I/O,
   * and PID count.
   */
  server.tool(
    'get_container_stats',
    'Get container resource usage stats (CPU, memory, network I/O, block I/O, PIDs). Returns a one-shot snapshot.',
    {
      name: z.string().describe('Container name or ID'),
    },
    async ({ name }) => {
      try {
        const args: string[] = ['stats', '--no-stream', name];

        const result = await runContainerCommand(args, { timeout: 15_000 });

        if (result.exitCode !== 0) {
          return buildErrorResponse(
            `Failed to retrieve stats for container "${name}"`,
            {
              exitCode: result.exitCode,
              stderr: result.stderr,
              hint: 'The container must be running to retrieve stats. Check its status with list_containers.',
            },
          );
        }

        const rawOutput = result.stdout.trim();

        if (!rawOutput) {
          return buildErrorResponse(
            `No stats output returned for container "${name}"`,
            { hint: 'The container may not be running.' },
          );
        }

        // Attempt JSON parse first (some CLI versions support --format json)
        const jsonStats = safeJsonParse<ContainerStats | ContainerStats[]>(rawOutput);
        if (jsonStats) {
          const stats = Array.isArray(jsonStats) ? jsonStats[0] : jsonStats;
          return buildSuccessResponse({
            container: name,
            stats: stats ?? null,
          });
        }

        // Fall back to table parsing
        const rows = parseTableOutput(rawOutput);

        if (rows.length === 0) {
          // Return the raw output when we cannot parse it
          return buildSuccessResponse({
            container: name,
            rawStats: rawOutput,
            note: 'Stats output could not be parsed into structured data. Returning raw output.',
          });
        }

        const stats: ContainerStats = parseStatsRow(rows[0]!);

        return buildSuccessResponse({
          container: name,
          stats,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse(`Error fetching stats for container "${name}": ${message}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Tool 3 — get_container_processes
  // ---------------------------------------------------------------------------

  /**
   * **get_container_processes** — List processes running inside a container.
   *
   * Runs `container top <name>` and parses the tabular process listing into
   * structured {@link ProcessInfo} objects.
   */
  server.tool(
    'get_container_processes',
    'List processes running in a container. Returns structured process information including PID, user, CPU, memory, and command.',
    {
      name: z.string().describe('Container name or ID'),
    },
    async ({ name }) => {
      try {
        const args: string[] = ['top', name];

        const result = await runContainerCommand(args, { timeout: 15_000 });

        if (result.exitCode !== 0) {
          return buildErrorResponse(
            `Failed to list processes for container "${name}"`,
            {
              exitCode: result.exitCode,
              stderr: result.stderr,
              hint: 'The container must be running to list its processes. Check its status with list_containers.',
            },
          );
        }

        const rawOutput = result.stdout.trim();

        if (!rawOutput) {
          return buildErrorResponse(
            `No process output returned for container "${name}"`,
            { hint: 'The container may not be running or may have no active processes.' },
          );
        }

        // Attempt JSON parse first
        const jsonProcs = safeJsonParse<ProcessInfo[]>(rawOutput);
        if (jsonProcs && Array.isArray(jsonProcs)) {
          return buildSuccessResponse({
            container: name,
            processCount: jsonProcs.length,
            processes: jsonProcs,
          });
        }

        // Fall back to table parsing
        const rows = parseTableOutput(rawOutput);

        if (rows.length === 0) {
          // Return the raw output when we cannot parse it
          return buildSuccessResponse({
            container: name,
            rawProcessList: rawOutput,
            note: 'Process output could not be parsed into structured data. Returning raw output.',
          });
        }

        const processes: ProcessInfo[] = rows.map(parseProcessRow);

        return buildSuccessResponse({
          container: name,
          processCount: processes.length,
          processes,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse(`Error listing processes for container "${name}": ${message}`);
      }
    },
  );
}
