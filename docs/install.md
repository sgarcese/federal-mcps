# Installing the BLS server

**Status:** current · covers Release 1's only server, `@federal-mcps/server-bls`
(issue #8). The server exposes one tool today, `bls_describe_source` — see
`docs/architecture.md` ("Release 1: BLS only") for what lands in later milestones.

There are three ways to connect: local stdio from the npm package, local stdio from a
checkout of this repository, and the remote HTTP endpoint once it is deployed (issue
#10).

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

Once issue #10 deploys the server (ADR-004 §5), it answers Streamable HTTP at:

```
https://bls-mcp.responsive.city/mcp
```

Add it in Claude as a custom connector (Settings → Connectors → Add custom connector)
with that URL. No authentication is required — Release 1 serves public BLS data with no
end-user auth (ADR-002 §Decision, "Auth"). **This endpoint does not exist yet**; it comes
online with issue #10's deploy and is verified per merge SHA by a post-deploy
`initialize` + `tools/list` check (`docs/architecture.md`, "Deployment").

## Verifying the connection

However you connect, ask the model to call `bls_describe_source` (or just ask "what can
the BLS server tell me?"). A working connection returns a provenance-wrapped result
listing LAUS, CES State & Area, QCEW, OEWS, CPI and JOLTS, all marked `planned` in this
release, plus the 500-queries/day API quota note and the citation format.
