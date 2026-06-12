/**
 * Image management tools for the Apple `container` CLI MCP server.
 *
 * Provides five MCP tools for working with OCI images:
 * - **list_images** — Enumerate all locally cached images
 * - **pull_image** — Pull an image from a remote registry
 * - **build_image** — Build an image from a Dockerfile and build context
 * - **remove_image** — Delete one or more local images
 * - **inspect_image** — Retrieve detailed metadata for an image
 *
 * @module tools/images
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  runContainerCommandStrict,
  buildSuccessResponse,
  buildErrorResponse,
} from '../utils/cli.js';
import { isValidOciName, safeJsonParse } from '../utils/parser.js';

/* ------------------------------------------------------------------ */
/*  Zod schemas (declared once for reuse & readability)               */
/* ------------------------------------------------------------------ */

/** Schema for {@link listImages}. */
const ListImagesSchema = {
  format: z
    .enum(['table', 'json'])
    .optional()
    .default('json')
    .describe('Output format — "json" returns structured data, "table" returns raw CLI output'),
};

/** Schema for {@link pullImage}. */
const PullImageSchema = {
  reference: z
    .string()
    .describe('Fully-qualified image reference to pull, e.g. "docker.io/library/ubuntu:latest"'),
};

/** Schema for {@link buildImage}. */
const BuildImageSchema = {
  context: z.string().describe('Path to the build context directory'),
  tag: z.string().describe('Tag to assign to the built image, e.g. "myapp:1.0"'),
  dockerfile: z
    .string()
    .optional()
    .describe('Path to the Dockerfile (relative to context or absolute). Defaults to "<context>/Dockerfile"'),
  buildArgs: z
    .record(z.string())
    .optional()
    .describe('Build-time variables as key/value pairs, e.g. { "NODE_ENV": "production" }'),
  platform: z
    .string()
    .optional()
    .describe('Target platform in os/arch format, e.g. "linux/arm64"'),
};

/** Schema for {@link removeImage}. */
const RemoveImageSchema = {
  references: z
    .array(z.string())
    .min(1)
    .describe('One or more image references (name, id, or name:tag) to remove'),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe('Force removal even if the image is in use by a container'),
};

/** Schema for {@link inspectImage}. */
const InspectImageSchema = {
  reference: z.string().describe('Image reference to inspect (name, id, or name:tag)'),
};

/* ------------------------------------------------------------------ */
/*  Tool handlers                                                     */
/* ------------------------------------------------------------------ */

/**
 * List all locally available container images.
 *
 * When `format` is `"json"` the handler asks the CLI for JSON output and
 * returns the parsed array directly; when `"table"` it returns the raw
 * human-readable table produced by the CLI.
 *
 * @param params          - Validated tool parameters
 * @param params.format   - `"json"` (default) or `"table"`
 * @returns MCP tool response containing the image list
 */
async function listImages(params: { format: string }): Promise<ReturnType<typeof buildSuccessResponse>> {
  try {
    const args: string[] = ['images'];

    if (params.format === 'json') {
      args.push('--format', 'json');
    }

    const stdout = await runContainerCommandStrict(args);

    if (params.format === 'json') {
      const parsed = safeJsonParse<unknown[]>(stdout, []);
      return buildSuccessResponse(parsed);
    }

    return buildSuccessResponse(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildErrorResponse('Failed to list images', { details: message });
  }
}

/**
 * Pull an image from a remote OCI-compatible registry.
 *
 * The reference is validated against OCI naming rules before the pull is
 * attempted. A generous 120 s timeout is used because large images may
 * take a while to download.
 *
 * @param params             - Validated tool parameters
 * @param params.reference   - Image reference, e.g. `"ubuntu:latest"`
 * @returns MCP tool response with pull output or an error
 */
async function pullImage(params: { reference: string }): Promise<ReturnType<typeof buildSuccessResponse>> {
  try {
    if (!isValidOciName(params.reference)) {
      return buildErrorResponse('Invalid image reference', {
        reference: params.reference,
        hint: 'Image references must start with an alphanumeric character and may contain [a-zA-Z0-9._-/:@].',
      });
    }

    const stdout = await runContainerCommandStrict(
      ['pull', params.reference],
      { timeout: 120_000 },
    );

    return buildSuccessResponse({
      message: `Successfully pulled image: ${params.reference}`,
      output: stdout,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildErrorResponse(`Failed to pull image "${params.reference}"`, {
      details: message,
    });
  }
}

/**
 * Build an image from a Dockerfile and a build context directory.
 *
 * Constructs the full `container build` invocation from the supplied
 * parameters, including optional Dockerfile path, build arguments and
 * target platform.  A 300 s timeout is used because image builds can be
 * very slow depending on the number of layers and network speed.
 *
 * @param params              - Validated tool parameters
 * @param params.context      - Build context directory path
 * @param params.tag          - Image tag, e.g. `"myapp:1.0"`
 * @param params.dockerfile   - Optional path to a Dockerfile
 * @param params.buildArgs    - Optional `Record<string, string>` of build-time variables
 * @param params.platform     - Optional target platform string
 * @returns MCP tool response with build output or an error
 */
async function buildImage(params: {
  context: string;
  tag: string;
  dockerfile?: string;
  buildArgs?: Record<string, string>;
  platform?: string;
}): Promise<ReturnType<typeof buildSuccessResponse>> {
  try {
    const args: string[] = ['build', '-t', params.tag];

    /* Optional Dockerfile path ---------------------------------------- */
    if (params.dockerfile) {
      args.push('--file', params.dockerfile);
    }

    /* Optional build arguments ---------------------------------------- */
    if (params.buildArgs) {
      for (const [key, value] of Object.entries(params.buildArgs)) {
        args.push('--build-arg', `${key}=${value}`);
      }
    }

    /* Optional platform ----------------------------------------------- */
    if (params.platform) {
      args.push('--platform', params.platform);
    }

    /* Build context must be the last positional argument --------------- */
    args.push(params.context);

    const stdout = await runContainerCommandStrict(args, { timeout: 300_000 });

    return buildSuccessResponse({
      message: `Successfully built image with tag: ${params.tag}`,
      output: stdout,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildErrorResponse(`Failed to build image "${params.tag}"`, {
      details: message,
    });
  }
}

/**
 * Remove one or more images from the local store.
 *
 * Optionally forces removal even if an image is currently referenced by
 * a container.  All supplied references are removed in a single CLI call.
 *
 * @param params              - Validated tool parameters
 * @param params.references   - Array of image references to remove
 * @param params.force        - Force removal (default `false`)
 * @returns MCP tool response confirming removal or describing an error
 */
async function removeImage(params: {
  references: string[];
  force: boolean;
}): Promise<ReturnType<typeof buildSuccessResponse>> {
  try {
    const args: string[] = ['rmi'];

    if (params.force) {
      args.push('--force');
    }

    args.push(...params.references);

    const stdout = await runContainerCommandStrict(args);

    return buildSuccessResponse({
      message: `Successfully removed image(s): ${params.references.join(', ')}`,
      output: stdout,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildErrorResponse('Failed to remove image(s)', {
      references: params.references,
      details: message,
    });
  }
}

/**
 * Inspect an image and return its detailed JSON metadata.
 *
 * The raw JSON output from `container image inspect` is parsed and
 * returned.  This typically includes the image config (environment
 * variables, entrypoint, command), layer information, platform details,
 * and creation timestamps.
 *
 * @param params             - Validated tool parameters
 * @param params.reference   - Image reference to inspect
 * @returns MCP tool response with parsed image metadata or an error
 */
async function inspectImage(params: { reference: string }): Promise<ReturnType<typeof buildSuccessResponse>> {
  try {
    const stdout = await runContainerCommandStrict(
      ['image', 'inspect', params.reference],
    );

    const parsed = safeJsonParse<Record<string, unknown>>(stdout, null);

    if (parsed !== null) {
      return buildSuccessResponse(parsed);
    }

    /* Fallback: return the raw output when the CLI doesn't emit JSON. */
    return buildSuccessResponse(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildErrorResponse(`Failed to inspect image "${params.reference}"`, {
      details: message,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Registration                                                      */
/* ------------------------------------------------------------------ */

/**
 * Register all image-management tools with the given MCP server instance.
 *
 * This function is the single public entry-point for the module.  Call it
 * once during server bootstrap to expose the five image tools to MCP
 * clients.
 *
 * @param server - An initialised {@link McpServer} instance
 *
 * @example
 * ```typescript
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 * import { registerImageTools } from './tools/images.js';
 *
 * const server = new McpServer({ name: 'container', version: '1.0.0' });
 * registerImageTools(server);
 * ```
 */
export function registerImageTools(server: McpServer): void {
  /* ── list_images ─────────────────────────────────────────────── */
  server.tool(
    'list_images',
    'List all locally cached container images. Returns image names, tags, IDs, and sizes.',
    ListImagesSchema,
    async (params) => listImages(params),
  );

  /* ── pull_image ──────────────────────────────────────────────── */
  server.tool(
    'pull_image',
    'Pull an image from a remote OCI-compatible registry (e.g. Docker Hub, GHCR).',
    PullImageSchema,
    async (params) => pullImage(params),
  );

  /* ── build_image ─────────────────────────────────────────────── */
  server.tool(
    'build_image',
    'Build a container image from a Dockerfile and build context directory.',
    BuildImageSchema,
    async (params) => buildImage(params),
  );

  /* ── remove_image ────────────────────────────────────────────── */
  server.tool(
    'remove_image',
    'Remove one or more images from the local image store. Supports forced removal.',
    RemoveImageSchema,
    async (params) => removeImage(params),
  );

  /* ── inspect_image ───────────────────────────────────────────── */
  server.tool(
    'inspect_image',
    'Get detailed metadata for an image including layers, environment variables, entrypoint, and platform information.',
    InspectImageSchema,
    async (params) => inspectImage(params),
  );
}
