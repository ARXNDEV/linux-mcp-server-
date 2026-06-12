/**
 * System-level tools for querying and managing the container runtime.
 *
 * Tools registered:
 * - **system_info** — Retrieves container runtime system information
 * - **system_prune** — Cleans up unused containers, images, and build cache
 *
 * @module tools/system
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  runContainerCommandStrict,
  buildSuccessResponse,
  buildErrorResponse,
} from '../utils/cli.js';
import { safeJsonParse } from '../utils/parser.js';

/**
 * Register all system-level tools on the given MCP server instance.
 *
 * @param server - The McpServer to register tools on
 */
export function registerSystemTools(server: McpServer): void {
  // ──────────────────────────────────────────────────────────────────
  // system_info — Get container runtime system information
  // ──────────────────────────────────────────────────────────────────
  server.tool(
    'system_info',
    'Get container runtime system information including version, OS, architecture, resource counts, and storage details.',
    {},
    async () => {
      try {
        const stdout = await runContainerCommandStrict(['system', 'info']);

        // Attempt to parse as JSON for structured output; fall back to raw text
        const parsed = safeJsonParse<Record<string, unknown>>(stdout);

        if (parsed) {
          return buildSuccessResponse({
            systemInfo: parsed,
          });
        }

        // CLI returned non-JSON (human-readable table) — return raw text
        return buildSuccessResponse({
          systemInfo: stdout,
          note: 'Output returned in raw text format. Key-value pairs may need manual parsing.',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse('Failed to retrieve system information', {
          details: message,
        });
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────
  // system_prune — Clean up unused resources
  // ──────────────────────────────────────────────────────────────────
  server.tool(
    'system_prune',
    'Remove unused containers, images, networks, and build cache. Requires explicit confirmation to prevent accidental data loss.',
    {
      confirm: z
        .literal(true)
        .describe('Must be true to execute the prune — acts as a safety check.'),
    },
    async () => {
      try {
        const stdout = await runContainerCommandStrict(
          ['system', 'prune'],
          { timeout: 180_000 }, // prune can take several minutes on large systems
        );

        // Try to extract reclaimed space info from the output
        const parsed = safeJsonParse<Record<string, unknown>>(stdout);

        if (parsed) {
          return buildSuccessResponse({
            message: 'System prune completed successfully.',
            result: parsed,
          });
        }

        return buildSuccessResponse({
          message: 'System prune completed successfully.',
          output: stdout,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse('Failed to prune system resources', {
          details: message,
        });
      }
    },
  );
}
