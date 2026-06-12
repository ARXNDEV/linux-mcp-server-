/**
 * Tests for container lifecycle tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runContainerCommandStrict, runContainerCommand } from '../src/utils/cli.js';
import { registerContainerTools } from '../src/tools/containers.js';
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
const mockedRun = vi.mocked(runContainerCommand);

// Helper to get tool handler
function getToolHandler(toolName: string) {
  const mockServer = { tool: vi.fn() };
  registerContainerTools(mockServer as unknown as McpServer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = mockServer.tool.mock.calls.find((c: any[]) => c[0] === toolName);
  if (!call) throw new Error(`Tool ${toolName} not registered`);
  return call[3];
}

describe('Container Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list_containers', () => {
    it('should call CLI with json format by default', async () => {
      const handler = getToolHandler('list_containers');
      mockedRunStrict.mockResolvedValue('[{"name":"web"}]');
      await handler({ all: false, format: 'json' }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['ls', '--format', 'json']);
    });

    it('should add --all flag when all=true', async () => {
      const handler = getToolHandler('list_containers');
      mockedRunStrict.mockResolvedValue('[]');
      await handler({ all: true, format: 'json' }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['ls', '--all', '--format', 'json']);
    });

    it('should call CLI without --format flag for table', async () => {
      const handler = getToolHandler('list_containers');
      mockedRunStrict.mockResolvedValue('table format');
      await handler({ all: false, format: 'table' }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['ls']);
    });
  });

  describe('run_container', () => {
    it('should return containerId on basic run', async () => {
      const handler = getToolHandler('run_container');
      mockedRunStrict.mockResolvedValue('container-id-123\n');
      const res = await handler({ image: 'nginx', name: 'web' }, {});
      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.containerId).toBe('container-id-123');
      expect(mockedRunStrict).toHaveBeenCalledWith(expect.arrayContaining(['run', '--name', 'web', 'nginx']));
    });

    it('should reject invalid OCI name', async () => {
      const handler = getToolHandler('run_container');
      const res = await handler({ image: 'nginx', name: 'invalid space' }, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Invalid container name');
    });

    it('should reject invalid port mapping', async () => {
      const handler = getToolHandler('run_container');
      const res = await handler({ image: 'nginx', ports: ['invalid'] }, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Invalid port mapping');
    });

    it('should reject invalid env var', async () => {
      const handler = getToolHandler('run_container');
      const res = await handler({ image: 'nginx', env: ['INVALID'] }, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Invalid environment variable');
    });

    it('should correctly pass ports, env, volumes', async () => {
      const handler = getToolHandler('run_container');
      mockedRunStrict.mockResolvedValue('id');
      await handler({ image: 'nginx', ports: ['80:80'], env: ['A=B'], volumes: ['v:/v'] }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(expect.arrayContaining(['-p', '80:80', '-e', 'A=B', '-v', 'v:/v']));
    });
  });

  describe('stop_container', () => {
    it('should stop containers by name', async () => {
      const handler = getToolHandler('stop_container');
      mockedRunStrict.mockResolvedValue('web');
      await handler({ names: ['web', 'api'] }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['stop', 'web', 'api']);
    });

    it('should include timeout flag', async () => {
      const handler = getToolHandler('stop_container');
      mockedRunStrict.mockResolvedValue('web');
      await handler({ names: ['web'], timeout: 10 }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['stop', '--timeout', '10', 'web']);
    });

    it('should reject name with shell metachar', async () => {
      const handler = getToolHandler('stop_container');
      const res = await handler({ names: ['web; rm -rf /'] }, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('shell metacharacters');
    });
  });

  describe('delete_container', () => {
    it('should perform basic remove', async () => {
      const handler = getToolHandler('delete_container');
      mockedRunStrict.mockResolvedValue('web');
      await handler({ names: ['web'] }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['rm', 'web']);
    });

    it('should include --force flag', async () => {
      const handler = getToolHandler('delete_container');
      mockedRunStrict.mockResolvedValue('web');
      await handler({ names: ['web'], force: true }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['rm', '--force', 'web']);
    });
  });

  describe('inspect_container', () => {
    it('should return parsed JSON', async () => {
      const handler = getToolHandler('inspect_container');
      mockedRunStrict.mockResolvedValue(JSON.stringify({ Name: 'web' }));
      const res = await handler({ name: 'web' }, {});
      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.Name).toBe('web');
    });
  });

  describe('exec_in_container', () => {
    it('should execute command and return output', async () => {
      const handler = getToolHandler('exec_in_container');
      mockedRun.mockResolvedValue({ stdout: 'hello', stderr: '', exitCode: 0 });
      const res = await handler({ name: 'web', command: 'echo hello' }, {});
      expect(res.isError).toBeFalsy();
      expect(JSON.parse(res.content[0].text).output).toBe('hello');
    });

    it('should return isError true on non-zero exit', async () => {
      const handler = getToolHandler('exec_in_container');
      mockedRun.mockResolvedValue({ stdout: '', stderr: 'error', exitCode: 1 });
      const res = await handler({ name: 'web', command: 'fail' }, {});
      expect(res.isError).toBe(true);
      expect(JSON.parse(res.content[0].text).exitCode).toBe(1);
    });
  });

  describe('copy_to_container', () => {
    it('should reject non-existent host path', async () => {
      const handler = getToolHandler('copy_to_container');
      const res = await handler({ hostPath: '/does/not/exist/12345', containerName: 'web', containerPath: '/' }, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Host path not found');
    });

    it('should reject path outside safeRoot', async () => {
      const handler = getToolHandler('copy_to_container');
      process.env.CONTAINER_MCP_VOLUME_ROOT = '/safe';
      const res = await handler({ hostPath: '/', containerName: 'web', containerPath: '/' }, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('outside the allowed root');
    });
  });

  describe('copy_from_container', () => {
    it('should reject path outside safeRoot', async () => {
      const handler = getToolHandler('copy_from_container');
      process.env.CONTAINER_MCP_VOLUME_ROOT = '/safe';
      const res = await handler({ containerName: 'web', containerPath: '/', hostPath: '/' }, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('outside the allowed root');
    });
  });

  describe('wait_container', () => {
    it('should return exitCode 0', async () => {
      const handler = getToolHandler('wait_container');
      mockedRun.mockResolvedValue({ stdout: '0\n', stderr: '', exitCode: 0 });
      const res = await handler({ name: 'web', timeout: 300 }, {});
      expect(res.isError).toBeFalsy();
      expect(JSON.parse(res.content[0].text).exitCode).toBe(0);
    });

    it('should return exitCode 137', async () => {
      const handler = getToolHandler('wait_container');
      mockedRun.mockResolvedValue({ stdout: '137\n', stderr: '', exitCode: 0 });
      const res = await handler({ name: 'web', timeout: 300 }, {});
      expect(res.isError).toBeFalsy();
      expect(JSON.parse(res.content[0].text).exitCode).toBe(137);
    });

    it('should return isError true if CLI fails', async () => {
      const handler = getToolHandler('wait_container');
      mockedRun.mockResolvedValue({ stdout: '', stderr: 'err', exitCode: 1 });
      const res = await handler({ name: 'web', timeout: 300 }, {});
      expect(res.isError).toBe(true);
    });
  });

  describe('rename_container', () => {
    it('should successfully rename and include old and new name in message', async () => {
      const handler = getToolHandler('rename_container');
      mockedRunStrict.mockResolvedValue('');
      const res = await handler({ container: 'old', newName: 'new' }, {});
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('old');
      expect(res.content[0].text).toContain('new');
    });

    it('should reject invalid new name (contains space)', async () => {
      const handler = getToolHandler('rename_container');
      const res = await handler({ container: 'old', newName: 'invalid name' }, {});
      expect(res.isError).toBe(true);
    });
  });

  describe('pause_container', () => {
    it('should pause containers', async () => {
      const handler = getToolHandler('pause_container');
      mockedRunStrict.mockResolvedValue('web');
      await handler({ names: ['web'] }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['pause', 'web']);
    });

    it('should reject name with metachar', async () => {
      const handler = getToolHandler('pause_container');
      const res = await handler({ names: ['web; rm -rf /'] }, {});
      expect(res.isError).toBe(true);
    });
  });

  describe('unpause_container', () => {
    it('should unpause containers', async () => {
      const handler = getToolHandler('unpause_container');
      mockedRunStrict.mockResolvedValue('web');
      await handler({ names: ['web'] }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['unpause', 'web']);
    });

    it('should reject name with metachar', async () => {
      const handler = getToolHandler('unpause_container');
      const res = await handler({ names: ['web; rm -rf /'] }, {});
      expect(res.isError).toBe(true);
    });
  });

  describe('container_commit', () => {
    it('should reject invalid image name', async () => {
      const handler = getToolHandler('container_commit');
      const res = await handler({ container: 'web', image: 'invalid name' }, {});
      expect(res.isError).toBe(true);
    });

    it('should succeed and include container and image in response', async () => {
      const handler = getToolHandler('container_commit');
      mockedRunStrict.mockResolvedValue('sha256:123');
      const res = await handler({ container: 'web', image: 'myrepo:latest' }, {});
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('web');
      expect(res.content[0].text).toContain('myrepo');
    });
  });
});
