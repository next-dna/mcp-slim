import {
  CHARS_PER_TOKEN,
  analyzeConfig,
  analyzeServer,
  estimateTokens,
} from '../src/analyzer/token-calculator';
import { lintServer } from '../src/security/linter';
import { compressConfig } from '../src/compressor/compressor';
import { parseArgs } from '../src/cli';
import type { McpConfigFile } from '../src/types';

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('rounds up at ~4 chars per token', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('x'.repeat(4 * CHARS_PER_TOKEN))).toBe(CHARS_PER_TOKEN);
  });
});

describe('analyzeServer', () => {
  it('counts tokens of the serialized definition', () => {
    const report = analyzeServer('fs', { command: 'npx', args: ['-y', 'server'] });
    expect(report.server).toBe('fs');
    expect(report.chars).toBeGreaterThan(0);
    expect(report.tokens).toBe(Math.ceil(report.chars / CHARS_PER_TOKEN));
  });
});

function makeConfig(servers: McpConfigFile['servers']): McpConfigFile {
  return {
    path: '/tmp/test.json',
    source: 'Test',
    servers,
    raw: { mcpServers: servers },
  };
}

describe('analyzeConfig', () => {
  it('totals tokens and sorts worst offenders first', () => {
    const config = makeConfig({
      small: { command: 'node' },
      big: { command: 'npx', args: ['-y', 'a-very-long-package-name-that-costs-more'] },
    });
    const report = analyzeConfig(config);
    expect(report.servers).toHaveLength(2);
    expect(report.servers[0]!.tokens).toBeGreaterThanOrEqual(report.servers[1]!.tokens);
    expect(report.totalTokens).toBe(
      report.servers.reduce((sum, s) => sum + s.tokens, 0),
    );
  });

  it('handles an empty server map', () => {
    const report = analyzeConfig(makeConfig({}));
    expect(report.servers).toHaveLength(0);
    expect(report.totalTokens).toBe(0);
  });
});

describe('lintServer', () => {
  it('flags direct shell execution as high severity', () => {
    const findings = lintServer('shell', { command: '/bin/bash', args: ['-c', 'echo hi'] });
    expect(findings.some((f) => f.rule === 'shell-exec' && f.severity === 'high')).toBe(true);
    expect(findings.some((f) => f.rule === 'shell-command-flag')).toBe(true);
  });

  it('flags unpinned package runners', () => {
    const findings = lintServer('fs', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] });
    expect(findings.some((f) => f.rule === 'unpinned-package')).toBe(true);
  });

  it('does not flag a pinned package runner', () => {
    const findings = lintServer('fs', { command: 'npx', args: ['server@1.2.3'] });
    expect(findings.some((f) => f.rule === 'unpinned-package')).toBe(false);
  });

  it('flags broad filesystem roots', () => {
    const findings = lintServer('fs', { command: 'server', args: ['/'] });
    expect(findings.some((f) => f.rule === 'broad-filesystem')).toBe(true);
  });

  it('flags insecure http transports', () => {
    const findings = lintServer('remote', { url: 'http://example.com/sse' });
    expect(findings.some((f) => f.rule === 'insecure-transport' && f.severity === 'high')).toBe(true);
  });

  it('flags plaintext secrets in env', () => {
    const findings = lintServer('api', { command: 'node', env: { API_KEY: 'sk-123' } });
    expect(findings.some((f) => f.rule === 'plaintext-secret')).toBe(true);
  });

  it('returns no findings for a safe, pinned server', () => {
    const findings = lintServer('safe', { command: 'node', args: ['./server.js'] });
    expect(findings).toHaveLength(0);
  });
});

describe('compressConfig', () => {
  it('produces smaller, still-valid JSON', () => {
    const config = makeConfig({
      fs: { command: 'npx', args: ['-y', 'server'] },
    });
    const result = compressConfig(config);
    expect(result.afterChars).toBeLessThanOrEqual(result.beforeChars);
    expect(result.savedTokens).toBeGreaterThanOrEqual(0);
    // Output must parse and keep the structural data.
    const reparsed = JSON.parse(result.output);
    expect(reparsed.mcpServers.fs.command).toBe('npx');
  });

  it('collapses whitespace in descriptions losslessly', () => {
    const config: McpConfigFile = {
      path: '/tmp/d.json',
      source: 'Test',
      servers: {},
      raw: { tool: { description: 'line one\n\n   line two   with   spaces' } },
    };
    const result = compressConfig(config);
    const reparsed = JSON.parse(result.output);
    expect(reparsed.tool.description).toBe('line one line two with spaces');
  });
});

describe('parseArgs', () => {
  it('parses a command', () => {
    expect(parseArgs(['audit']).command).toBe('audit');
  });

  it('parses --config with a value', () => {
    expect(parseArgs(['audit', '--config', '/x/y.json']).config).toBe('/x/y.json');
    expect(parseArgs(['audit', '--config=/x/y.json']).config).toBe('/x/y.json');
  });

  it('parses flags', () => {
    const args = parseArgs(['compress', '--json', '-h']);
    expect(args.command).toBe('compress');
    expect(args.json).toBe(true);
    expect(args.help).toBe(true);
  });
});
