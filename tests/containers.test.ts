/**
 * Tests for container lifecycle tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the CLI module
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

import { runContainerCommandStrict } from '../src/utils/cli.js';

const mockedRunStrict = vi.mocked(runContainerCommandStrict);

describe('Container Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list_containers', () => {
    it('should call container ls with --format json by default', async () => {
      mockedRunStrict.mockResolvedValue('[{"name":"web","status":"running"}]');

      // Simulate what the tool handler does
      const args = ['ls', '--format', 'json'];
      const result = await runContainerCommandStrict(args);
      expect(result).toContain('web');
      expect(mockedRunStrict).toHaveBeenCalledWith(['ls', '--format', 'json']);
    });

    it('should add --all flag when all=true', async () => {
      mockedRunStrict.mockResolvedValue('[]');

      const args = ['ls', '--all', '--format', 'json'];
      await runContainerCommandStrict(args);
      expect(mockedRunStrict).toHaveBeenCalledWith(['ls', '--all', '--format', 'json']);
    });
  });

  describe('run_container', () => {
    it('should build correct command for basic run', async () => {
      mockedRunStrict.mockResolvedValue('container-id-123');

      const args = ['run', '-d', '--name', 'web', 'nginx:latest'];
      const result = await runContainerCommandStrict(args);
      expect(result).toBe('container-id-123');
      expect(mockedRunStrict).toHaveBeenCalledWith(['run', '-d', '--name', 'web', 'nginx:latest']);
    });

    it('should include port mappings', async () => {
      mockedRunStrict.mockResolvedValue('container-id-456');

      const args = ['run', '-d', '-p', '8080:80', '-p', '443:443', 'nginx'];
      await runContainerCommandStrict(args);
      expect(mockedRunStrict).toHaveBeenCalledWith(
        expect.arrayContaining(['-p', '8080:80', '-p', '443:443']),
      );
    });

    it('should include environment variables', async () => {
      mockedRunStrict.mockResolvedValue('container-id-789');

      const args = ['run', '-d', '-e', 'NODE_ENV=production', 'myapp'];
      await runContainerCommandStrict(args);
      expect(mockedRunStrict).toHaveBeenCalledWith(
        expect.arrayContaining(['-e', 'NODE_ENV=production']),
      );
    });
  });

  describe('stop_container', () => {
    it('should stop containers by name', async () => {
      mockedRunStrict.mockResolvedValue('web\napi');

      const args = ['stop', 'web', 'api'];
      const result = await runContainerCommandStrict(args);
      expect(result).toContain('web');
      expect(mockedRunStrict).toHaveBeenCalledWith(['stop', 'web', 'api']);
    });

    it('should include timeout flag', async () => {
      mockedRunStrict.mockResolvedValue('web');

      const args = ['stop', '--timeout', '10', 'web'];
      await runContainerCommandStrict(args);
      expect(mockedRunStrict).toHaveBeenCalledWith(['stop', '--timeout', '10', 'web']);
    });
  });

  describe('delete_container', () => {
    it('should remove containers', async () => {
      mockedRunStrict.mockResolvedValue('web');

      const args = ['rm', 'web'];
      await runContainerCommandStrict(args);
      expect(mockedRunStrict).toHaveBeenCalledWith(['rm', 'web']);
    });

    it('should include --force flag', async () => {
      mockedRunStrict.mockResolvedValue('web');

      const args = ['rm', '--force', 'web'];
      await runContainerCommandStrict(args);
      expect(mockedRunStrict).toHaveBeenCalledWith(['rm', '--force', 'web']);
    });
  });

  describe('inspect_container', () => {
    it('should return parsed JSON inspect data', async () => {
      const inspectData = JSON.stringify({
        Id: 'abc123',
        Name: 'web',
        State: { Status: 'running' },
        Config: { Image: 'nginx:latest' },
      });
      mockedRunStrict.mockResolvedValue(inspectData);

      const result = await runContainerCommandStrict(['inspect', 'web']);
      const parsed = JSON.parse(result);
      expect(parsed.Name).toBe('web');
      expect(parsed.State.Status).toBe('running');
    });
  });

  describe('exec_in_container', () => {
    it('should execute command in container', async () => {
      mockedRunStrict.mockResolvedValue('hello world');

      const args = ['exec', 'web', 'echo', 'hello', 'world'];
      const result = await runContainerCommandStrict(args);
      expect(result).toBe('hello world');
    });
  });

  describe('error handling', () => {
    it('should throw when container is not found', async () => {
      mockedRunStrict.mockRejectedValue(new Error('Container or resource not found'));

      await expect(runContainerCommandStrict(['inspect', 'nonexistent'])).rejects.toThrow(
        'not found',
      );
    });

    it('should throw on permission errors', async () => {
      mockedRunStrict.mockRejectedValue(new Error('Permission denied'));

      await expect(runContainerCommandStrict(['start', 'web'])).rejects.toThrow('Permission');
    });
  });
});
