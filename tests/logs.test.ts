import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runContainerCommandStrict, runContainerCommand } from '../src/utils/cli.js';
import { registerLogTools } from '../src/tools/logs.js';
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
const mockedRun = vi.mocked(runContainerCommand);

function getToolHandler(toolName: string) {
  const mockServer = { tool: vi.fn() };
  registerLogTools(mockServer as unknown as McpServer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = mockServer.tool.mock.calls.find((c: any[]) => c[0] === toolName);
  return call[3];
}

describe('Logs Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get_logs', () => {
    it('should fetch logs with default tail', async () => {
      const handler = getToolHandler('get_logs');
      mockedRun.mockResolvedValue({ stdout: 'log data', stderr: '', exitCode: 0 });
      const res = await handler({ name: 'web', tail: 100 }, {});
      expect(mockedRun).toHaveBeenCalledWith(['logs', '--tail', '100', 'web'], expect.any(Object));
      expect(res.isError).toBeFalsy();
    });

    it('should parse since relative duration', async () => {
      const handler = getToolHandler('get_logs');
      mockedRun.mockResolvedValue({ stdout: 'log data', stderr: '', exitCode: 0 });
      const res = await handler({ name: 'web', since: '1h', tail: 100 }, {});
      expect(mockedRun).toHaveBeenCalledWith(expect.arrayContaining(['--since']), expect.any(Object));
      expect(res.isError).toBeFalsy();
    });

    it('should reject invalid name', async () => {
      const handler = getToolHandler('get_logs');
      const res = await handler({ name: 'web; rm -rf /', tail: 100 }, {});
      expect(res.isError).toBe(true);
    });
  });

  describe('get_container_stats', () => {
    it('should parse stats json correctly', async () => {
      const handler = getToolHandler('get_container_stats');
      mockedRun.mockResolvedValue({ stdout: '{"memory_stats": {}}', stderr: '', exitCode: 0 });
      const res = await handler({ name: 'web' }, {});
      expect(res.isError).toBeFalsy();
    });

    it('should reject invalid name', async () => {
      const handler = getToolHandler('get_container_stats');
      const res = await handler({ name: 'web; rm -rf /' }, {});
      expect(res.isError).toBe(true);
    });
  });

  describe('get_container_processes', () => {
    it('should call top correctly', async () => {
      const handler = getToolHandler('get_container_processes');
      mockedRun.mockResolvedValue({ stdout: 'PID USER COMMAND\n1 root bash', stderr: '', exitCode: 0 });
      const res = await handler({ name: 'web' }, {});
      expect(res.isError).toBeFalsy();
    });

    it('should reject invalid name', async () => {
      const handler = getToolHandler('get_container_processes');
      const res = await handler({ name: 'web; rm -rf /' }, {});
      expect(res.isError).toBe(true);
    });
  });
});
