/**
 * Network management tools for the container MCP server.
 * Provides tools to create, delete, and list container networks
 * via the Apple `container` CLI.
 *
 * Tools registered:
 * - `create_network` — Create a new container network
 * - `delete_network` — Remove one or more container networks
 * - `list_networks`  — List all container networks
 *
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
    'create_network',
    'Create a new container network',
    {
      name: z.string().describe('Network name'),
      driver: z.string().optional().describe('Driver to manage the network (e.g. "bridge", "overlay")'),
      options: z.record(z.string()).optional().describe('Network-specific options'),
    },
    async ({ name, driver, options }) => {
      try {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
          return buildErrorResponse(
            `Invalid network name: "${name}". Names must start with alphanumeric and contain only [a-zA-Z0-9_.-].`
          );
        }
        const args = ['network', 'create'];
        if (driver) args.push('--driver', driver);
        if (options) {
          for (const [key, val] of Object.entries(options)) {
            args.push('--opt', `${key}=${val}`);
          }
        }
        args.push(name);
        const stdout = await runContainerCommandStrict(args);
        return buildSuccessResponse({
          message: `Network "${name}" created successfully`,
          output: stdout.trim(),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse(`Failed to create network "${name}"`, { details: message });
      }
    },
  );

  server.tool(
    'delete_network',
    'Remove one or more container networks',
    {
      networks: z.array(z.string()).min(1).describe('Network names or IDs to remove'),
    },
    async ({ networks }) => {
      try {
        const stdout = await runContainerCommandStrict(['network', 'rm', ...networks]);
        return buildSuccessResponse({
          message: `Removed ${networks.length} network(s) successfully`,
          deleted: networks,
          output: stdout.trim(),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse('Failed to remove network(s)', { details: message });
      }
    },
  );

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
