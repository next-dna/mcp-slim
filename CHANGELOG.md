# Changelog

All notable changes to this project are documented here. This file is
maintained automatically by [release-please](https://github.com/googleapis/release-please)
from [Conventional Commits](https://www.conventionalcommits.org/); do not edit
it by hand.

## 1.0.0 (2026-11-17)

### Features

- Initial release of `@nextdna/mcp-slim`.
- `audit` command: per-server token-footprint estimation and a security linter
  (shell execution, broad filesystem scopes, unpinned packages, plaintext
  secrets, insecure transports).
- `compress` command: lossless minified config with a token-savings report.
- Cross-platform config auto-discovery for Claude Desktop, Cursor and Windsurf.
- Zero runtime dependencies; requires Node.js >= 18.
