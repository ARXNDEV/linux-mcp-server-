#!/usr/bin/env node

/**
 * container-mcp — MCP server for Apple container CLI.
 *
 * Provides 24 tools for managing Linux containers on macOS via AI agents.
 * Supports Claude Desktop, Claude Code, Cursor, and any MCP-compatible client.
 *
 * @module container-mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from './utils/logger.js';
import { checkCliInstalled } from './utils/cli.js';
import { registerContainerTools } from './tools/containers.js';
import { registerImageTools } from './tools/images.js';
import { registerLogTools } from './tools/logs.js';
import { registerVolumeTools } from './tools/volumes.js';
import { registerNetworkTools } from './tools/networks.js';
import { registerSystemTools } from './tools/system.js';
import { registerDiagnosticsTools } from './tools/diagnostics.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

/**
 * Create and configure the MCP server with all tools registered.
 *
 * @returns Configured McpServer instance
 */
function createServer(): McpServer {
  const server = new McpServer({
    name: 'container-mcp',
    version,
  });

  let toolCount = 0;
  const originalTool = server.tool.bind(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool = (...args: any[]) => {
    toolCount++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return originalTool(...(args as any));
  };

  // Register all tool categories
  registerContainerTools(server);
  registerImageTools(server);
  registerLogTools(server);
  registerVolumeTools(server);
  registerNetworkTools(server);
  registerSystemTools(server);
  registerDiagnosticsTools(server);

  logger.info(`All ${toolCount} tools registered successfully`);

  return server;
}

/**
 * Main entry point — starts the MCP server with stdio transport.
 */
async function main(): Promise<void> {
  logger.info('Starting container-mcp server', { version });

  // Check if the container CLI is available
  try {
    await checkCliInstalled();
    logger.info('Container CLI found');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Container CLI check failed — tools will return errors when called', {
      error: message,
    });
    // Don't exit — let the server start so tools can return helpful errors
  }

  // Create and start the server
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  logger.info('container-mcp server running on stdio transport');
}

// Run the server
main().catch((error) => {
  logger.error('Fatal error starting container-mcp', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
