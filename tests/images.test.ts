/**
 * Tests for image management tools and parser utilities.
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
import { registerImageTools } from '../src/tools/images.js';
import {
  isValidOciName,
  isValidPortMapping,
  isValidEnvVar,
  formatBytes,
  formatRelativeTime,
  parseRelativeDuration,
  parseTableOutput,
  safeJsonParse,
  truncate,
} from '../src/utils/parser.js';

const mockedRunStrict = vi.mocked(runContainerCommandStrict);

describe('Image Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list_images', () => {
    it('should call container images with --format json', async () => {
      mockedRunStrict.mockResolvedValue('[{"repository":"nginx","tag":"latest"}]');

      const result = await runContainerCommandStrict(['images', '--format', 'json']);
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].repository).toBe('nginx');
    });
  });

  describe('pull_image', () => {
    it('should pull an image', async () => {
      mockedRunStrict.mockResolvedValue('Pulling ubuntu:latest... done');

      const result = await runContainerCommandStrict(['pull', 'ubuntu:latest']);
      expect(result).toContain('ubuntu:latest');
    });
  });

  describe('build_image', () => {
    it('should build with tag and context', async () => {
      mockedRunStrict.mockResolvedValue('Successfully built abc123');

      const args = ['build', '-t', 'myapp:v1', '.'];
      const result = await runContainerCommandStrict(args);
      expect(result).toContain('Successfully built');
    });

    it('should include build args', async () => {
      mockedRunStrict.mockResolvedValue('Built');

      const args = ['build', '-t', 'myapp:v1', '--build-arg', 'NODE_VERSION=18', '.'];
      await runContainerCommandStrict(args);
      expect(mockedRunStrict).toHaveBeenCalledWith(
        expect.arrayContaining(['--build-arg', 'NODE_VERSION=18']),
      );
    });
  });

  describe('remove_image', () => {
    it('should remove images', async () => {
      mockedRunStrict.mockResolvedValue('Untagged: nginx:latest');

      const args = ['rmi', 'nginx:latest'];
      await runContainerCommandStrict(args);
      expect(mockedRunStrict).toHaveBeenCalledWith(['rmi', 'nginx:latest']);
    });

    it('should force remove images', async () => {
      mockedRunStrict.mockResolvedValue('Deleted');

      const args = ['rmi', '--force', 'nginx:latest'];
      await runContainerCommandStrict(args);
      expect(mockedRunStrict).toHaveBeenCalledWith(['rmi', '--force', 'nginx:latest']);
    });
  });

  describe('tag_image', () => {
    it('should reject invalid OCI image names', async () => {
      const mockServer = { tool: vi.fn() };
      registerImageTools(mockServer as any);
      const toolCall = mockServer.tool.mock.calls.find((c: any) => c[0] === 'tag_image');
      const handler = toolCall[3];

      const res = await handler({ source: '-invalid:abc', target: 'target:latest' });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Invalid source image reference');
    });
  });

  describe('inspect_image', () => {
    it('should return parsed image info', async () => {
      const inspectData = JSON.stringify({
        Id: 'sha256:abc123',
        Config: {
          Env: ['PATH=/usr/local/bin'],
          Entrypoint: ['/entrypoint.sh'],
        },
        RootFS: { Layers: ['sha256:layer1', 'sha256:layer2'] },
      });
      mockedRunStrict.mockResolvedValue(inspectData);

      const result = await runContainerCommandStrict(['image', 'inspect', 'nginx:latest']);
      const parsed = JSON.parse(result);
      expect(parsed.Config.Env).toContain('PATH=/usr/local/bin');
      expect(parsed.RootFS.Layers).toHaveLength(2);
    });
  });
});

describe('Parser Utilities', () => {
  describe('isValidOciName', () => {
    it('should accept valid image names', () => {
      expect(isValidOciName('nginx')).toBe(true);
      expect(isValidOciName('nginx:latest')).toBe(true);
      expect(isValidOciName('my-registry.io/my-image:v1.2.3')).toBe(true);
      expect(isValidOciName('ubuntu')).toBe(true);
      expect(isValidOciName('ghcr.io/owner/repo:tag')).toBe(true);
    });

    it('should reject invalid names', () => {
      expect(isValidOciName('')).toBe(false);
      expect(isValidOciName('-invalid')).toBe(false);
      expect(isValidOciName('.invalid')).toBe(false);
    });

    it('should reject names longer than 255 chars', () => {
      expect(isValidOciName('a'.repeat(256))).toBe(false);
    });
  });

  describe('isValidPortMapping', () => {
    it('should accept valid port mappings', () => {
      expect(isValidPortMapping('8080:80')).toBe(true);
      expect(isValidPortMapping('443:443/tcp')).toBe(true);
      expect(isValidPortMapping('5432:5432/udp')).toBe(true);
    });

    it('should reject invalid port mappings', () => {
      expect(isValidPortMapping('8080')).toBe(false);
      expect(isValidPortMapping('abc:80')).toBe(false);
      expect(isValidPortMapping('8080:80/http')).toBe(false);
      expect(isValidPortMapping('')).toBe(false);
    });
  });

  describe('isValidEnvVar', () => {
    it('should accept valid env var formats', () => {
      expect(isValidEnvVar('NODE_ENV=production')).toBe(true);
      expect(isValidEnvVar('PATH=/usr/bin')).toBe(true);
      expect(isValidEnvVar('KEY=')).toBe(true);
      expect(isValidEnvVar('_PRIVATE=val')).toBe(true);
    });

    it('should reject invalid env var formats', () => {
      expect(isValidEnvVar('NODE_ENV')).toBe(false);
      expect(isValidEnvVar('123=value')).toBe(false);
      expect(isValidEnvVar('=value')).toBe(false);
      expect(isValidEnvVar('')).toBe(false);
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(500)).toBe('500.0 B');
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1048576)).toBe('1.0 MB');
      expect(formatBytes(1073741824)).toBe('1.0 GB');
      expect(formatBytes(268435456)).toBe('256.0 MB');
    });
  });

  describe('parseRelativeDuration', () => {
    it('parseRelativeDuration("30m") returns a valid ISO 8601 string', () => {
      const res = parseRelativeDuration('30m');
      expect(res).not.toBeNull();
      expect(new Date(res!).toISOString()).toBe(res);
    });

    it('parseRelativeDuration("abc") returns null', () => {
      expect(parseRelativeDuration('abc')).toBeNull();
    });
  });

  describe('formatRelativeTime', () => {
    it('should format recent times', () => {
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
      expect(formatRelativeTime(fiveMinAgo)).toBe('5 minutes ago');
    });

    it('should format hours ago', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoHoursAgo)).toBe('2 hours ago');
    });

    it('should handle invalid dates', () => {
      expect(formatRelativeTime('not-a-date')).toBe('not-a-date');
    });
  });

  describe('parseTableOutput', () => {
    it('should parse a table with headers', () => {
      const input = 'NAME    STATUS    IMAGE\nweb     running   nginx\napi     stopped   node';
      const result = parseTableOutput(input);
      expect(result).toHaveLength(2);
      expect(result[0]!['name']).toBe('web');
      expect(result[0]!['status']).toBe('running');
      expect(result[1]!['name']).toBe('api');
    });

    it('should return empty array for empty input', () => {
      expect(parseTableOutput('')).toEqual([]);
    });

    it('should return empty array for header-only input', () => {
      expect(parseTableOutput('NAME    STATUS')).toEqual([]);
    });
  });

  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      expect(safeJsonParse('{"key":"value"}')).toEqual({ key: 'value' });
      expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('should return default for invalid JSON', () => {
      expect(safeJsonParse('not json')).toBeNull();
      expect(safeJsonParse('not json', [])).toEqual([]);
    });
  });

  describe('truncate', () => {
    it('should not truncate short strings', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('should truncate long strings with ellipsis', () => {
      const long = 'a'.repeat(300);
      const result = truncate(long, 200);
      expect(result.length).toBe(200);
      expect(result.endsWith('...')).toBe(true);
    });
  });
});
