/**
 * Safe CLI executor for running `container` commands.
 * Uses execa with array arguments (never shell: true) for security.
 * @module utils/cli
 */

import { execa, type ExecaError } from 'execa';
import { logger } from './logger.js';
import type { CliResult, ToolError } from '../types.js';

/** Default timeout for CLI commands in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** The container CLI binary name. */
const CONTAINER_CLI = process.env['CONTAINER_CLI_PATH'] || 'container';

/**
 * Redact sensitive values from CLI args for safe logging.
 * Redacts the value after -e / --env flags (may contain secrets).
 */
const SENSITIVE_FLAGS = new Set(['-e', '--env', '--password', '--token', '--secret', '--registry-password']);

function redactArgs(args: string[]): string[] {
  return args.map((arg, i) => {
    const prev = args[i - 1];
    // Redact value that follows a sensitive flag
    if (prev && SENSITIVE_FLAGS.has(prev)) {
      const eqIdx = arg.indexOf('=');
      return eqIdx !== -1 ? arg.substring(0, eqIdx + 1) + '***' : '***';
    }
    // Redact --flag=value single-arg form
    for (const flag of SENSITIVE_FLAGS) {
      if (arg.startsWith(flag + '=')) {
        return arg.substring(0, flag.length + 1) + '***';
      }
    }
    return arg;
  });
}

/**
 * Check if the `container` CLI is installed and accessible.
 * @returns true if the CLI is available
 * @throws Error with a helpful message if the CLI is not found
 */
export async function checkCliInstalled(): Promise<boolean> {
  try {
    await execa(CONTAINER_CLI, ['--version'], { timeout: 5_000 });
    return true;
  } catch (error) {
    const err = error as ExecaError;
    if (err.code === 'ENOENT') {
      throw new Error(
        `The '${CONTAINER_CLI}' CLI is not installed or not in PATH.\n` +
          'Apple container requires macOS 26+ on Apple Silicon.\n' +
          'Install it from: https://github.com/apple/container\n' +
          'Or set CONTAINER_CLI_PATH environment variable to the binary location.',
      );
    }
    // CLI exists but errored — still considered installed
    return true;
  }
}

/**
 * Execute a `container` CLI command safely.
 *
 * @param args - Array of arguments to pass to the container CLI
 * @param options - Optional configuration
 * @param options.timeout - Timeout in milliseconds (default: 30000)
 * @param options.input - Optional stdin input
 * @returns The CLI result with stdout, stderr, and exit code
 * @throws Error with structured information on failure
 *
 * @example
 * ```typescript
 * const result = await runContainerCommand(['ls', '--all', '--format', 'json']);
 * ```
 */
export async function runContainerCommand(
  args: string[],
  options: {
    timeout?: number;
    input?: string;
  } = {},
): Promise<CliResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const safeCommandStr = `${CONTAINER_CLI} ${redactArgs(args).join(' ')}`;

  logger.debug('Executing command', { command: safeCommandStr, timeout });

  try {
    const result = await execa(CONTAINER_CLI, args, {
      timeout,
      input: options.input,
      reject: false,
      stripFinalNewline: true,
    });

    const cliResult: CliResult = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? -1,
    };

    if (result.exitCode !== 0) {
      logger.warn('Command exited with non-zero code', {
        command: safeCommandStr,
        exitCode: result.exitCode,
        stderr: result.stderr,
      });
    } else {
      logger.debug('Command succeeded', { command: safeCommandStr });
    }

    return cliResult;
  } catch (error) {
    const err = error as ExecaError;
    logger.error('Command execution failed', {
      command: safeCommandStr,
      error: err.message,
    });

    if (err.code === 'ENOENT') {
      throw new Error(
        `The '${CONTAINER_CLI}' CLI is not installed or not in PATH.\n` +
          'Apple container requires macOS 26+ on Apple Silicon.\n' +
          'Install it from: https://github.com/apple/container',
      );
    }

    if (err.timedOut) {
      throw new Error(
        `Command timed out after ${timeout}ms: ${safeCommandStr}\n` +
          'Try increasing the timeout or check if the container daemon is responsive.',
      );
    }

    if (err.isCanceled) {
      throw new Error(`Command was canceled: ${safeCommandStr}`);
    }

    throw new Error(`Command failed: ${safeCommandStr}\n${err.message}`);
  }
}

/**
 * Execute a container command and require success (exit code 0).
 * Returns only stdout on success, throws a structured error on failure.
 *
 * @param args - Array of arguments
 * @param options - Optional configuration
 * @returns stdout string on success
 */
export async function runContainerCommandStrict(
  args: string[],
  options: {
    timeout?: number;
    input?: string;
  } = {},
): Promise<string> {
  const result = await runContainerCommand(args, options);

  if (result.exitCode !== 0) {
    const safeCommandStr = `${CONTAINER_CLI} ${redactArgs(args).join(' ')}`;
    const error = mapCliError(result, safeCommandStr);
    throw new Error(formatToolError(error));
  }

  return result.stdout;
}

/**
 * Map a failed CLI result to a structured ToolError.
 * Analyzes stderr to provide meaningful error categories.
 *
 * @param result - The CLI execution result
 * @param command - The command string for context
 * @returns A structured ToolError
 */
export function mapCliError(result: CliResult, command: string): ToolError {
  const stderr = result.stderr.toLowerCase();

  // Container not found
  if (stderr.includes('no such container') || stderr.includes('not found')) {
    return {
      error: 'Container or resource not found',
      command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      hint: 'Verify the container/image name with list_containers or list_images.',
    };
  }

  // Permission error
  if (stderr.includes('permission denied') || stderr.includes('access denied')) {
    return {
      error: 'Permission denied',
      command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      hint: 'Check that you have the necessary permissions to run container commands.',
    };
  }

  // Image not found / pull failure
  if (stderr.includes('manifest unknown') || stderr.includes('pull access denied')) {
    return {
      error: 'Image not found or pull access denied',
      command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      hint: 'Verify the image reference and check if authentication is required.',
    };
  }

  // Port conflict
  if (stderr.includes('port is already allocated') || stderr.includes('address already in use')) {
    return {
      error: 'Port conflict — the port is already in use',
      command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      hint: 'Choose a different host port or stop the service using the conflicting port.',
    };
  }

  // Generic error
  return {
    error: `Command failed with exit code ${result.exitCode}`,
    command,
    exitCode: result.exitCode,
    stderr: result.stderr,
  };
}

/**
 * Format a ToolError into a human-readable string.
 *
 * @param toolError - The structured error
 * @returns Formatted error message
 */
export function formatToolError(toolError: ToolError): string {
  let msg = `Error: ${toolError.error}`;
  if (toolError.command) msg += `\nCommand: ${toolError.command}`;
  if (toolError.exitCode !== undefined) msg += `\nExit code: ${toolError.exitCode}`;
  if (toolError.stderr) msg += `\nDetails: ${toolError.stderr}`;
  if (toolError.hint) msg += `\nHint: ${toolError.hint}`;
  return msg;
}

/**
 * Build a structured error response for MCP tool output.
 *
 * @param message - Error message
 * @param details - Optional additional details
 * @returns MCP-compatible error response object
 */
export function buildErrorResponse(
  message: string,
  details?: Record<string, unknown>,
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const errorObj = { error: message, ...details };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(errorObj, null, 2) }],
    isError: true,
  };
}

/**
 * Build a successful MCP tool response.
 *
 * @param data - The response data (will be JSON stringified if not a string)
 * @returns MCP-compatible success response object
 */
export function buildSuccessResponse(
  data: unknown,
): { content: Array<{ type: 'text'; text: string }> } {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: 'text' as const, text }],
  };
}


/**
 * Check that `resolvedPath` is inside `safeRoot`.
 * Uses a trailing-slash check to prevent prefix collisions
 * (e.g. root=/Users/aru must not match /Users/arumight).
 */
export function isWithinSafeRoot(resolvedPath: string, safeRoot: string): boolean {
  const normalRoot = safeRoot.endsWith('/') ? safeRoot : safeRoot + '/';
  return resolvedPath === safeRoot.replace(/\/+$/, '') || resolvedPath.startsWith(normalRoot);
}
