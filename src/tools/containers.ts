/**
 * @fileoverview Container lifecycle management tools for the Apple Container MCP server.
 *
 * Registers 7 MCP tools that wrap the `container` CLI to provide full
 * container lifecycle management:
 *   1. list_containers   — enumerate containers (running or all)
 *   2. run_container     — create and start a container from an OCI image
 *   3. stop_container    — gracefully stop one or more running containers
 *   4. start_container   — start one or more previously stopped containers
 *   5. delete_container  — remove one or more containers
 *   6. inspect_container — retrieve detailed metadata for a single container
 *   7. exec_in_container — execute a command inside a running container
 *
 * @module tools/containers
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  runContainerCommandStrict,
  runContainerCommand,
  buildSuccessResponse,
  buildErrorResponse,
} from '../utils/cli.js';

import {
  isValidOciName,
  isValidPortMapping,
  isValidEnvVar,
  safeJsonParse,
  parseTableOutput,
} from '../utils/parser.js';

/**
 * Register all container-lifecycle tools on the given MCP server instance.
 *
 * Each tool follows a consistent pattern:
 *  - Validate user-supplied inputs before touching the CLI.
 *  - Build an argument array for the `container` CLI.
 *  - Execute via {@link runContainerCommandStrict}.
 *  - Return structured output through {@link buildSuccessResponse} /
 *    {@link buildErrorResponse}.
 *
 * @param server — An initialised {@link McpServer} instance to register tools on.
 */
export function registerContainerTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // 1. list_containers
  // ---------------------------------------------------------------------------

  /**
   * List containers known to the local container runtime.
   *
   * By default only running containers are shown; set `all: true` to include
   * stopped / exited containers as well.  Output can be returned as parsed JSON
   * or as a human-readable table.
   */
  server.tool(
    'list_containers',
    'List all containers managed by the Apple container runtime',
    {
      all: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include stopped containers'),
      format: z
        .enum(['table', 'json'])
        .optional()
        .default('json')
        .describe('Output format'),
    },
    async ({ all, format }) => {
      try {
        const args: string[] = ['ls'];

        if (all) {
          args.push('--all');
        }

        if (format === 'json') {
          args.push('--format', 'json');
        }

        const stdout = await runContainerCommandStrict(args);

        if (format === 'json') {
          const parsed = safeJsonParse(stdout);
          return buildSuccessResponse(parsed ?? stdout);
        }

        // Table format — parse into structured rows for convenience.
        const rows = parseTableOutput(stdout);
        return buildSuccessResponse(rows);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse('Failed to list containers', { details: message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 2. run_container
  // ---------------------------------------------------------------------------

  /**
   * Create and run a new container from an OCI image.
   *
   * Supports port mappings (`-p`), environment variables (`-e`), volume
   * mounts (`-v`), detached mode (`-d`), an optional container name, and an
   * optional override command.
   */
  server.tool(
    'run_container',
    'Create and run a new container from an image',
    {
      image: z.string().describe('Image to run (e.g. "docker.io/library/nginx:latest")'),
      name: z.string().optional().describe('Container name'),
      ports: z
        .array(z.string())
        .optional()
        .describe('Port mappings in host:container format (e.g. "8080:80")'),
      env: z
        .array(z.string())
        .optional()
        .describe('Environment variables in KEY=value format'),
      volumes: z
        .array(z.string())
        .optional()
        .describe('Volume mounts in host:container format'),
      detach: z
        .boolean()
        .optional()
        .default(true)
        .describe('Run in background (detached mode)'),
      command: z
        .string()
        .optional()
        .describe('Command to run inside the container'),
    },
    async ({ image, name, ports, env, volumes, detach, command }) => {
      try {
        // -- Input validation -------------------------------------------------

        if (!isValidOciName(image)) {
          return buildErrorResponse(
            `Invalid OCI image reference: "${image}". ` +
              'Image names must follow the OCI naming convention.',
          );
        }

        if (ports) {
          for (const mapping of ports) {
            if (!isValidPortMapping(mapping)) {
              return buildErrorResponse(
                `Invalid port mapping: "${mapping}". ` +
                  'Expected format is host_port:container_port (e.g. "8080:80").',
              );
            }
          }
        }

        if (env) {
          for (const variable of env) {
            if (!isValidEnvVar(variable)) {
              return buildErrorResponse(
                `Invalid environment variable: "${variable}". ` +
                  'Expected format is KEY=value.',
              );
            }
          }
        }

        // -- Build argument list ----------------------------------------------

        const args: string[] = ['run'];

        if (name) {
          args.push('--name', name);
        }

        if (ports) {
          for (const mapping of ports) {
            args.push('-p', mapping);
          }
        }

        if (env) {
          for (const variable of env) {
            args.push('-e', variable);
          }
        }

        if (volumes) {
          for (const mount of volumes) {
            args.push('-v', mount);
          }
        }

        if (detach) {
          args.push('-d');
        }

        // Image must come after all flags.
        args.push(image);

        // Optional command — split by whitespace so users can pass
        // multi-word commands as a single string (e.g. "sh -c 'echo hi'").
        if (command) {
          args.push(...command.split(/\s+/).filter(Boolean));
        }

        // -- Execute ----------------------------------------------------------

        const stdout = await runContainerCommandStrict(args);

        return buildSuccessResponse({
          containerId: stdout.trim(),
          image,
          detach,
          message: 'Container started successfully',
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse('Failed to run container', { details: message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 3. stop_container
  // ---------------------------------------------------------------------------

  /**
   * Stop one or more running containers.
   *
   * An optional timeout (in seconds) controls how long the runtime waits
   * before forcefully killing the container process.
   */
  server.tool(
    'stop_container',
    'Stop one or more running containers',
    {
      names: z
        .array(z.string())
        .min(1)
        .describe('Container names or IDs to stop'),
      timeout: z
        .number()
        .optional()
        .describe('Seconds to wait before forcefully killing the container'),
    },
    async ({ names, timeout }) => {
      try {
        const args: string[] = ['stop'];

        if (timeout !== undefined) {
          args.push('--timeout', String(timeout));
        }

        args.push(...names);

        const stdout = await runContainerCommandStrict(args);

        return buildSuccessResponse({
          stopped: names,
          output: stdout.trim(),
          message: `Stopped ${names.length} container(s) successfully`,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse('Failed to stop container(s)', { details: message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 4. start_container
  // ---------------------------------------------------------------------------

  /**
   * Start one or more previously stopped containers.
   */
  server.tool(
    'start_container',
    'Start one or more stopped containers',
    {
      names: z
        .array(z.string())
        .min(1)
        .describe('Container names or IDs to start'),
    },
    async ({ names }) => {
      try {
        const args: string[] = ['start', ...names];

        const stdout = await runContainerCommandStrict(args);

        return buildSuccessResponse({
          started: names,
          output: stdout.trim(),
          message: `Started ${names.length} container(s) successfully`,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse('Failed to start container(s)', { details: message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 5. delete_container
  // ---------------------------------------------------------------------------

  /**
   * Remove one or more containers.
   *
   * Use `force: true` to remove a running container without stopping it first.
   */
  server.tool(
    'delete_container',
    'Remove one or more containers',
    {
      names: z
        .array(z.string())
        .min(1)
        .describe('Container names or IDs to remove'),
      force: z
        .boolean()
        .optional()
        .default(false)
        .describe('Force removal of running containers'),
    },
    async ({ names, force }) => {
      try {
        const args: string[] = ['rm'];

        if (force) {
          args.push('--force');
        }

        args.push(...names);

        const stdout = await runContainerCommandStrict(args);

        return buildSuccessResponse({
          deleted: names,
          output: stdout.trim(),
          message: `Removed ${names.length} container(s) successfully`,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse('Failed to remove container(s)', { details: message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 6. inspect_container
  // ---------------------------------------------------------------------------

  /**
   * Retrieve detailed metadata for a single container.
   *
   * The CLI is asked for JSON output; the result is parsed into a structured
   * object so downstream consumers can work with typed data.
   */
  server.tool(
    'inspect_container',
    'Get detailed information about a specific container',
    {
      name: z.string().describe('Container name or ID to inspect'),
    },
    async ({ name }) => {
      try {
        const args: string[] = ['inspect', name, '--format', 'json'];

        let stdout: string;
        try {
          stdout = await runContainerCommandStrict(args);
        } catch {
          // Some versions of the CLI may not support --format on inspect.
          // Fall back to the plain invocation.
          stdout = await runContainerCommandStrict(['inspect', name]);
        }

        const parsed = safeJsonParse(stdout);

        return buildSuccessResponse(parsed ?? stdout.trim());
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse(
          `Failed to inspect container "${name}"`,
          { details: message },
        );
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 7. exec_in_container
  // ---------------------------------------------------------------------------

  /**
   * Execute a command inside a running container.
   *
   * The command string is split by whitespace so that multi-argument commands
   * work naturally (e.g. `"ls -la /app"`).  Set `interactive: true` to attach
   * an interactive session (`-i` flag).
   *
   * Both stdout and stderr are captured and returned together.
   */
  server.tool(
    'exec_in_container',
    'Execute a command inside a running container',
    {
      name: z.string().describe('Container name or ID'),
      command: z.string().describe('Command to execute inside the container'),
      interactive: z
        .boolean()
        .optional()
        .default(false)
        .describe('Run in interactive mode'),
    },
    async ({ name, command, interactive }) => {
      try {
        const args: string[] = ['exec'];

        if (interactive) {
          args.push('-i');
        }

        args.push(name);

        // Split the command string into individual tokens.
        const commandParts = command.split(/\s+/).filter(Boolean);
        if (commandParts.length === 0) {
          return buildErrorResponse('Command must not be empty');
        }
        args.push(...commandParts);

        // Use runContainerCommand (non-strict) to capture both stdout and stderr
        const result = await runContainerCommand(args);

        if (result.exitCode !== 0) {
          return buildErrorResponse(`Command exited with code ${result.exitCode}`, {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          });
        }

        // Combine stdout and stderr so the caller gets the full picture.
        const combinedOutput = [result.stdout, result.stderr]
          .map((s) => s.trim())
          .filter(Boolean)
          .join('\n');

        return buildSuccessResponse({
          output: combinedOutput,
          exitCode: 0,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResponse(
          `Failed to execute command in container "${name}"`,
          { details: message },
        );
      }
    },
  );
}
