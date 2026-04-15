const path = require("node:path");

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadConfig(overrides = {}) {
  const cwd = overrides.cwd || process.cwd();
  const dataDir = overrides.dataDir ?? process.env.DATA_DIR ?? path.join(cwd, "data");

  return {
    host: overrides.host ?? process.env.HOST ?? "127.0.0.1",
    port: overrides.port ?? toInt(process.env.PORT, 8787),
    dataDir,
    dbPath: overrides.dbPath ?? path.join(dataDir, "router.db"),
    sessionTtlMs: overrides.sessionTtlMs ?? 1000 * 60 * 60 * 24 * 7,
    defaultProviderTimeoutMs:
      overrides.defaultProviderTimeoutMs ?? toInt(process.env.PROVIDER_TIMEOUT_MS, 25000),
    failureThreshold: overrides.failureThreshold ?? toInt(process.env.FAILURE_THRESHOLD, 3),
    healthCheckIntervalMs:
      overrides.healthCheckIntervalMs ?? toInt(process.env.HEALTHCHECK_INTERVAL_MS, 60000),
    disableHealthMonitor: Boolean(overrides.disableHealthMonitor),
  };
}

module.exports = { loadConfig };
