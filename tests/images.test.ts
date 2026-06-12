/**
 * Tests for image management tools and parser utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runContainerCommandStrict } from '../src/utils/cli.js';
import { registerImageTools } from '../src/tools/images.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

function getToolHandler(toolName: string) {
  const mockServer = { tool: vi.fn() };
  registerImageTools(mockServer as unknown as McpServer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = mockServer.tool.mock.calls.find((c: any[]) => c[0] === toolName);
  if (!call) throw new Error(`Tool ${toolName} not registered`);
  return call[3];
}

describe('Image Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list_images', () => {
    it('should use json format', async () => {
      const handler = getToolHandler('list_images');
      mockedRunStrict.mockResolvedValue('[{"repository":"nginx"}]');
      await handler({ format: 'json' }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['image', 'ls', '--format', 'json']);
    });

    it('should use table format without --format', async () => {
      const handler = getToolHandler('list_images');
      mockedRunStrict.mockResolvedValue('table');
      await handler({ format: 'table' }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['image', 'ls']);
    });
  });

  describe('pull_image', () => {
    it('should reject invalid OCI ref', async () => {
      const handler = getToolHandler('pull_image');
      const res = await handler({ reference: 'invalid ref' }, {});
      expect(res.isError).toBe(true);
    });

    it('should pull valid ref', async () => {
      const handler = getToolHandler('pull_image');
      mockedRunStrict.mockResolvedValue('pulling...');
      const res = await handler({ reference: 'ubuntu:latest' }, {});
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('ubuntu:latest');
    });
  });

  describe('build_image', () => {
    it('should reject non-existent context path', async () => {
      const handler = getToolHandler('build_image');
      const res = await handler({ context: '/does/not/exist/abc12345', tag: 'myapp:latest' }, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Build context path does not exist');
    });

    it('should reject invalid tag', async () => {
      const handler = getToolHandler('build_image');
      const res = await handler({ context: '.', tag: 'invalid tag' }, {});
      expect(res.isError).toBe(true);
    });

    it('should reject invalid build arg key', async () => {
      const handler = getToolHandler('build_image');
      const res = await handler({ context: '.', tag: 'myapp:latest', buildArgs: { 'INVALID ARG': 'value' } }, {});
      expect(res.isError).toBe(true);
    });
  });

  describe('remove_image', () => {
    it('should reject invalid ref', async () => {
      const handler = getToolHandler('remove_image');
      const res = await handler({ references: ['invalid name'] }, {});
      expect(res.isError).toBe(true);
    });

    it('should include force flag', async () => {
      const handler = getToolHandler('remove_image');
      mockedRunStrict.mockResolvedValue('removed');
      await handler({ references: ['ubuntu:latest'], force: true }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['image', 'rm', '--force', 'ubuntu:latest']);
    });
  });

  describe('tag_image', () => {
    it('should reject invalid source', async () => {
      const handler = getToolHandler('tag_image');
      const res = await handler({ source: '-invalid', target: 'myapp:latest' }, {});
      expect(res.isError).toBe(true);
    });

    it('should reject invalid target', async () => {
      const handler = getToolHandler('tag_image');
      const res = await handler({ source: 'ubuntu:latest', target: '-invalid' }, {});
      expect(res.isError).toBe(true);
    });

    it('should call CLI with source and target', async () => {
      const handler = getToolHandler('tag_image');
      mockedRunStrict.mockResolvedValue('');
      await handler({ source: 'ubuntu:latest', target: 'myapp:v1' }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['image', 'tag', 'ubuntu:latest', 'myapp:v1']);
    });
  });

  describe('push_image', () => {
    it('should reject invalid image ref', async () => {
      const handler = getToolHandler('push_image');
      const res = await handler({ image: 'invalid name' }, {});
      expect(res.isError).toBe(true);
    });

    it('should call CLI with image', async () => {
      const handler = getToolHandler('push_image');
      mockedRunStrict.mockResolvedValue('');
      await handler({ image: 'myrepo/myapp:latest' }, {});
      expect(mockedRunStrict).toHaveBeenCalledWith(['image', 'push', 'myrepo/myapp:latest'], { timeout: 300_000 });
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
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1048576)).toBe('1.0 MB');
      expect(formatBytes(1073741824)).toBe('1.0 GB');
      expect(formatBytes(268435456)).toBe('256.0 MB');
    });

    it('should return 0 B for negative or NaN', () => {
      expect(formatBytes(-1024)).toBe('0 B');
      expect(formatBytes(NaN)).toBe('0 B');
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

    it('parseRelativeDuration("0s") returns timestamp', () => {
      const res = parseRelativeDuration('0s');
      expect(res).not.toBeNull();
    });

    it('parseRelativeDuration("1d") returns ISO string roughly 24h ago', () => {
      const res = parseRelativeDuration('1d');
      expect(res).not.toBeNull();
      const parsed = new Date(res!);
      const now = new Date();
      const diffMs = now.getTime() - parsed.getTime();
      expect(Math.abs(diffMs - 86400000)).toBeLessThan(1000); // within 1 second
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
