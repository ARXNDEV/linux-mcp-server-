import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runContainerCommandStrict } from '../src/utils/cli.js';
import { registerSystemTools } from '../src/tools/system.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../src/utils/cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/cli.js')>();
  return {
    ...actual,
    runContainerCommandStrict: vi.fn(),
    runContainerCommand: vi.fn(),
    buildSuccessResponse: vi.fn((data) => ({
      content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
    })),
    buildErrorResponse: vi.fn((msg, details) => ({
      content: [{ type: 'text', text: JSON.stringify({ error: msg, ...details }, null, 2) }],
      isError: true,
    })),
  };
});

const mockedRunStrict = vi.mocked(runContainerCommandStrict);

function getToolHandler(toolName: string) {
  const mockServer = { tool: vi.fn() };
  registerSystemTools(mockServer as unknown as McpServer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = mockServer.tool.mock.calls.find((c: any[]) => c[0] === toolName);
  return call[3];
}

describe('System Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('system_info', () => {
    it('should fetch and combine system info correctly', async () => {
      const handler = getToolHandler('system_info');
      mockedRunStrict.mockResolvedValueOnce('{"OSType": "linux"}');
      const res = await handler({}, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['system', 'info']);
      expect(res.isError).toBeFalsy();
    });
  });

  describe('system_prune', () => {
    it('should call prune when confirmed', async () => {
      const handler = getToolHandler('system_prune');
      mockedRunStrict.mockResolvedValue('deleted');
      const res = await handler({ confirm: true }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['system', 'prune'], { timeout: 180_000 });
      expect(res.isError).toBeFalsy();
    });


  });
});
