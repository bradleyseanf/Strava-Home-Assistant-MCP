# Security Check

Run:

```bash
npm run security-check
```

This preflight is meant to run before connecting real Strava data.

What it verifies:

- Required production environment variables are set
- `PUBLIC_BASE_URL` uses `https://` and includes the private app path
- The encrypted secret store lives in `.strava/` or an approved server-side path
- Remote OAuth auth is enabled in the production server entrypoint
- The MCP endpoint rejects unauthenticated requests
- No token-leaking log strings are present in `src/` or `scripts/`
- Dependency audit output is reviewed
- The production `npm start` path is the remote HTTP server, not the legacy stdio path

Notes:

- `STRAVA_REFRESH_TOKEN` is an optional bootstrap input.
- The local-first `.strava/` secret store keeps the project self-contained for development; production can still point `MCP_SECRET_PATH` at a different absolute path if desired.
