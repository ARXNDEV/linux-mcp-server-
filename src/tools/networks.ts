/**
 * Network management tools for the container MCP server.
 * Provides tools to list container networks via the Apple `container` CLI.
 * @module tools/networks
 */

import {
  runContainerCommandStrict,
  buildSuccessResponse,
  buildErrorResponse,
} from '../utils/cli.js';
import { safeJsonParse } from '../utils/parser.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Register all network management tools on the given MCP server.
 *
 * Registers:
 * - `list_networks` — List all container networks
 *
 * @param server - The MCP server instance to register tools on
 */
export function registerNetworkTools(server: McpServer): void {
  /**
   * list_networks — List all container networks.
   *
   * Runs `container network ls` and returns the output in the requested format.
   * When format is 'json', the raw CLI output is parsed into structured data
   * containing network names, IDs, drivers, scopes, and subnet information.
   */
  server.tool(
    'list_networks',
    'List all container networks. Returns network names, IDs, drivers, scopes, and subnet details.',
    {
      format: z
        .enum(['table', 'json'])
        .optional()
        .default('json')
        .describe('Output format: "json" for structured data or "table" for human-readable text'),
    },
    async ({ format }) => {
      try {
        const args: string[] = ['network', 'ls'];

        if (format === 'json') {
          args.push('--format', 'json');
        }

        const stdout = await runContainerCommandStrict(args);

        if (format === 'json') {
          const parsed = safeJsonParse<unknown>(stdout);
          if (parsed !== null) {
            return buildSuccessResponse(parsed);
          }
          // If JSON parsing fails, return the raw output as-is
          return buildSuccessResponse(stdout);
        }

        return buildSuccessResponse(stdout);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse('Failed to list networks', { details: message });
      }
    },
  );
}
