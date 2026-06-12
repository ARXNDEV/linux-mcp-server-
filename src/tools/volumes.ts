/**
 * Volume management tools for the container MCP server.
 * Provides tools to list, create, and delete container volumes
 * via the Apple `container` CLI.
 * @module tools/volumes
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
 * Register all volume management tools on the given MCP server.
 *
 * Registers:
 * - `list_volumes`  — List all container volumes
 * - `create_volume` — Create a new named volume
 * - `delete_volume` — Remove one or more volumes
 *
 * @param server - The MCP server instance to register tools on
 */
export function registerVolumeTools(server: McpServer): void {
  /**
   * list_volumes — List all container volumes.
   *
   * Runs `container volume ls` and returns the output in the requested format.
   * When format is 'json', the raw CLI output is parsed into structured data.
   */
  server.tool(
    'list_volumes',
    'List all container volumes. Returns volume names, drivers, mount points, and metadata.',
    {
      format: z
        .enum(['table', 'json'])
        .optional()
        .default('json')
        .describe('Output format: "json" for structured data or "table" for human-readable text'),
    },
    async ({ format }) => {
      try {
        const args: string[] = ['volume', 'ls'];

        if (format === 'json') {
          args.push('--format', 'json');
        }

        const stdout = await runContainerCommandStrict(args);

        if (format === 'json') {
          const parsed = safeJsonParse<unknown>(stdout);
          if (parsed !== null) {
            return buildSuccessResponse(parsed);
          }
          // If JSON parsing fails, return the raw output
          return buildSuccessResponse(stdout);
        }

        return buildSuccessResponse(stdout);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse('Failed to list volumes', { details: message });
      }
    },
  );

  /**
   * create_volume — Create a new container volume.
   *
   * Runs `container volume create [--opt size=<size>] <name>`.
   * Optionally accepts a size limit for the volume.
   */
  server.tool(
    'create_volume',
    'Create a new container volume with the given name and optional size limit.',
    {
      name: z
        .string()
        .describe('Volume name. Must be unique among existing volumes.'),
      size: z
        .string()
        .optional()
        .describe('Volume size limit (e.g. "10G", "500M"). Omit for unlimited.'),
    },
    async ({ name, size }) => {
      try {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
          return buildErrorResponse(
            `Invalid volume name: "${name}". Names must start with alphanumeric and contain only [a-zA-Z0-9_.-].`
          );
        }
        const args: string[] = ['volume', 'create'];

        if (size) {
          if (!/^\d+(\.\d+)?[KMGTkmgt][Bb]?$/.test(size)) {
            return buildErrorResponse(
              `Invalid size format: "${size}". Use a number followed by a unit, e.g. "10G", "500M", "2TB".`
            );
          }
          args.push('--opt', `size=${size}`);
        }

        args.push(name);

        const stdout = await runContainerCommandStrict(args);

        return buildSuccessResponse({
          message: `Volume "${name}" created successfully`,
          name,
          output: stdout.trim(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse(`Failed to create volume "${name}"`, {
          details: message,
        });
      }
    },
  );

  /**
   * delete_volume — Remove one or more container volumes.
   *
   * Runs `container volume rm [--force] <name1> <name2> ...`.
   * Accepts a list of volume names to remove in a single invocation.
   */
  server.tool(
    'delete_volume',
    'Remove one or more container volumes by name. Use force to remove volumes that are still in use.',
    {
      names: z
        .array(z.string().min(1))
        .min(1)
        .describe('List of volume names to remove. At least one name is required.'),
      force: z
        .boolean()
        .optional()
        .default(false)
        .describe('Force removal even if the volume is in use by a container'),
    },
    async ({ names, force }) => {
      try {
        for (const name of names) {
          if (!name.trim() || /[\s;|&`$]/.test(name)) {
            return buildErrorResponse(`Invalid name: "${name}". Names must not be empty or contain shell metacharacters.`);
          }
        }
        const args: string[] = ['volume', 'rm'];

        if (force) {
          args.push('--force');
        }

        args.push(...names);

        const stdout = await runContainerCommandStrict(args);

        return buildSuccessResponse({
          message: `Successfully removed ${names.length} volume(s)`,
          removed: names,
          output: stdout.trim(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse(`Failed to remove volume(s): ${names.join(', ')}`, {
          details: message,
        });
      }
    },
  );
}
