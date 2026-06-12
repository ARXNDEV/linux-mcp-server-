/**
 * @fileoverview Container lifecycle management tools for the Apple Container MCP server.
 *
 * Registers 8 MCP tools that wrap the `container` CLI to provide full
 * container lifecycle management:
 *   1. list_containers   — enumerate containers (running or all)
 *   2. run_container     — create and start a container from an OCI image
 *   3. stop_container    — gracefully stop one or more running containers
 *   4. start_container   — start one or more previously stopped containers
 *   5. delete_container  — remove one or more containers
 *   6. inspect_container — retrieve detailed metadata for a single container
 *   7. exec_in_container — execute a command inside a running container
 *   8. container_commit   — commit a container's current state to a new image
 *
 * @module tools/containers
 */

import { resolve } from 'path';
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

function parseShellArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      // Preserve empty string args — push empty token marker
      if (!inSingle && current === '' && args.length >= 0) {
        current = '\x00EMPTY\x00';
      }
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      if (!inDouble && current === '') {
        current = '\x00EMPTY\x00';
      }
    } else if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current) {
        args.push(current === '\x00EMPTY\x00' ? '' : current);
        current = '';
      }
    } else if (ch === '\\' && i + 1 < input.length) {
      // inside double quotes: only \" \\ \$ \` are special
      if (inDouble) {
        const next = input[i + 1]!;
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          current += next;
          i++;
        } else {
          current += ch; // keep the backslash literally
        }
      } else if (!inSingle) {
        // outside any quotes: backslash escapes the next character
        current += input[i + 1]!;
        i++;
      } else {
        // inside single quotes: backslash is literal
        current += ch;
      }
    } else {
      current += ch;
    }
  }

  if (inSingle || inDouble) {
    throw new Error(`Unclosed quote in command string: ${input}`);
  }

  if (current) {
    args.push(current === '\x00EMPTY\x00' ? '' : current);
  }

  return args;
}

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
        .describe('Run in background (detached mode). WARNING: setting false runs the container in the foreground and will time out after 30 seconds — only use for short-lived commands.'),
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

        if (name && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
          return buildErrorResponse(
            `Invalid container name: "${name}". Names must start with alphanumeric and contain only [a-zA-Z0-9_.-].`
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

        if (volumes) {
          for (const mount of volumes) {
            if (!/^[^:]+:[^:]+$/.test(mount)) {
              return buildErrorResponse(
                `Invalid volume mount: "${mount}". Expected format is host_path:container_path (e.g. "/data:/app/data").`
              );
            }
            const [hostPath] = mount.split(':');
            const resolvedHost = resolve(hostPath!);
            if (resolvedHost !== hostPath!.replace(/\/+$/, '') && hostPath!.includes('..')) {
              return buildErrorResponse(
                `Invalid volume mount: "${mount}". Path traversal (..) is not allowed.`
              );
            }
            // Stronger check: ensure resolved host path doesn't escape a safe root
            const safeRoot = process.env['CONTAINER_MCP_VOLUME_ROOT'] ?? '/';
            if (!resolvedHost.startsWith(safeRoot)) {
              return buildErrorResponse(
                `Volume host path "${resolvedHost}" is outside the allowed root ("${safeRoot}").`
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

        // Optional command — parse using shell rules to respect quotes
        if (command) {
          try {
            args.push(...parseShellArgs(command));
          } catch (e) {
            return buildErrorResponse(
              `Invalid command string: ${e instanceof Error ? e.message : String(e)}`
            );
          }
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
        .int()
        .min(0)
        .optional()
        .describe('Seconds to wait before forcefully killing the container (must be a non-negative integer)'),
    },
    async ({ names, timeout }) => {
      try {
        for (const name of names) {
          if (!name.trim() || /[\s;|&`$]/.test(name)) {
            return buildErrorResponse(`Invalid name: "${name}". Names must not be empty or contain shell metacharacters.`);
          }
        }
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
        for (const name of names) {
          if (!name.trim() || /[\s;|&`$]/.test(name)) {
            return buildErrorResponse(`Invalid name: "${name}". Names must not be empty or contain shell metacharacters.`);
          }
        }
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
        for (const name of names) {
          if (!name.trim() || /[\s;|&`$]/.test(name)) {
            return buildErrorResponse(`Invalid name: "${name}". Names must not be empty or contain shell metacharacters.`);
          }
        }
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
        } catch (firstErr) {
          const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
          // Only retry if the error looks like an unsupported flag, not a missing container
          if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('no such')) {
            throw firstErr;
          }
          // Fall back to plain invocation (CLI may not support --format on inspect)
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
      command: z.string().min(1).describe('Command to execute inside the container'),
      interactive: z
        .boolean()
        .optional()
        .default(false)
        .describe('Attach stdin (-i flag). Note: no TTY is allocated in MCP context — commands requiring a terminal (bash, python REPL) may behave unexpectedly.'),
    },
    async ({ name, command, interactive }) => {
      try {
        const args: string[] = ['exec'];

        if (interactive) {
          args.push('-i');
        }

        args.push(name);

        // Parse command string using shell rules
        let commandParts: string[];
        try {
          commandParts = parseShellArgs(command);
        } catch (e) {
          return buildErrorResponse(
            `Invalid command string: ${e instanceof Error ? e.message : String(e)}`
          );
        }
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

  // ---------------------------------------------------------------------------
  // 8. container_commit
  // ---------------------------------------------------------------------------

  /**
   * Commit a container's current state to a new image.
   */
  server.tool(
    'container_commit',
    "Commit a container's current state to a new image",
    {
      container: z.string().describe('Container ID or name'),
      image: z.string().describe('New image name (e.g. myapp:v2)'),
      message: z.string().optional().describe('Optional commit message'),
    },
    async ({ container, image, message }) => {
      try {
        if (!isValidOciName(image)) {
          return buildErrorResponse(`Invalid image name: "${image}"`, {
            hint: 'Image names must follow OCI naming conventions, e.g. "myapp:v2".',
          });
        }
        const args = ['commit'];
        if (message) {
          args.push('--message', message);
        }
        args.push(container, image);

        const stdout = await runContainerCommandStrict(args);

        return buildSuccessResponse({
          container,
          image,
          output: stdout.trim(),
          message: `Committed container "${container}" to image "${image}" successfully`,
        });
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return buildErrorResponse(`Failed to commit container "${container}"`, { details: errMsg });
      }
    },
  );
}
