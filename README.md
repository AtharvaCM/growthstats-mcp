# growthstats-mcp

This repository contains Model Context Protocol (MCP) servers for Growthstats.

## Servers

- **ContentOps**: queries Sanity, audits content for SEO issues, and triggers Next.js revalidation.

## Development

Install dependencies and build the TypeScript sources:

```bash
npm install
npm run build
```

The server entry is configured in `mcp.json` and can be started via an MCP-compatible runtime or directly with Node:

```bash
node dist/servers/contentops/index.js
```
