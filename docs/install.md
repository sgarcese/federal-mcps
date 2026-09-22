# Installing the BLS server

**Status:** current · developer install guide for `@federal-mcps/server-bls`. Just want
to add the hosted server to Claude with no install? See [`connect.md`](connect.md) — a
one-screen, copy-paste quickstart. This page covers running the server yourself.

The server exposes the family verb set — `bls_resolve_place`, `bls_list_indicators`,
`bls_get_indicator`, `bls_compare_places`, `bls_get_raw`, `bls_describe_source` — across
six BLS programs (LAUS, CES State & Area, QCEW, OEWS, CPI, JOLTS).

There are three ways to connect: local stdio from the npm package, local stdio from a
checkout of this repository, and the remote HTTP endpoint (deployed per ADR-007).

## Claude Code — stdio, from npm

Add to your project's `.mcp.json` (or run `claude mcp add`):

```json
{
  "mcpServers": {
    "bls": {
      "command": "npx",
      "args": ["-y", "@federal-mcps/server-bls"]
    }
  }
}
```

`npx` resolves the package's `bin`, `federal-mcps-bls` (`packages/server-bls/package.json`
`bin`), which speaks MCP over stdio. No API key or network access beyond the BLS API is
required for `bls_describe_source`.

## Claude Code — stdio, from a local checkout

Useful while developing this repository, or before the package is published:

```bash
npm ci
npm run build -w packages/server-bls
```

```json
{
  "mcpServers": {
    "bls": {
      "command": "node",
      "args": ["packages/server-bls/dist/stdio.js"]
    }
  }
}
```

Use an absolute path for `args` if `.mcp.json` is not read relative to the repository
root by your host.

## Claude Desktop

Claude Desktop reads the same shape from its own config file
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "bls": {
      "command": "npx",
      "args": ["-y", "@federal-mcps/server-bls"]
    }
  }
}
```

The local-checkout variant above (`command: "node"`, `args: ["packages/server-bls/dist/stdio.js"]`)
works the same way there.

## Remote HTTP — Claude's custom connectors

The deployed server (ADR-007) answers Streamable HTTP at:

```
https://bls.responsive.city/mcp
```

Add it in Claude as a custom connector (Settings → Connectors → Add custom connector)
with that URL. No authentication is required — the server serves public BLS data with no
end-user auth (ADR-002 §Decision, "Auth"), and each deploy is verified per SHA by a
post-deploy tool call (`scripts/deploy.sh`, #97). For a non-developer walkthrough of this
path across hosts, see [`connect.md`](connect.md).

## Verifying the connection

However you connect, ask the model to call `bls_describe_source` (or just ask "what can
the BLS server tell me?"). A working connection returns a provenance-wrapped result
listing LAUS, CES State & Area, QCEW, OEWS, CPI and JOLTS, all `available`, plus the
API quota note and the citation format.
