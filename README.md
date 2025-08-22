# growthstats-mcp

This repository contains Model Context Protocol (MCP) servers for Growthstats.

## Servers

- **ContentOps**: queries Sanity, audits content for SEO issues, and triggers Next.js revalidation.
- **DevWorkflow**: runs semantic-release in dry mode, enforces PR title version tags, and generates conventional changelogs.

## Development

Install dependencies and build the TypeScript sources:

```bash
npm install
npm run build
```

The servers are configured in `mcp.json` and can be started via an MCP-compatible runtime or directly with Node. Example:

```bash
node packages/servers/contentops/dist/index.js
node packages/servers/devworkflow/dist/index.js
```
