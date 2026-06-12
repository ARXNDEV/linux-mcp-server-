/**
 * Tests for network and volume management tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runContainerCommandStrict } from '../src/utils/cli.js';
import { registerNetworkTools } from '../src/tools/networks.js';
import { registerVolumeTools } from '../src/tools/volumes.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../src/utils/cli.js', () => ({
  runContainerCommandStrict: vi.fn(),
  runContainerCommand: vi.fn(),
  buildSuccessResponse: vi.fn((data) => ({
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  })),
  buildErrorResponse: vi.fn((msg, details) => ({
    content: [{ type: 'text', text: JSON.stringify({ error: msg, ...details }, null, 2) }],
    isError: true,
  })),
}));

const mockedRunStrict = vi.mocked(runContainerCommandStrict);

function getNetworkHandler(toolName: string) {
  const mockServer = { tool: vi.fn() };
  registerNetworkTools(mockServer as unknown as McpServer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = mockServer.tool.mock.calls.find((c: any[]) => c[0] === toolName);
  if (!call) throw new Error(`Tool ${toolName} not registered`);
  return call[3];
}

function getVolumeHandler(toolName: string) {
  const mockServer = { tool: vi.fn() };
  registerVolumeTools(mockServer as unknown as McpServer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = mockServer.tool.mock.calls.find((c: any[]) => c[0] === toolName);
  if (!call) throw new Error(`Tool ${toolName} not registered`);
  return call[3];
}

describe('Network Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create_network', () => {
    it('should reject invalid name (starts with dash)', async () => {
      const handler = getNetworkHandler('create_network');
      const res = await handler({ name: '-invalid' }, {});
      expect(res.isError).toBe(true);
    });

    it('should call CLI with valid name and driver', async () => {
      const handler = getNetworkHandler('create_network');
      mockedRunStrict.mockResolvedValue('');
      await handler({ name: 'mynet', driver: 'bridge' }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['network', 'create', '--driver', 'bridge', 'mynet']);
    });

    it('should include options', async () => {
      const handler = getNetworkHandler('create_network');
      mockedRunStrict.mockResolvedValue('');
      await handler({ name: 'mynet', options: { key: 'val' } }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['network', 'create', '--opt', 'key=val', 'mynet']);
    });
  });

  describe('delete_network', () => {
    it('should call CLI to remove networks', async () => {
      const handler = getNetworkHandler('delete_network');
      mockedRunStrict.mockResolvedValue('');
      await handler({ networks: ['mynet1', 'mynet2'] }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['network', 'rm', 'mynet1', 'mynet2']);
    });

    it('should reject name with metachar', async () => {
      const handler = getNetworkHandler('delete_network');
      const res = await handler({ networks: ['net; rm -rf /'] }, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('shell metacharacters');
    });
  });

  describe('list_networks', () => {
    it('should call CLI with json format', async () => {
      const handler = getNetworkHandler('list_networks');
      mockedRunStrict.mockResolvedValue('[]');
      await handler({ format: 'json' }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['network', 'ls', '--format', 'json']);
    });
  });
});

describe('Volume Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create_volume', () => {
    it('should reject invalid name', async () => {
      const handler = getVolumeHandler('create_volume');
      const res = await handler({ name: '-invalid' }, {});
      expect(res.isError).toBe(true);
    });

    it('should reject invalid size format', async () => {
      const handler = getVolumeHandler('create_volume');
      const res = await handler({ name: 'myvol', size: '10Z' }, {});
      expect(res.isError).toBe(true);
    });

    it('should call CLI with valid size', async () => {
      const handler = getVolumeHandler('create_volume');
      mockedRunStrict.mockResolvedValue('');
      await handler({ name: 'myvol', size: '10G' }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['volume', 'create', '--opt', 'size=10G', 'myvol']);
    });
  });

  describe('delete_volume', () => {
    it('should reject name with metachar', async () => {
      const handler = getVolumeHandler('delete_volume');
      const res = await handler({ names: ['vol; rm -rf /'] }, {});
      expect(res.isError).toBe(true);
    });

    it('should include force flag', async () => {
      const handler = getVolumeHandler('delete_volume');
      mockedRunStrict.mockResolvedValue('');
      await handler({ names: ['myvol'], force: true }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['volume', 'rm', '--force', 'myvol']);
    });
  });
});
