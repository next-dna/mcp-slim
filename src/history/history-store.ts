/**
 * Token-footprint history store.
 *
 * Persists {@link TokenSnapshot} records as append-only JSONL (one JSON object
 * per line) in a local file, so the `trends` command can report how a config's
 * token footprint changes over time. Zero runtime dependencies: `fs`, `os`,
 * `path` only.
 *
 * Writing is best-effort — a failure to record must never break `audit`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { TokenSnapshot } from '../types';

/**
 * Resolve the history file path.
 *
 * Precedence: explicit `custom` (e.g. `--history`), then the
 * `MCP_SLIM_HISTORY` environment variable, then `~/.mcp-slim/history.jsonl`.
 */
export function getHistoryPath(custom?: string): string {
  if (custom && custom.length > 0) {
    return path.resolve(custom);
  }
  const fromEnv = process.env.MCP_SLIM_HISTORY;
  if (fromEnv && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }
  return path.join(os.homedir(), '.mcp-slim', 'history.jsonl');
}

/**
 * Append snapshots to the history file as JSONL.
 *
 * Best-effort: any error (permissions, read-only fs, …) is swallowed and
 * reported via the return value rather than thrown, so callers in the `audit`
 * path are never interrupted.
 *
 * @returns true when the snapshots were written, false otherwise.
 */
export function appendSnapshots(snapshots: TokenSnapshot[], custom?: string): boolean {
  if (snapshots.length === 0) {
    return true;
  }
  try {
    const file = getHistoryPath(custom);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lines = snapshots.map((s) => JSON.stringify(s)).join('\n') + '\n';
    fs.appendFileSync(file, lines, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Read all snapshots from the history file.
 *
 * Returns an empty array when the file does not exist. Malformed or blank
 * lines are skipped so a single corrupt entry never breaks the report.
 */
export function readHistory(custom?: string): TokenSnapshot[] {
  const file = getHistoryPath(custom);
  let contents: string;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new Error(`Unable to read history at ${file}: ${(err as Error).message}`);
  }

  const snapshots: TokenSnapshot[] = [];
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const obj = JSON.parse(trimmed) as Partial<TokenSnapshot>;
      if (
        typeof obj.ts === 'string' &&
        typeof obj.totalTokens === 'number' &&
        typeof obj.source === 'string'
      ) {
        snapshots.push({
          ts: obj.ts,
          source: obj.source,
          path: typeof obj.path === 'string' ? obj.path : '',
          totalTokens: obj.totalTokens,
          serverCount: typeof obj.serverCount === 'number' ? obj.serverCount : 0,
        });
      }
    } catch {
      // Skip malformed line.
    }
  }
  return snapshots;
}
