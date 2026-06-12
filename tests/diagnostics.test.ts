import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runContainerCommandStrict, runContainerCommand } from '../src/utils/cli.js';
import { registerDiagnosticsTools } from '../src/tools/diagnostics.js';
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
  registerDiagnosticsTools(mockServer as unknown as McpServer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = mockServer.tool.mock.calls.find((c: any[]) => c[0] === toolName);
  return call[3];
}

describe('Diagnostics Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('diagnose_container', () => {
    it('should diagnose container successfully', async () => {
      const handler = getToolHandler('diagnose_container');
      mockedRun.mockResolvedValue({ stdout: 'cannot allocate memory', stderr: '', exitCode: 0 } as any);
      mockedRunStrict.mockResolvedValue('[{"State": {"Status": "exited"}}]');
      
      const res = await handler({ name: 'web' }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['inspect', 'web']);
      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.possibleCauses[0]).toContain('Memory exhaustion');
    });

    it('should reject invalid name', async () => {
      const handler = getToolHandler('diagnose_container');
      const res = await handler({ name: 'web; rm -rf /' }, {});
      expect(res.isError).toBe(true);
    });
  });

  describe('explain_container', () => {
    it('should explain container successfully', async () => {
      const handler = getToolHandler('explain_container');
      mockedRunStrict.mockResolvedValueOnce('[{"Config": {"Image": "nginx:latest"}, "State": {"Status": "running"}}]');
      mockedRun.mockResolvedValueOnce({ stdout: 'PID USER COMMAND\n1 root nginx', stderr: '', exitCode: 0 } as any); // top
      mockedRun.mockResolvedValueOnce({ stdout: '{"memory_stats": {}}', stderr: '', exitCode: 0 } as any); // stats

      const res = await handler({ name: 'web' }, {});
      expect(res.isError).toBeFalsy();
    });

    it('should reject invalid name', async () => {
      const handler = getToolHandler('explain_container');
      const res = await handler({ name: 'web; rm -rf /' }, {});
      expect(res.isError).toBe(true);
    });
  });
});
