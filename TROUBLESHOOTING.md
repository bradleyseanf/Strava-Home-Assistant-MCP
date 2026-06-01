# Troubleshooting MCP Connection Issues

If ChatGPT or another MCP client is failing to connect after updating this fork, try these steps:

## Step 1: Clear npx Cache

The old package might be cached. Clear it:

```bash
rm -rf ~/.npm/_npx
```

## Step 2: Verify Your MCP Client Config

Make sure your MCP client is pointed at the current package name:

```json
{
  "mcpServers": {
    "strava": {
      "command": "npx",
      "args": ["-y", "@r-huijts/strava-mcp-server"]
    }
  }
}
```

**Important:** Remove any old references to `strava-mcp-server` or `@bradleyseanf/strava-mcp-server`.

## Step 3: Restart Your MCP Client

1. Quit the client completely
2. Reopen it
3. The MCP server should start automatically

## Step 4: Test Manually

Test if the package works:

```bash
npx -y @r-huijts/strava-mcp-server
```

You should see: "Starting Strava MCP Server v1.2.1..."

## Step 5: Check Client Logs

If it still doesn't work, check the client developer console for error messages.
