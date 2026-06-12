/**
 * Tests for the CLI executor utility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execa before importing the module under test
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import {
  checkCliInstalled,
  runContainerCommand,
  runContainerCommandStrict,
  mapCliError,
  formatToolError,
  buildErrorResponse,
  buildSuccessResponse,
} from '../src/utils/cli.js';

const mockedExeca = vi.mocked(execa);

describe('CLI Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkCliInstalled', () => {
    it('should return true when container CLI is available', async () => {
      mockedExeca.mockResolvedValue({
        stdout: 'container version 0.1.0',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await checkCliInstalled();
      expect(result).toBe(true);
      expect(mockedExeca).toHaveBeenCalledWith('container', ['--version'], { timeout: 5000 });
    });

    it('should throw a helpful error when CLI is not found (ENOENT)', async () => {
      const error = new Error('Command not found') as any;
      error.code = 'ENOENT';
      mockedExeca.mockRejectedValue(error);

      await expect(checkCliInstalled()).rejects.toThrow('not installed or not in PATH');
    });

    it('should return true if CLI exists but errors (non-ENOENT)', async () => {
      const error = new Error('Some other error') as any;
      error.code = 'OTHER';
      mockedExeca.mockRejectedValue(error);

      const result = await checkCliInstalled();
      expect(result).toBe(true);
    });
  });

  describe('runContainerCommand', () => {
    it('should execute a command and return stdout/stderr/exitCode', async () => {
      mockedExeca.mockResolvedValue({
        stdout: '{"containers": []}',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await runContainerCommand(['ls', '--format', 'json']);

      expect(result).toEqual({
        stdout: '{"containers": []}',
        stderr: '',
        exitCode: 0,
      });
      expect(mockedExeca).toHaveBeenCalledWith('container', ['ls', '--format', 'json'], {
        timeout: 30000,
        input: undefined,
        reject: false,
        stripFinalNewline: true,
      });
    });

    it('should use custom timeout', async () => {
      mockedExeca.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await runContainerCommand(['pull', 'ubuntu'], { timeout: 120000 });

      expect(mockedExeca).toHaveBeenCalledWith(
        'container',
        ['pull', 'ubuntu'],
        expect.objectContaining({ timeout: 120000 }),
      );
    });

    it('should throw on ENOENT error', async () => {
      const error = new Error('not found') as any;
      error.code = 'ENOENT';
      mockedExeca.mockRejectedValue(error);

      await expect(runContainerCommand(['ls'])).rejects.toThrow('not installed or not in PATH');
    });

    it('should throw on timeout', async () => {
      const error = new Error('timed out') as any;
      error.timedOut = true;
      mockedExeca.mockRejectedValue(error);

      await expect(runContainerCommand(['ls'])).rejects.toThrow('timed out');
    });

    it('should throw on canceled command', async () => {
      const error = new Error('canceled') as any;
      error.isCanceled = true;
      mockedExeca.mockRejectedValue(error);

      await expect(runContainerCommand(['ls'])).rejects.toThrow('canceled');
    });

    it('should return non-zero exit codes without throwing', async () => {
      mockedExeca.mockResolvedValue({
        stdout: '',
        stderr: 'no such container',
        exitCode: 1,
      } as any);

      const result = await runContainerCommand(['inspect', 'nonexistent']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('no such container');
    });
  });

  describe('runContainerCommandStrict', () => {
    it('should return stdout on success', async () => {
      mockedExeca.mockResolvedValue({
        stdout: 'container started',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await runContainerCommandStrict(['start', 'mycontainer']);
      expect(result).toBe('container started');
    });

    it('should throw with structured error on non-zero exit', async () => {
      mockedExeca.mockResolvedValue({
        stdout: '',
        stderr: 'no such container: mycontainer',
        exitCode: 1,
      } as any);

      await expect(runContainerCommandStrict(['start', 'mycontainer'])).rejects.toThrow(
        'Container or resource not found',
      );
    });
  });

  describe('mapCliError', () => {
    it('should detect container not found errors', () => {
      const error = mapCliError(
        { stdout: '', stderr: 'Error: no such container: web', exitCode: 1 },
        'container inspect web',
      );
      expect(error.error).toBe('Container or resource not found');
      expect(error.hint).toContain('list_containers');
    });

    it('should detect permission errors', () => {
      const error = mapCliError(
        { stdout: '', stderr: 'Error: permission denied', exitCode: 1 },
        'container start web',
      );
      expect(error.error).toBe('Permission denied');
    });

    it('should detect image not found errors', () => {
      const error = mapCliError(
        { stdout: '', stderr: 'Error: manifest unknown', exitCode: 1 },
        'container pull fake:latest',
      );
      expect(error.error).toBe('Image not found or pull access denied');
    });

    it('should detect port conflict errors', () => {
      const error = mapCliError(
        { stdout: '', stderr: 'Error: port is already allocated', exitCode: 1 },
        'container run -p 80:80 nginx',
      );
      expect(error.error).toContain('Port conflict');
    });

    it('should return generic error for unknown stderr', () => {
      const error = mapCliError(
        { stdout: '', stderr: 'Something unexpected happened', exitCode: 42 },
        'container something',
      );
      expect(error.error).toContain('exit code 42');
    });
  });

  describe('formatToolError', () => {
    it('should format a complete error', () => {
      const formatted = formatToolError({
        error: 'Container not found',
        command: 'container inspect web',
        exitCode: 1,
        stderr: 'no such container',
        hint: 'Check the name',
      });
      expect(formatted).toContain('Container not found');
      expect(formatted).toContain('container inspect web');
      expect(formatted).toContain('Exit code: 1');
      expect(formatted).toContain('no such container');
      expect(formatted).toContain('Check the name');
    });

    it('should handle minimal error', () => {
      const formatted = formatToolError({ error: 'Something failed' });
      expect(formatted).toBe('Error: Something failed');
    });
  });

  describe('buildErrorResponse', () => {
    it('should return isError true with formatted content', () => {
      const response = buildErrorResponse('test error', { code: 42 });
      expect(response.isError).toBe(true);
      expect(response.content).toHaveLength(1);
      expect(response.content[0]!.type).toBe('text');
      const parsed = JSON.parse(response.content[0]!.text);
      expect(parsed.error).toBe('test error');
      expect(parsed.code).toBe(42);
    });
  });

  describe('buildSuccessResponse', () => {
    it('should return string content as-is', () => {
      const response = buildSuccessResponse('hello world');
      expect(response.content[0]!.text).toBe('hello world');
    });

    it('should JSON stringify objects', () => {
      const response = buildSuccessResponse({ key: 'value' });
      const parsed = JSON.parse(response.content[0]!.text);
      expect(parsed.key).toBe('value');
    });
  });
});
