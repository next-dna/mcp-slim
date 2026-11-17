/**
 * Config auto-discovery.
 *
 * Locates the standard MCP client config files across macOS, Windows and
 * Linux, reads them, and normalizes them into {@link McpConfigFile} values.
 *
 * Zero runtime dependencies: only `fs`, `path` and `os` are used.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { McpConfigFile, McpServerConfig } from '../types';

/** A candidate config location plus the product it belongs to. */
export interface CandidatePath {
  path: string;
  source: string;
}

/**
 * Build the list of platform-specific candidate config paths.
 *
 * The caller is responsible for checking which of these actually exist.
 */
export function getCandidatePaths(platform: NodeJS.Platform = process.platform): CandidatePath[] {
  const home = os.homedir();
  const candidates: CandidatePath[] = [];

  if (platform === 'darwin') {
    candidates.push({
      source: 'Claude Desktop',
      path: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    });
    candidates.push({
      source: 'Cursor',
      path: path.join(home, '.cursor', 'mcp.json'),
    });
    candidates.push({
      source: 'Windsurf',
      path: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    });
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    candidates.push({
      source: 'Claude Desktop',
      path: path.join(appData, 'Claude', 'claude_desktop_config.json'),
    });
    candidates.push({
      source: 'Cursor',
      path: path.join(home, '.cursor', 'mcp.json'),
    });
    candidates.push({
      source: 'Windsurf',
      path: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    });
  } else {
    // Linux and other POSIX platforms.
    const configHome = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
    candidates.push({
      source: 'Claude Desktop',
      path: path.join(configHome, 'Claude', 'claude_desktop_config.json'),
    });
    candidates.push({
      source: 'Cursor',
      path: path.join(home, '.cursor', 'mcp.json'),
    });
    candidates.push({
      source: 'Windsurf',
      path: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    });
  }

  return candidates;
}

/**
 * Extract the server map from a parsed config object.
 *
 * Different clients nest servers under `mcpServers` (Claude, Cursor) and some
 * older/alternate layouts use `servers`. Both are handled.
 */
function extractServers(raw: Record<string, unknown>): Record<string, McpServerConfig> {
  const container =
    (raw.mcpServers as Record<string, unknown> | undefined) ??
    (raw.servers as Record<string, unknown> | undefined);

  if (!container || typeof container !== 'object') {
    return {};
  }

  const servers: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(container)) {
    if (value && typeof value === 'object') {
      servers[name] = value as McpServerConfig;
    }
  }
  return servers;
}

/**
 * Read and parse a single config file.
 *
 * Returns `null` when the file is missing. Throws a descriptive error when the
 * file exists but cannot be parsed as JSON.
 */
export function loadConfigFile(filePath: string, source = 'Custom'): McpConfigFile | null {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new Error(`Unable to read config at ${filePath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Config at ${filePath} is not a JSON object.`);
  }

  const raw = parsed as Record<string, unknown>;
  return {
    path: filePath,
    source,
    servers: extractServers(raw),
    raw,
  };
}

/**
 * Discover all available MCP configs.
 *
 * When `customPath` is provided, only that file is loaded (and a missing file
 * is reported as an error, since the user explicitly asked for it). Otherwise,
 * every existing standard location for the current platform is returned.
 */
export function discoverConfigs(customPath?: string): McpConfigFile[] {
  if (customPath) {
    const resolved = path.resolve(customPath);
    const config = loadConfigFile(resolved, 'Custom');
    if (!config) {
      throw new Error(`No config file found at ${resolved}`);
    }
    return [config];
  }

  const found: McpConfigFile[] = [];
  for (const candidate of getCandidatePaths()) {
    const config = loadConfigFile(candidate.path, candidate.source);
    if (config) {
      found.push(config);
    }
  }
  return found;
}
