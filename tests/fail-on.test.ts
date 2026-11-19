import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { main, parseArgs } from '../src/cli';

let dir: string;
let risky: string;
let mediumOnly: string;
let clean: string;

function writeConfig(name: string, servers: Record<string, unknown>): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify({ mcpServers: servers }));
  return p;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-failon-'));
  risky = writeConfig('risky.json', {
    fs: { command: 'npx', args: ['-y', 'server', '/'] }, // broad-filesystem (high) + unpinned (medium)
    shell: { command: 'bash', args: ['-c', 'run'] }, // shell-exec (high)
  });
  mediumOnly = writeConfig('medium.json', {
    fs: { command: 'npx', args: ['-y', 'server'] }, // unpinned package (medium), no high
  });
  clean = writeConfig('clean.json', {
    safe: { command: 'node', args: ['./server.js'] }, // no findings
  });
});

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// Silence audit output during tests.
beforeEach(() => {
  jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  jest.spyOn(process.stderr, 'write').mockReturnValue(true);
});

const run = (args: string[]): number => main([...args, '--no-history']);

describe('audit --fail-on', () => {
  it('defaults to failing on high findings (exit 2)', () => {
    expect(run(['audit', '--config', risky])).toBe(2);
  });

  it('--fail-on none never fails on findings (exit 0)', () => {
    expect(run(['audit', '--config', risky, '--fail-on', 'none'])).toBe(0);
  });

  it('a medium-only config passes the default high gate', () => {
    expect(run(['audit', '--config', mediumOnly])).toBe(0);
  });

  it('--fail-on medium catches a medium-only config (exit 2)', () => {
    expect(run(['audit', '--config', mediumOnly, '--fail-on', 'medium'])).toBe(2);
  });

  it('a clean config passes even --fail-on low', () => {
    expect(run(['audit', '--config', clean, '--fail-on', 'low'])).toBe(0);
  });

  it('respects --fail-on in --json mode too', () => {
    expect(run(['audit', '--config', risky, '--json', '--fail-on', 'high'])).toBe(2);
    expect(run(['audit', '--config', clean, '--json', '--fail-on', 'low'])).toBe(0);
  });
});

describe('parseArgs --fail-on', () => {
  it('parses a valid level', () => {
    expect(parseArgs(['audit', '--fail-on', 'medium']).failOn).toBe('medium');
    expect(parseArgs(['audit', '--fail-on=none']).failOn).toBe('none');
  });

  it('defaults to high', () => {
    expect(parseArgs(['audit']).failOn).toBe('high');
  });

  it('rejects an invalid level with a clean exit', () => {
    expect(main(['audit', '--fail-on', 'critical'])).toBe(1);
  });
});
