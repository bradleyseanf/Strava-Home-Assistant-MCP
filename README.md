# Strava Home Assistant MCP

## Modes

Local mode:

```bash
STRAVA_DB_MODE=local
STRAVA_DB_PATH=/opt/strava-mcp-data/strava_mcp.db
```

SSH mode:

```bash
STRAVA_DB_MODE=ssh
STRAVA_DB_PATH=/config/strava_mcp.db
STRAVA_SSH_HOST=home-assistant-vm.example.local
STRAVA_SSH_USER=your-ssh-user
STRAVA_SSH_PORT=22
STRAVA_SSH_KEY_PATH=/home/youruser/.ssh/strava_mcp_ha
```

The server remains read-only and only exposes MCP tools for querying `strava_activities`.
