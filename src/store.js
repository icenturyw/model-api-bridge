const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function nowIso() {
  return new Date().toISOString();
}

function maskKey(value) {
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function dateKey(input) {
  return new Date(input).toISOString().slice(0, 10);
}

function monthKey(input) {
  return new Date(input).toISOString().slice(0, 7);
}

function minuteKey(input) {
  return new Date(input).toISOString().slice(0, 16);
}

function toFlag(value, fallback = 1) {
  if (value === undefined) {
    return fallback;
  }
  return value ? 1 : 0;
}

class Store {
  constructor(dbPath, options = {}) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.failureThreshold = options.failureThreshold || 3;
    this.init();
  }

  init() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        timeout_ms INTEGER NOT NULL DEFAULT 25000,
        requests_per_minute INTEGER NOT NULL DEFAULT 0,
        minute_window_started_at TEXT,
        minute_window_count INTEGER NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        api_key TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        health_status TEXT NOT NULL DEFAULT 'healthy',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_success_at TEXT,
        last_checked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS model_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        capability_level TEXT NOT NULL,
        fallback_policy TEXT NOT NULL DEFAULT 'same-group',
        enabled INTEGER NOT NULL DEFAULT 1,
        forced_route_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        group_id INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (group_id) REFERENCES model_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS model_routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        provider_key_id INTEGER NOT NULL,
        provider_model_name TEXT NOT NULL,
        route_order INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        daily_limit INTEGER NOT NULL DEFAULT 0,
        monthly_limit INTEGER NOT NULL DEFAULT 0,
        daily_used INTEGER NOT NULL DEFAULT 0,
        monthly_used INTEGER NOT NULL DEFAULT 0,
        warning_threshold INTEGER NOT NULL DEFAULT 80,
        last_rate_limited_at TEXT,
        last_daily_reset_at TEXT NOT NULL,
        last_monthly_reset_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (group_id) REFERENCES model_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (provider_key_id) REFERENCES provider_keys(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requested_model TEXT NOT NULL,
        routed_provider TEXT,
        routed_model TEXT,
        switched INTEGER NOT NULL DEFAULT 0,
        status_code INTEGER,
        latency_ms INTEGER,
        error_code TEXT,
        error_detail TEXT,
        switch_reason TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS switch_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requested_model TEXT NOT NULL,
        from_target TEXT NOT NULL,
        to_target TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_request_logs_requested_model ON request_logs(requested_model);
      CREATE INDEX IF NOT EXISTS idx_switch_events_created_at ON switch_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_switch_events_requested_model ON switch_events(requested_model);
    `);

    const requestLogColumns = this.db.prepare("PRAGMA table_info(request_logs)").all();
    if (!requestLogColumns.some((column) => column.name === "error_detail")) {
      this.db.exec("ALTER TABLE request_logs ADD COLUMN error_detail TEXT");
    }

    const modelRouteColumns = this.db.prepare("PRAGMA table_info(model_routes)").all();
    if (!modelRouteColumns.some((column) => column.name === "last_rate_limited_at")) {
      this.db.exec("ALTER TABLE model_routes ADD COLUMN last_rate_limited_at TEXT");
    }

    const providerColumns = this.db.prepare("PRAGMA table_info(providers)").all();
    if (!providerColumns.some((column) => column.name === "requests_per_minute")) {
      this.db.exec("ALTER TABLE providers ADD COLUMN requests_per_minute INTEGER NOT NULL DEFAULT 0");
    }
    if (!providerColumns.some((column) => column.name === "minute_window_started_at")) {
      this.db.exec("ALTER TABLE providers ADD COLUMN minute_window_started_at TEXT");
    }
    if (!providerColumns.some((column) => column.name === "minute_window_count")) {
      this.db.exec("ALTER TABLE providers ADD COLUMN minute_window_count INTEGER NOT NULL DEFAULT 0");
    }

    this.ensureVolcengineDedicatedGroup();
  }

  close() {
    this.db.close();
  }

  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getSetting(key) {
    return this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value || null;
  }

  setSetting(key, value) {
    const now = nowIso();
    this.db
      .prepare(
        `
          INSERT INTO settings (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `
      )
      .run(key, value, now);
  }

  hasAdmin() {
    const row = this.db.prepare("SELECT COUNT(*) AS total FROM admins").get();
    return row.total > 0;
  }

  createAdmin({ username = "admin", passwordHash, salt }) {
    const createdAt = nowIso();
    const info = this.db
      .prepare(
        "INSERT INTO admins (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(username, passwordHash, salt, createdAt);
    return Number(info.lastInsertRowid);
  }

  getAdminByUsername(username = "admin") {
    return this.db.prepare("SELECT * FROM admins WHERE username = ?").get(username) || null;
  }

  updateAdminPassword(adminId, { passwordHash, salt }) {
    this.db
      .prepare("UPDATE admins SET password_hash = ?, salt = ? WHERE id = ?")
      .run(passwordHash, salt, adminId);
  }

  createSession(adminId, tokenHash, expiresAt) {
    this.db
      .prepare(
        "INSERT INTO sessions (admin_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(adminId, tokenHash, expiresAt, nowIso());
  }

  getSession(tokenHash) {
    return (
      this.db
        .prepare(
          `
            SELECT sessions.*, admins.username
            FROM sessions
            JOIN admins ON admins.id = sessions.admin_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
          `
        )
        .get(tokenHash, nowIso()) || null
    );
  }

  deleteSession(tokenHash) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  pruneSessions() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());
  }

  createProvider(payload) {
    const now = nowIso();
    return this.transaction(() => {
      const info = this.db
        .prepare(
          `
            INSERT INTO providers
              (name, base_url, enabled, timeout_ms, requests_per_minute, minute_window_started_at, minute_window_count, priority, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)
          `
        )
        .run(
          payload.name,
          payload.baseUrl,
          toFlag(payload.enabled, 1),
          payload.timeoutMs || 25000,
          payload.requestsPerMinute ?? 0,
          payload.priority ?? 100,
          now,
          now
        );

      const providerId = Number(info.lastInsertRowid);
      if (Array.isArray(payload.keys)) {
        payload.keys.forEach((keyPayload) => this.addProviderKey(providerId, keyPayload));
      }

      return this.getProvider(providerId);
    });
  }

  getProvider(providerId) {
    const provider = this.db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId);
    if (!provider) {
      return null;
    }
    const keys = this.db
      .prepare("SELECT * FROM provider_keys WHERE provider_id = ? ORDER BY id DESC")
      .all(providerId)
      .map((row) => ({
        ...row,
        masked_key: maskKey(row.api_key),
        api_key: undefined,
      }));

    return {
      ...this.hydrateProviderRateState(provider),
      keys,
    };
  }

  listProviders() {
    const providers = this.db
      .prepare("SELECT * FROM providers ORDER BY priority ASC, name COLLATE NOCASE ASC")
      .all()
      .map((provider) => this.hydrateProviderRateState(provider));
    const keys = this.db
      .prepare("SELECT * FROM provider_keys ORDER BY provider_id ASC, id DESC")
      .all();

    const byProvider = new Map(
      providers.map((provider) => [
        provider.id,
        {
          ...provider,
          keys: [],
        },
      ])
    );

    keys.forEach((row) => {
      const provider = byProvider.get(row.provider_id);
      if (!provider) {
        return;
      }
      provider.keys.push({
        ...row,
        masked_key: maskKey(row.api_key),
        api_key: undefined,
      });
    });

    return Array.from(byProvider.values());
  }

  updateProvider(providerId, payload) {
    const existing = this.db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId);
    if (!existing) {
      throw new Error("Provider not found");
    }

    const now = nowIso();
    this.db
      .prepare(
        `
          UPDATE providers
          SET name = ?, base_url = ?, enabled = ?, timeout_ms = ?, requests_per_minute = ?, priority = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        payload.name ?? existing.name,
        payload.baseUrl ?? existing.base_url,
        payload.enabled === undefined ? existing.enabled : toFlag(payload.enabled),
        payload.timeoutMs ?? existing.timeout_ms,
        payload.requestsPerMinute ?? existing.requests_per_minute,
        payload.priority ?? existing.priority,
        now,
        providerId
      );

    return this.getProvider(providerId);
  }

  addProviderKey(providerId, payload) {
    const now = nowIso();
    const apiKey = payload.apiKey ?? "";
    const info = this.db
      .prepare(
        `
          INSERT INTO provider_keys
            (provider_id, label, api_key, enabled, health_status, consecutive_failures, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'healthy', 0, ?, ?)
        `
      )
      .run(providerId, payload.label || `key-${Date.now()}`, apiKey, toFlag(payload.enabled, 1), now, now);

    return this.getProviderKey(Number(info.lastInsertRowid));
  }

  getProviderKey(keyId) {
    const row = this.db
      .prepare(
        `
          SELECT provider_keys.*, providers.name AS provider_name, providers.base_url, providers.timeout_ms,
                 providers.priority, providers.enabled AS provider_enabled,
                 providers.requests_per_minute, providers.minute_window_started_at, providers.minute_window_count
          FROM provider_keys
          JOIN providers ON providers.id = provider_keys.provider_id
          WHERE provider_keys.id = ?
        `
      )
      .get(keyId);

    return row
      ? {
          ...this.hydrateProviderRateState(row),
          masked_key: maskKey(row.api_key),
        }
      : null;
  }

  updateProviderKey(keyId, payload) {
    const existing = this.getProviderKey(keyId);
    if (!existing) {
      throw new Error("Provider key not found");
    }

    this.db
      .prepare(
        `
          UPDATE provider_keys
          SET label = ?, api_key = ?, enabled = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        payload.label ?? existing.label,
        payload.apiKey ?? existing.api_key,
        payload.enabled === undefined ? existing.enabled : toFlag(payload.enabled),
        nowIso(),
        keyId
      );

    return this.getProviderKey(keyId);
  }

  listProviderKeyOptions() {
    return this.db
      .prepare(
        `
          SELECT provider_keys.id, provider_keys.label, provider_keys.enabled, provider_keys.health_status,
                 providers.name AS provider_name
          FROM provider_keys
          JOIN providers ON providers.id = provider_keys.provider_id
          ORDER BY providers.priority ASC, providers.name COLLATE NOCASE ASC, provider_keys.id DESC
        `
      )
      .all();
  }

  ensureVolcengineDedicatedGroup() {
    const volcengineProviders = this.db
      .prepare(
        `
          SELECT id, name
          FROM providers
          WHERE lower(name) = 'volcengine' OR lower(base_url) LIKE '%volces.com%'
          ORDER BY id ASC
        `
      )
      .all();

    if (volcengineProviders.length === 0) {
      return;
    }

    const existingGroup = this.db
      .prepare("SELECT * FROM model_groups WHERE lower(name) = 'volcengine'")
      .get();
    if (existingGroup) {
      return;
    }

    const providerIds = volcengineProviders.map((provider) => provider.id);
    const placeholders = providerIds.map(() => "?").join(", ");
    const routes = this.db
      .prepare(
        `
          SELECT model_routes.id, model_routes.group_id, model_groups.capability_level, model_groups.fallback_policy
          FROM model_routes
          JOIN provider_keys ON provider_keys.id = model_routes.provider_key_id
          JOIN model_groups ON model_groups.id = model_routes.group_id
          WHERE provider_keys.provider_id IN (${placeholders})
          ORDER BY model_routes.id ASC
        `
      )
      .all(...providerIds);

    if (routes.length === 0) {
      return;
    }

    const sourceGroups = Array.from(new Set(routes.map((route) => route.group_id)));
    if (sourceGroups.length !== 1) {
      return;
    }

    const template = routes[0];
    const now = nowIso();

    this.transaction(() => {
      const createInfo = this.db
        .prepare(
          `
            INSERT INTO model_groups (name, capability_level, fallback_policy, enabled, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
          `
        )
        .run("volcengine", template.capability_level || "standard", template.fallback_policy || "same-group", now, now);

      const groupId = Number(createInfo.lastInsertRowid);
      const routeIds = routes.map((route) => route.id);
      const routePlaceholders = routeIds.map(() => "?").join(", ");

      this.db
        .prepare(`UPDATE model_groups SET forced_route_id = NULL WHERE forced_route_id IN (${routePlaceholders})`)
        .run(...routeIds);
      this.db
        .prepare(
          `
            UPDATE model_routes
            SET group_id = ?, updated_at = ?
            WHERE id IN (${routePlaceholders})
          `
        )
        .run(groupId, now, ...routeIds);
    });
  }

  createModelGroup(payload) {
    const now = nowIso();
    const info = this.db
      .prepare(
        `
          INSERT INTO model_groups (name, capability_level, fallback_policy, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        payload.name,
        payload.capabilityLevel || "standard",
        payload.fallbackPolicy || "same-group",
        toFlag(payload.enabled, 1),
        now,
        now
      );

    return this.getModelGroup(Number(info.lastInsertRowid));
  }

  createModelAlias(payload) {
    const group = this.getModelGroup(payload.groupId);
    if (!group) {
      throw new Error("Model group not found");
    }

    const now = nowIso();
    const info = this.db
      .prepare(
        `
          INSERT INTO model_aliases (name, group_id, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(payload.name, payload.groupId, toFlag(payload.enabled, 1), now, now);

    return this.getModelAlias(Number(info.lastInsertRowid));
  }

  getModelAlias(aliasId) {
    return (
      this.db
        .prepare(
          `
            SELECT model_aliases.*, model_groups.name AS group_name, model_groups.capability_level,
                   model_groups.fallback_policy, model_groups.enabled AS group_enabled
            FROM model_aliases
            JOIN model_groups ON model_groups.id = model_aliases.group_id
            WHERE model_aliases.id = ?
          `
        )
        .get(aliasId) || null
    );
  }

  listModelAliases() {
    return this.db
      .prepare(
        `
          SELECT model_aliases.*, model_groups.name AS group_name, model_groups.capability_level,
                 model_groups.fallback_policy, model_groups.enabled AS group_enabled
          FROM model_aliases
          JOIN model_groups ON model_groups.id = model_aliases.group_id
          ORDER BY model_aliases.name COLLATE NOCASE ASC
        `
      )
      .all();
  }

  updateModelAlias(aliasId, payload) {
    const existing = this.getModelAlias(aliasId);
    if (!existing) {
      throw new Error("Model alias not found");
    }

    const nextGroupId = payload.groupId ?? existing.group_id;
    const group = this.getModelGroup(nextGroupId);
    if (!group) {
      throw new Error("Model group not found");
    }

    this.db
      .prepare(
        `
          UPDATE model_aliases
          SET name = ?, group_id = ?, enabled = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        payload.name ?? existing.name,
        nextGroupId,
        payload.enabled === undefined ? existing.enabled : toFlag(payload.enabled),
        nowIso(),
        aliasId
      );

    return this.getModelAlias(aliasId);
  }

  getModelGroup(groupId) {
    const group = this.db.prepare("SELECT * FROM model_groups WHERE id = ?").get(groupId);
    if (!group) {
      return null;
    }

    const routes = this.db
      .prepare(
        `
          SELECT model_routes.*,
                 providers.name AS provider_name,
                 providers.enabled AS provider_enabled,
                 provider_keys.label AS provider_key_label,
                 provider_keys.enabled AS key_enabled,
                 provider_keys.health_status
          FROM model_routes
          JOIN provider_keys ON provider_keys.id = model_routes.provider_key_id
          JOIN providers ON providers.id = provider_keys.provider_id
          WHERE model_routes.group_id = ?
          ORDER BY model_routes.route_order ASC, model_routes.id ASC
        `
      )
      .all(groupId)
      .map((route) => this.hydrateQuotaState(route));

    return { ...group, routes };
  }

  listModelGroups() {
    return this.db
      .prepare("SELECT id FROM model_groups ORDER BY name COLLATE NOCASE ASC")
      .all()
      .map((row) => this.getModelGroup(row.id));
  }

  updateModelGroup(groupId, payload) {
    const existing = this.db.prepare("SELECT * FROM model_groups WHERE id = ?").get(groupId);
    if (!existing) {
      throw new Error("Model group not found");
    }

    this.db
      .prepare(
        `
          UPDATE model_groups
          SET name = ?, capability_level = ?, fallback_policy = ?, enabled = ?, forced_route_id = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        payload.name ?? existing.name,
        payload.capabilityLevel ?? existing.capability_level,
        payload.fallbackPolicy ?? existing.fallback_policy,
        payload.enabled === undefined ? existing.enabled : toFlag(payload.enabled),
        payload.forcedRouteId === undefined ? existing.forced_route_id : payload.forcedRouteId,
        nowIso(),
        groupId
      );

    return this.getModelGroup(groupId);
  }

  addModelRoute(groupId, payload) {
    const now = nowIso();
    const info = this.db
      .prepare(
        `
          INSERT INTO model_routes
            (group_id, provider_key_id, provider_model_name, route_order, enabled, daily_limit, monthly_limit, daily_used, monthly_used, warning_threshold, last_daily_reset_at, last_monthly_reset_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
        `
      )
      .run(
        groupId,
        payload.providerKeyId,
        payload.providerModelName,
        payload.order ?? 100,
        toFlag(payload.enabled, 1),
        payload.dailyLimit ?? 0,
        payload.monthlyLimit ?? 0,
        payload.warningThreshold ?? 80,
        now,
        now,
        now,
        now
      );

    return this.getModelRoute(Number(info.lastInsertRowid));
  }

  getModelRoute(routeId) {
    const route = this.db
      .prepare(
        `
          SELECT model_routes.*,
                 model_groups.name AS group_name,
                 providers.id AS provider_id,
                 providers.name AS provider_name,
                 providers.base_url,
                 providers.priority AS provider_priority,
                 providers.timeout_ms,
                 providers.enabled AS provider_enabled,
                 providers.requests_per_minute,
                 providers.minute_window_started_at,
                 providers.minute_window_count,
                 provider_keys.label AS provider_key_label,
                 provider_keys.api_key,
                 provider_keys.enabled AS key_enabled,
                 provider_keys.health_status,
                 provider_keys.last_error
          FROM model_routes
          JOIN model_groups ON model_groups.id = model_routes.group_id
          JOIN provider_keys ON provider_keys.id = model_routes.provider_key_id
          JOIN providers ON providers.id = provider_keys.provider_id
          WHERE model_routes.id = ?
        `
      )
      .get(routeId);

    return route ? this.hydrateProviderRateState(this.hydrateQuotaState(route)) : null;
  }

  updateModelRoute(routeId, payload) {
    const existing = this.getModelRoute(routeId);
    if (!existing) {
      throw new Error("Model route not found");
    }

    this.db
      .prepare(
        `
          UPDATE model_routes
          SET provider_key_id = ?, provider_model_name = ?, route_order = ?, enabled = ?,
              daily_limit = ?, monthly_limit = ?, warning_threshold = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        payload.providerKeyId ?? existing.provider_key_id,
        payload.providerModelName ?? existing.provider_model_name,
        payload.order ?? existing.route_order,
        payload.enabled === undefined ? existing.enabled : toFlag(payload.enabled),
        payload.dailyLimit ?? existing.daily_limit,
        payload.monthlyLimit ?? existing.monthly_limit,
        payload.warningThreshold ?? existing.warning_threshold,
        nowIso(),
        routeId
      );

    return this.getModelRoute(routeId);
  }

  deleteModelRoute(routeId) {
    const existing = this.getModelRoute(routeId);
    if (!existing) {
      throw new Error("Model route not found");
    }

    this.transaction(() => {
      this.db
        .prepare("UPDATE model_groups SET forced_route_id = NULL WHERE forced_route_id = ?")
        .run(routeId);
      this.db.prepare("DELETE FROM model_routes WHERE id = ?").run(routeId);
    });
  }

  listQuotaItems(filters = {}) {
    const items = this.db
      .prepare(
        `
          SELECT model_routes.id, model_routes.group_id, provider_keys.provider_id, model_groups.name AS group_name, model_routes.provider_model_name,
                 model_routes.daily_limit, model_routes.monthly_limit, model_routes.daily_used, model_routes.monthly_used, model_routes.warning_threshold,
                 model_routes.enabled, providers.name AS provider_name, provider_keys.label AS provider_key_label,
                 provider_keys.health_status, providers.enabled AS provider_enabled, provider_keys.enabled AS key_enabled,
                 model_routes.last_daily_reset_at, model_routes.last_monthly_reset_at
          FROM model_routes
          JOIN model_groups ON model_groups.id = model_routes.group_id
          JOIN provider_keys ON provider_keys.id = model_routes.provider_key_id
          JOIN providers ON providers.id = provider_keys.provider_id
          ORDER BY model_groups.name COLLATE NOCASE ASC, model_routes.route_order ASC
        `
      )
      .all()
      .map((row) => this.hydrateQuotaState(row));

    return items.filter((item) => {
      if (filters.groupId && item.group_id !== Number(filters.groupId)) {
        return false;
      }
      if (filters.providerId && item.provider_id !== Number(filters.providerId)) {
        return false;
      }
      if (filters.status === "warning" && !item.warning_reached) {
        return false;
      }
      if (filters.status === "exhausted" && !item.quota_exhausted) {
        return false;
      }
      if (filters.status === "normal" && (item.warning_reached || item.quota_exhausted)) {
        return false;
      }
      return true;
    });
  }

  updateQuota(routeId, payload) {
    const route = this.getModelRoute(routeId);
    if (!route) {
      throw new Error("Quota target not found");
    }
    this.db
      .prepare(
        `
          UPDATE model_routes
          SET daily_limit = ?, monthly_limit = ?, warning_threshold = ?, enabled = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        payload.dailyLimit ?? route.daily_limit,
        payload.monthlyLimit ?? route.monthly_limit,
        payload.warningThreshold ?? route.warning_threshold,
        payload.enabled === undefined ? route.enabled : toFlag(payload.enabled),
        nowIso(),
        routeId
      );
    return this.getModelRoute(routeId);
  }

  resetQuota(routeId, period = "all") {
    const route = this.getModelRoute(routeId);
    if (!route) {
      throw new Error("Quota target not found");
    }
    const now = nowIso();
    this.db
      .prepare(
        `
          UPDATE model_routes
          SET daily_used = ?, monthly_used = ?, last_daily_reset_at = ?, last_monthly_reset_at = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        period === "monthly" ? route.daily_used : 0,
        period === "daily" ? route.monthly_used : 0,
        period === "monthly" ? route.last_daily_reset_at : now,
        period === "daily" ? route.last_monthly_reset_at : now,
        now,
        routeId
      );
    return this.getModelRoute(routeId);
  }

  hydrateQuotaState(route) {
    const now = nowIso();
    let dailyUsed = route.daily_used ?? 0;
    let monthlyUsed = route.monthly_used ?? 0;
    let lastDailyResetAt = route.last_daily_reset_at || now;
    let lastMonthlyResetAt = route.last_monthly_reset_at || now;
    let changed = false;

    if (dateKey(lastDailyResetAt) !== dateKey(now)) {
      dailyUsed = 0;
      lastDailyResetAt = now;
      changed = route.id !== undefined;
    }

    if (monthKey(lastMonthlyResetAt) !== monthKey(now)) {
      monthlyUsed = 0;
      lastMonthlyResetAt = now;
      changed = route.id !== undefined;
    }

    if (changed) {
      this.db
        .prepare(
          `
            UPDATE model_routes
            SET daily_used = ?, monthly_used = ?, last_daily_reset_at = ?, last_monthly_reset_at = ?, updated_at = ?
            WHERE id = ?
          `
        )
        .run(dailyUsed, monthlyUsed, lastDailyResetAt, lastMonthlyResetAt, now, route.id);
    }

    const dailyRemaining = route.daily_limit > 0 ? Math.max(route.daily_limit - dailyUsed, 0) : null;
    const monthlyRemaining =
      route.monthly_limit > 0 ? Math.max(route.monthly_limit - monthlyUsed, 0) : null;
    const dailyPercent =
      route.daily_limit > 0 ? Math.floor((dailyUsed / route.daily_limit) * 100) : 0;
    const monthlyPercent =
      route.monthly_limit > 0 ? Math.floor((monthlyUsed / route.monthly_limit) * 100) : 0;
    const warningReached =
      (route.daily_limit > 0 && dailyPercent >= route.warning_threshold) ||
      (route.monthly_limit > 0 && monthlyPercent >= route.warning_threshold);
    const quotaExhausted =
      (route.daily_limit > 0 && dailyUsed >= route.daily_limit) ||
      (route.monthly_limit > 0 && monthlyUsed >= route.monthly_limit);
    const rateLimitedToday =
      Boolean(route.last_rate_limited_at) && dateKey(route.last_rate_limited_at) === dateKey(now);

    return {
      ...route,
      daily_used: dailyUsed,
      monthly_used: monthlyUsed,
      last_daily_reset_at: lastDailyResetAt,
      last_monthly_reset_at: lastMonthlyResetAt,
      daily_remaining: dailyRemaining,
      monthly_remaining: monthlyRemaining,
      daily_percent: dailyPercent,
      monthly_percent: monthlyPercent,
      rate_limited_today: rateLimitedToday,
      warning_reached: warningReached,
      quota_exhausted: quotaExhausted,
    };
  }

  hydrateProviderRateState(provider) {
    const now = nowIso();
    let minuteWindowStartedAt = provider.minute_window_started_at || null;
    let minuteWindowCount = provider.minute_window_count ?? 0;
    let changed = false;

    if (provider.requests_per_minute > 0) {
      if (!minuteWindowStartedAt || minuteKey(minuteWindowStartedAt) !== minuteKey(now)) {
        minuteWindowStartedAt = now;
        minuteWindowCount = 0;
        changed = provider.id !== undefined;
      }
    } else if (minuteWindowCount !== 0 || minuteWindowStartedAt) {
      minuteWindowStartedAt = null;
      minuteWindowCount = 0;
      changed = provider.id !== undefined;
    }

    if (changed) {
      this.db
        .prepare(
          `
            UPDATE providers
            SET minute_window_started_at = ?, minute_window_count = ?, updated_at = ?
            WHERE id = ?
          `
        )
        .run(minuteWindowStartedAt, minuteWindowCount, now, provider.id);
    }

    const minuteRemaining =
      provider.requests_per_minute > 0
        ? Math.max(provider.requests_per_minute - minuteWindowCount, 0)
        : null;
    const minuteRateLimited =
      provider.requests_per_minute > 0 && minuteWindowCount >= provider.requests_per_minute;

    return {
      ...provider,
      minute_window_started_at: minuteWindowStartedAt,
      minute_window_count: minuteWindowCount,
      minute_remaining: minuteRemaining,
      minute_rate_limited: minuteRateLimited,
    };
  }

  resolveModelTarget(requestedModel) {
    const alias = this.db
      .prepare(
        `
          SELECT model_aliases.*, model_groups.name AS group_name, model_groups.capability_level,
                 model_groups.fallback_policy, model_groups.enabled AS group_enabled,
                 model_groups.forced_route_id, model_groups.created_at AS group_created_at,
                 model_groups.updated_at AS group_updated_at
          FROM model_aliases
          JOIN model_groups ON model_groups.id = model_aliases.group_id
          WHERE model_aliases.name = ?
        `
      )
      .get(requestedModel);

    if (alias) {
      if (!alias.enabled || !alias.group_enabled) {
        return { alias, group: null };
      }

      return {
        alias,
        group: {
          id: alias.group_id,
          name: alias.group_name,
          capability_level: alias.capability_level,
          fallback_policy: alias.fallback_policy,
          enabled: alias.group_enabled,
          forced_route_id: alias.forced_route_id,
          created_at: alias.group_created_at,
          updated_at: alias.group_updated_at,
        },
      };
    }

    const group = this.db.prepare("SELECT * FROM model_groups WHERE name = ?").get(requestedModel);
    if (!group || !group.enabled) {
      return { alias: null, group: null };
    }

    return { alias: null, group };
  }

  getRoutingPlan(requestedModel) {
    const resolved = this.resolveModelTarget(requestedModel);
    if (!resolved.group) {
      return { alias: resolved.alias, group: null, routes: [] };
    }
    const group = resolved.group;

    const routes = this.db
      .prepare(
        `
          SELECT model_routes.*,
                 providers.name AS provider_name,
                 providers.base_url,
                 providers.priority AS provider_priority,
                 providers.timeout_ms,
                 providers.enabled AS provider_enabled,
                 providers.requests_per_minute,
                 providers.minute_window_started_at,
                 providers.minute_window_count,
                 provider_keys.label AS provider_key_label,
                 provider_keys.api_key,
                 provider_keys.enabled AS key_enabled,
                 provider_keys.health_status,
                 provider_keys.last_error
          FROM model_routes
          JOIN provider_keys ON provider_keys.id = model_routes.provider_key_id
          JOIN providers ON providers.id = provider_keys.provider_id
          WHERE model_routes.group_id = ?
          ORDER BY
            CASE WHEN substr(model_routes.last_rate_limited_at, 1, 10) = ? THEN 1 ELSE 0 END ASC,
            CASE WHEN model_routes.id = ? THEN 0 ELSE 1 END ASC,
            model_routes.route_order ASC,
            providers.priority ASC,
            model_routes.id ASC
        `
      )
      .all(group.id, dateKey(nowIso()), group.forced_route_id || -1)
      .map((route) => {
        const hydrated = this.hydrateProviderRateState(this.hydrateQuotaState(route));
        let skipReason = null;
        if (!hydrated.enabled) {
          skipReason = "route-disabled";
        } else if (!hydrated.provider_enabled) {
          skipReason = "provider-disabled";
        } else if (!hydrated.key_enabled) {
          skipReason = "key-disabled";
        } else if (hydrated.health_status === "unhealthy") {
          skipReason = "health-unhealthy";
        } else if (hydrated.minute_rate_limited) {
          skipReason = "provider-rate-limited";
        } else if (hydrated.quota_exhausted) {
          skipReason = "quota-exhausted";
        }
        return {
          ...hydrated,
          target_name: `${hydrated.provider_name}/${hydrated.provider_model_name}`,
          skip_reason: skipReason,
          usable: !skipReason,
        };
      });

    return { alias: resolved.alias, group, routes };
  }

  consumeRoute(routeId) {
    return this.transaction(() => {
      const route = this.getModelRoute(routeId);
      if (!route) {
        throw new Error("Route not found");
      }
      if (route.quota_exhausted) {
        throw new Error("Route quota exhausted");
      }
      const provider = this.hydrateProviderRateState(
        this.db.prepare("SELECT * FROM providers WHERE id = ?").get(route.provider_id)
      );
      if (provider.requests_per_minute > 0 && provider.minute_window_count >= provider.requests_per_minute) {
        throw new Error("Provider minute rate limit exhausted");
      }
      this.db
        .prepare(
          `
            UPDATE model_routes
            SET daily_used = ?, monthly_used = ?, updated_at = ?
            WHERE id = ?
          `
        )
        .run(route.daily_used + 1, route.monthly_used + 1, nowIso(), routeId);
      if (provider.requests_per_minute > 0) {
        this.db
          .prepare(
            `
              UPDATE providers
              SET minute_window_started_at = ?, minute_window_count = ?, updated_at = ?
              WHERE id = ?
            `
          )
          .run(
            provider.minute_window_started_at || nowIso(),
            provider.minute_window_count + 1,
            nowIso(),
            provider.id
          );
      }
      return this.getModelRoute(routeId);
    });
  }

  recordRequestLog(payload) {
    this.db
      .prepare(
        `
          INSERT INTO request_logs
            (requested_model, routed_provider, routed_model, switched, status_code, latency_ms, error_code, error_detail, switch_reason, attempts, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        payload.requestedModel,
        payload.routedProvider || null,
        payload.routedModel || null,
        toFlag(payload.switched, 0),
        payload.statusCode ?? null,
        payload.latencyMs ?? null,
        payload.errorCode || null,
        payload.errorDetail || null,
        payload.switchReason || null,
        payload.attempts || 0,
        nowIso()
      );
  }

  listRequestLogs(options = {}) {
    if (typeof options === "number") {
      options = { limit: options };
    }
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 100;
    const clauses = [];
    const values = [];

    if (options.model) {
      clauses.push("requested_model = ?");
      values.push(options.model);
    }

    if (options.provider) {
      clauses.push("routed_provider = ?");
      values.push(options.provider);
    }

    if (options.status) {
      if (options.status === "success") {
        clauses.push("status_code >= 200 AND status_code < 400");
      } else if (options.status === "error") {
        clauses.push("(status_code IS NULL OR status_code >= 400)");
      } else if (/^\\d{3}$/.test(String(options.status))) {
        clauses.push("status_code = ?");
        values.push(Number(options.status));
      }
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT * FROM request_logs ${whereClause} ORDER BY id DESC LIMIT ?`)
      .all(...values, limit);
  }

  recordSwitch(payload) {
    this.db
      .prepare(
        `
          INSERT INTO switch_events (requested_model, from_target, to_target, reason, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(payload.requestedModel, payload.fromTarget, payload.toTarget, payload.reason, nowIso());
  }

  listSwitchEvents(options = {}) {
    if (typeof options === "number") {
      options = { limit: options };
    }
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 100;
    const clauses = [];
    const values = [];

    if (options.model) {
      clauses.push("requested_model = ?");
      values.push(options.model);
    }

    if (options.reason) {
      clauses.push("reason = ?");
      values.push(options.reason);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT * FROM switch_events ${whereClause} ORDER BY id DESC LIMIT ?`)
      .all(...values, limit);
  }

  markProviderKeySuccess(keyId) {
    this.db
      .prepare(
        `
          UPDATE provider_keys
          SET consecutive_failures = 0, health_status = 'healthy', last_error = NULL,
              last_success_at = ?, last_checked_at = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(nowIso(), nowIso(), nowIso(), keyId);
  }

  markProviderKeyFailure(keyId, errorMessage) {
    const key = this.getProviderKey(keyId);
    if (!key) {
      return;
    }
    const nextFailures = (key.consecutive_failures || 0) + 1;
    const status = nextFailures >= this.failureThreshold ? "unhealthy" : "degraded";
    this.db
      .prepare(
        `
          UPDATE provider_keys
          SET consecutive_failures = ?, health_status = ?, last_error = ?, last_checked_at = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(nextFailures, status, errorMessage || "unknown-error", nowIso(), nowIso(), keyId);
  }

  markRouteRateLimited(routeId) {
    this.db
      .prepare(
        `
          UPDATE model_routes
          SET last_rate_limited_at = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(nowIso(), nowIso(), routeId);
  }

  listHealthCheckTargets() {
    return this.db
      .prepare(
        `
          SELECT provider_keys.id, provider_keys.label, provider_keys.api_key, provider_keys.enabled, provider_keys.health_status,
                 providers.name AS provider_name, providers.base_url, providers.timeout_ms, providers.enabled AS provider_enabled,
                 providers.requests_per_minute, providers.minute_window_started_at, providers.minute_window_count
          FROM provider_keys
          JOIN providers ON providers.id = provider_keys.provider_id
          WHERE provider_keys.enabled = 1 AND providers.enabled = 1
          ORDER BY providers.priority ASC, provider_keys.id ASC
        `
      )
      .all()
      .map((target) => this.hydrateProviderRateState(target));
  }

  listRoutableModels() {
    const groups = this.listModelGroups().filter((group) => group.enabled);
    const routableGroups = groups.filter((group) =>
      group.routes.some(
        (route) =>
          route.enabled &&
          route.provider_enabled &&
          route.key_enabled &&
          route.health_status !== "unhealthy" &&
          !route.quota_exhausted
      )
    );
    const routableGroupIds = new Set(routableGroups.map((group) => group.id));
    const aliases = this.listModelAliases().filter(
      (alias) => alias.enabled && alias.group_enabled && routableGroupIds.has(alias.group_id)
    );
    const aliasedGroupIds = new Set(aliases.map((alias) => alias.group_id));

    return [
      ...aliases.map((alias) => ({
        id: `alias-${alias.id}`,
        object: "model",
        owned_by: "model-api-bridge",
        created: Math.floor(new Date(alias.created_at).getTime() / 1000),
        name: alias.name,
        capability_level: alias.capability_level,
        target_group: alias.group_name,
      })),
      ...routableGroups
        .filter((group) => !aliasedGroupIds.has(group.id))
        .map((group) => ({
          id: `logical-${group.id}`,
          object: "model",
          owned_by: "model-api-bridge",
          created: Math.floor(new Date(group.created_at).getTime() / 1000),
          name: group.name,
          capability_level: group.capability_level,
          target_group: group.name,
        })),
    ];
  }

  getDashboardSummary() {
    const providers = this.listProviders();
    const quotas = this.listQuotaItems();
    const requestCountToday =
      this.db
        .prepare("SELECT COUNT(*) AS total FROM request_logs WHERE substr(created_at, 1, 10) = ?")
        .get(dateKey(nowIso())).total || 0;
    const recentSwitches = this.listSwitchEvents({ limit: 10 });
    const soonExhausted = quotas
      .filter((item) => item.warning_reached || item.quota_exhausted)
      .slice(0, 10);

    return {
      totals: {
        providers: providers.length,
        providerKeys: providers.reduce((sum, provider) => sum + provider.keys.length, 0),
        modelGroups: this.listModelGroups().length,
        modelAliases: this.listModelAliases().length,
        requestCountToday,
      },
      providerHealth: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        enabled: Boolean(provider.enabled),
        healthyKeys: provider.keys.filter((key) => key.health_status === "healthy").length,
        degradedKeys: provider.keys.filter((key) => key.health_status === "degraded").length,
        unhealthyKeys: provider.keys.filter((key) => key.health_status === "unhealthy").length,
      })),
      soonExhausted,
      recentSwitches,
    };
  }

  getOverview() {
    const summary = this.getDashboardSummary();
    const recentErrors = this.db
      .prepare(
        `
          SELECT *
          FROM request_logs
          WHERE status_code IS NULL OR status_code >= 400
          ORDER BY id DESC
          LIMIT 10
        `
      )
      .all();

    return {
      ...summary,
      recentErrors,
    };
  }

  getProviderDetail(providerId) {
    const provider = this.getProvider(providerId);
    if (!provider) {
      return null;
    }

    const routeStats = this.db
      .prepare(
        `
          SELECT COUNT(*) AS route_count
          FROM model_routes
          JOIN provider_keys ON provider_keys.id = model_routes.provider_key_id
          WHERE provider_keys.provider_id = ?
        `
      )
      .get(providerId);

    const attachedGroups = this.db
      .prepare(
        `
          SELECT DISTINCT model_groups.id, model_groups.name
          FROM model_routes
          JOIN provider_keys ON provider_keys.id = model_routes.provider_key_id
          JOIN model_groups ON model_groups.id = model_routes.group_id
          WHERE provider_keys.provider_id = ?
          ORDER BY model_groups.name COLLATE NOCASE ASC
        `
      )
      .all(providerId);

    return {
      ...provider,
      stats: {
        routeCount: routeStats.route_count,
        keyCount: provider.keys.length,
      },
      attachedGroups,
    };
  }

  listProvidersForAdmin() {
    const routeCounts = new Map(
      this.db
        .prepare(
          `
            SELECT provider_keys.provider_id, COUNT(*) AS route_count
            FROM model_routes
            JOIN provider_keys ON provider_keys.id = model_routes.provider_key_id
            GROUP BY provider_keys.provider_id
          `
        )
        .all()
        .map((row) => [row.provider_id, row.route_count])
    );

    return this.listProviders().map((provider) => ({
      ...provider,
      stats: {
        keyCount: provider.keys.length,
        routeCount: routeCounts.get(provider.id) || 0,
        healthyKeys: provider.keys.filter((key) => key.health_status === "healthy").length,
        degradedKeys: provider.keys.filter((key) => key.health_status === "degraded").length,
        unhealthyKeys: provider.keys.filter((key) => key.health_status === "unhealthy").length,
      },
    }));
  }

  getRoutingCatalog() {
    return {
      groups: this.listModelGroups(),
      aliases: this.listModelAliases(),
      providerKeyOptions: this.listProviderKeyOptions(),
    };
  }

  getRoutingGroupDetail(groupId) {
    const group = this.getModelGroup(groupId);
    if (!group) {
      return null;
    }

    return {
      ...group,
      aliases: this.listModelAliases().filter((alias) => alias.group_id === groupId),
    };
  }

  getSystemSummary() {
    return {
      gatewayApiKeyConfigured: Boolean(this.getSetting("gateway_api_key_hash")),
      preferredExternalModelName: this.getPreferredExternalModelName(),
    };
  }

  listDistinctModels() {
    return this.db
      .prepare("SELECT DISTINCT requested_model FROM request_logs ORDER BY requested_model COLLATE NOCASE ASC")
      .all()
      .map((row) => row.requested_model);
  }

  listDistinctProviders() {
    return this.db
      .prepare("SELECT DISTINCT name FROM providers ORDER BY name COLLATE NOCASE ASC")
      .all()
      .map((row) => row.name);
  }

  listDistinctSwitchReasons() {
    return this.db
      .prepare("SELECT DISTINCT reason FROM switch_events ORDER BY reason COLLATE NOCASE ASC")
      .all()
      .map((row) => row.reason);
  }

  getPreferredExternalModelName() {
    const alias = this.listModelAliases().find((item) => item.enabled && item.group_enabled);
    if (alias) {
      return alias.name;
    }

    const group = this.listModelGroups().find((item) => item.enabled);
    if (group) {
      return group.name;
    }

    return "gpt-4-class";
  }
}

module.exports = { Store, maskKey };
