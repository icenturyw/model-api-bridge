# Repository Guidelines

## Project Structure
`src/` is the Node.js backend: `server.js` entrypoint, `app.js` all HTTP routing + proxy logic (1114 lines), `config.js` env-driven settings, `store.js` SQLite persistence (1556 lines). `public/admin/` is a zero-build hash-based SPA — no bundler, no build step. `scripts/` is daemon management for Linux (`.sh`) and Windows (`.bat`). Runtime SQLite files live in `data/`; `data-backups/` contains automated timestamped snapshots — never edit by hand.

## Commands
Requires Node.js 22+. **Zero npm dependencies** — stdlib only.

- `npm start` — start the gateway + admin console
- `npm test` — run all tests
- `node --test --experimental-test-isolation=none src/store.test.js` — run a single test file
- `node src/server.js` — start without npm

`--experimental-test-isolation=none` is required because integration tests mock `global.fetch` (tests share the global scope).

Default URLs: `http://127.0.0.1:8787/admin` (console), `http://127.0.0.1:8787/v1` (OpenAI-compatible API).

The gateway proxies three paths: `/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`.

## Coding Conventions
CommonJS modules. 2-space indentation, semicolons. No ESLint or Prettier configured — match surrounding style manually. `camelCase` variables, `PascalCase` classes (`Store`).

## Testing
Uses Node's built-in `node:test` runner with `node:assert/strict`. Test files must be named `*.test.js`.

Tests create temporary SQLite databases in `os.tmpdir()` and clean up with `fs.rmSync(dbPath, { force: true })`. The `createApp(overrides)` function accepts `dbPath`, `dataDir`, `disableHealthMonitor`, and other overrides for testing. `global.fetch` is mocked in integration tests — restore it in `finally` blocks.

Never depend on live provider APIs in tests.

## Environment Variables
| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `8787` | Listen port |
| `DATA_DIR` | `<cwd>/data` | Data directory |
| `PROVIDER_TIMEOUT_MS` | `25000` | Upstream fetch timeout (ms) |
| `FAILURE_THRESHOLD` | `3` | Consecutive failures before unhealthy |
| `HEALTHCHECK_INTERVAL_MS` | `60000` | Health check probe interval (ms) |

## Security
Never commit real API keys or populated `data/router.db` files. The gateway key is stored as a SHA-256 hash (see `app.js:hashToken`). Routes with 404 responses are auto-deleted (self-healing).
