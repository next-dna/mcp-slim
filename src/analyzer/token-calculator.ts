/**
 * Token & schema audit.
 *
 * Estimates the token footprint each MCP server definition contributes to the
 * client context. We approximate ~4 characters per token, the common
 * rule-of-thumb for JSON-heavy English text.
 *
 * Note: v1.0 measures the *static config* (the serialized server definition),
 * not live tool schemas, which would require launching each server over
 * JSON-RPC. The estimate is a useful proxy for config bloat and a lower bound
 * on real context cost.
 */

import type {
  ConfigTokenReport,
  McpConfigFile,
  McpServerConfig,
  ServerTokenReport,
} from '../types';

/** Average characters per token for JSON schema text. */
export const CHARS_PER_TOKEN = 4;

/**
 * Estimate the number of tokens in a string.
 *
 * Uses the ~4-chars-per-token heuristic, rounding up so that any non-empty
 * input costs at least one token.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Serialize a single server definition to canonical JSON and measure it.
 */
export function analyzeServer(name: string, server: McpServerConfig): ServerTokenReport {
  const json = JSON.stringify(server);
  const chars = json.length;
  return {
    server: name,
    chars,
    tokens: estimateTokens(json),
  };
}

/**
 * Analyze every server in a config file and total the token footprint.
 */
export function analyzeConfig(config: McpConfigFile): ConfigTokenReport {
  const servers = Object.entries(config.servers).map(([name, server]) =>
    analyzeServer(name, server),
  );

  // Descending by tokens so the worst offenders surface first.
  servers.sort((a, b) => b.tokens - a.tokens);

  const totalTokens = servers.reduce((sum, s) => sum + s.tokens, 0);

  return {
    path: config.path,
    source: config.source,
    servers,
    totalTokens,
  };
}
