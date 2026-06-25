# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Node.js backend: `server.js` is the entrypoint, `app.js` wires HTTP routes and proxy logic, `config.js` reads environment-driven settings, and `store.js` manages SQLite persistence. `public/admin/` holds the admin SPA: `main.js` is the controller, `router.js` provides hash-based routing, `api.js` wraps fetch, `utils.js` has shared helpers, `views/` contains one module per view, and `components/` holds reusable UI pieces (modal, table, form, status). `scripts/` contains deployment scripts for both Linux (`.sh`) and Windows (`.bat`). Runtime SQLite files live in `data/`; timestamped snapshots in `data-backups/` are operational artifacts and should not be edited by hand.

## Build, Test, and Development Commands
Use Node.js 22 or newer.

- `npm start`: starts the gateway and admin console via `node src/server.js`.
- `npm test`: runs the built-in Node test runner with `--experimental-test-isolation=none`.
- `node src/server.js`: direct local run when you want to bypass `npm`.

Default local URLs are `http://127.0.0.1:8787/admin` for the console and `http://127.0.0.1:8787/v1` for the OpenAI-compatible API.

## Coding Style & Naming Conventions
Follow the existing style: CommonJS modules, 2-space indentation, semicolons, and single quotes only when required by the surrounding file style. Prefer small, single-purpose functions and keep helpers near their call sites. Use `camelCase` for variables and functions, `PascalCase` for classes like `Store`, and clear file names such as `config.js` or `server.js`.

This repository does not currently include ESLint or Prettier. Match the surrounding formatting manually and keep changes minimal.

## Testing Guidelines
The project uses Node's built-in `node:test` runner. Add tests alongside future work using `*.test.js` naming so they are picked up by `npm test`. Focus coverage on routing fallbacks, auth/session handling, config parsing, and SQLite-backed state changes. Avoid depending on live provider APIs in tests.

## Commit & Pull Request Guidelines
Git history is not available in this workspace, so commit conventions cannot be inferred directly. Use short, imperative commit messages such as `Add provider timeout fallback`. Keep each commit scoped to one change.

For pull requests, include:

- a brief summary of behavior changes
- any new environment variables or data migrations
- test evidence from `npm test`
- screenshots for admin UI changes in `public/`

## Security & Configuration Tips
Do not commit real API keys or populated `data/router.db` files. Prefer environment variables such as `PORT`, `HOST`, `DATA_DIR`, `PROVIDER_TIMEOUT_MS`, `FAILURE_THRESHOLD`, and `HEALTHCHECK_INTERVAL_MS` for local configuration.
