# mcp-slim

> Audit your Model Context Protocol (MCP) server configs for **security risks** and **token bloat** — with zero runtime dependencies.

`mcp-slim` is a developer-first CLI that inspects the MCP servers registered with Claude Desktop, Cursor, and Windsurf. It estimates the token footprint each server adds to your context, flags risky permissions (shell execution, broad filesystem access, unpinned packages, plaintext secrets, insecure transports), and can emit a minified, lossless config to trim overhead.

## Features

- **Config auto-discovery** — finds standard config files across macOS, Windows, and Linux, or point it at your own with `--config`.
- **Token audit** — estimates tokens per server (~4 chars/token) and ranks the worst offenders.
- **Security linter** — heuristic checks for shell exec, broad filesystem scopes, unpinned `npx`/`uvx` packages, plaintext secrets, and `http://` endpoints.
- **Lossless compression** — strips insignificant JSON whitespace and collapses whitespace in `description` fields, reporting token savings.
- **Zero runtime dependencies** — the CLI runs on native Node APIs (`fs`, `path`, `os`) only.

## Requirements

- Node.js >= 18

## Usage

No install needed:

```bash
npx mcp-slim audit
```

Or install globally:

```bash
npm install -g mcp-slim
mcp-slim audit
```

### Commands

```
mcp-slim audit                 Scan configs and report token usage + security risks
mcp-slim compress              Emit a minified, lossless config and report savings
```

### Options

```
--config <path>   Use a specific config file (skips auto-discovery)
--json            Output machine-readable JSON
-h, --help        Show help
-v, --version     Show version
```

### Examples

```bash
# Audit every config the tool can find
npx mcp-slim audit

# Audit a specific file
npx mcp-slim audit --config ./claude_desktop_config.json

# Get JSON for scripting / CI
npx mcp-slim audit --json

# See how much you could trim
npx mcp-slim compress
```

### Exit codes

| Code | Meaning                                  |
| ---- | ---------------------------------------- |
| 0    | Success, no high-severity issues         |
| 1    | Usage error or no config found           |
| 2    | `audit` found at least one HIGH finding  |

This lets you gate CI on config hygiene:

```bash
npx mcp-slim audit || echo "MCP config needs attention"
```

## Discovered config locations

| Product        | macOS                                                                 | Windows                                             | Linux                                            |
| -------------- | --------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json`     | `%APPDATA%\Claude\claude_desktop_config.json`       | `~/.config/Claude/claude_desktop_config.json`    |
| Cursor         | `~/.cursor/mcp.json`                                                   | `~/.cursor/mcp.json`                                | `~/.cursor/mcp.json`                             |
| Windsurf       | `~/.codeium/windsurf/mcp_config.json`                                 | `~/.codeium/windsurf/mcp_config.json`               | `~/.codeium/windsurf/mcp_config.json`            |

## How token estimation works

v1.0 measures the **static config** — the serialized JSON for each server definition — using the common ~4-characters-per-token heuristic. It does **not** launch servers to introspect their live tool schemas over JSON-RPC (planned for a later release), so treat the numbers as a lower bound and a useful proxy for config bloat.

## Development

```bash
npm install
npm run build     # tsc -> dist/
npm run lint
npm test
```

## License

MIT
