const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Readable } = require("node:stream");
const { loadConfig } = require("./config");
const { Store } = require("./store");

function hashToken(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timingSafeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
}

function createPasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

function verifyPassword(password, passwordHash, salt) {
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(check, "hex"), Buffer.from(passwordHash, "hex"));
}

function json(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function text(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function noContent(res, headers = {}) {
  res.writeHead(204, headers);
  res.end();
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const [key, ...rest] = part.split("=");
      accumulator[key] = decodeURIComponent(rest.join("="));
      return accumulator;
    }, {});
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

async function readJsonBody(req) {
  const chunks = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw new BodyTooLargeError();
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.statusCode = 413;
  }
}

function normalizeBaseUrl(baseUrl, endpointPath) {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
  if (trimmedBase.endsWith("/v1") && normalizedPath.startsWith("/v1/")) {
    return `${trimmedBase}${normalizedPath.slice(3)}`;
  }
  if (trimmedBase.endsWith("/api/v3") && normalizedPath.startsWith("/v1/")) {
    return `${trimmedBase}${normalizedPath.slice(3)}`;
  }
  return `${trimmedBase}${normalizedPath}`;
}

function isSwitchableStatus(status) {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

function wantsStream(body) {
  return body && body.stream === true;
}

function setSessionCookie(token, config) {
  const maxAge = Math.floor(config.sessionTtlMs / 1000);
  return `admin_session=${encodeURIComponent(
    token
  )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return "admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
}

function compactErrorDetail(value, maxLength = 1500) {
  if (!value) {
    return null;
  }
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function deleteMissingRoute(store, route) {
  try {
    store.deleteModelRoute(route.id);
    return true;
  } catch {
    return false;
  }
}

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function getContentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream";
}

function sendStaticFile(res, filePath, headers = {}) {
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": getContentType(filePath),
    "Content-Length": body.length,
    ...headers,
  });
  res.end(body);
}

function trySendStaticAsset(res, rootDir, pathname) {
  const relativePath = pathname.replace(/^\/+/, "");
  const absolutePath = path.join(rootDir, relativePath);

  if (!absolutePath.startsWith(rootDir)) {
    return false;
  }

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return false;
  }

  const cacheControl = absolutePath.includes(`${path.sep}admin${path.sep}`) || absolutePath.endsWith(".html")
    ? "no-cache"
    : "public, max-age=31536000, immutable";
  sendStaticFile(res, absolutePath, { "Cache-Control": cacheControl });
  return true;
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildGatewaySnippet(req, gatewayKeyConfigured) {
  const host = req.headers.host || "127.0.0.1:8787";
  return {
    baseURL: `http://${host}/v1`,
    apiKeyConfigured: gatewayKeyConfigured,
    exampleModel: "chat-main",
  };
}

function buildProviderAuthHeaders(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const store = new Store(config.dbPath, { failureThreshold: config.failureThreshold });
  const publicDir = path.join(__dirname, "..", "public");
  const adminDir = path.join(publicDir, "admin");
  let healthMonitor = null;

  async function forwardToProvider(route, endpointPath, requestBody) {
    const controller = new AbortController();
    const timeoutMs = route.timeout_ms || config.defaultProviderTimeoutMs;
    const timeout = setTimeout(() => controller.abort(new Error("provider-timeout")), timeoutMs);

    try {
      const upstreamResponse = await fetch(normalizeBaseUrl(route.base_url, endpointPath), {
        method: "POST",
        headers: {
          ...buildProviderAuthHeaders(route.api_key),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return { ok: upstreamResponse.ok, upstreamResponse, errorCode: null };
    } catch (error) {
      clearTimeout(timeout);
      return {
        ok: false,
        upstreamResponse: null,
        errorCode: error.name === "AbortError" ? "timeout" : "network-error",
        errorMessage: error.message,
      };
    }
  }

  async function probeKey(target) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("healthcheck-timeout")),
      target.timeout_ms || config.defaultProviderTimeoutMs
    );
    try {
      const response = await fetch(normalizeBaseUrl(target.base_url, "/v1/models"), {
        method: "GET",
        headers: buildProviderAuthHeaders(target.api_key),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        store.markProviderKeySuccess(target.id);
      } else {
        store.markProviderKeyFailure(target.id, `healthcheck-${response.status}`);
      }
    } catch (error) {
      clearTimeout(timeout);
      store.markProviderKeyFailure(target.id, error.message);
    }
  }

  async function runHealthChecks() {
    const targets = store.listHealthCheckTargets();
    for (const target of targets) {
      await probeKey(target);
    }
  }

  function requireGatewayAuth(req, res) {
    const configuredHash = store.getSetting("gateway_api_key_hash");
    if (!configuredHash) {
      return true;
    }
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token || !timingSafeCompare(hashToken(token), configuredHash)) {
      json(res, 401, {
        error: {
          message: "Missing or invalid gateway API key",
          type: "authentication_error",
        },
      });
      return false;
    }
    return true;
  }

  function requireAdminSession(req, res) {
    store.pruneSessions();
    const token = parseCookies(req).admin_session;
    if (!token) {
      json(res, 401, { error: "Authentication required" });
      return null;
    }
    const session = store.getSession(hashToken(token));
    if (!session) {
      json(res, 401, { error: "Session expired" }, { "Set-Cookie": clearSessionCookie() });
      return null;
    }
    return session;
  }

  async function handleGatewayProxy(req, res, endpointPath) {
    if (!requireGatewayAuth(req, res)) {
      return;
    }

    const body = await readJsonBody(req).catch(() => null);
    if (!body) {
      json(res, 400, {
        error: {
          message: "Invalid JSON body",
          type: "invalid_request_error",
        },
      });
      return;
    }

    if (!body.model) {
      json(res, 400, {
        error: {
          message: "The request body must include a model field",
          type: "invalid_request_error",
        },
      });
      return;
    }

    const routingPlan = store.getRoutingPlan(body.model);
    if (!routingPlan.group) {
      store.recordRequestLog({
        requestedModel: body.model,
        statusCode: 404,
        errorCode: "model-not-found",
        attempts: 0,
      });
      json(res, 404, {
        error: {
          message: `Model group "${body.model}" was not found or is disabled`,
          type: "invalid_request_error",
        },
      });
      return;
    }

    const routes = routingPlan.routes;
    if (routes.length === 0) {
      store.recordRequestLog({
        requestedModel: body.model,
        statusCode: 503,
        errorCode: "no-routes",
        attempts: 0,
      });
      json(res, 503, {
        error: {
          message: `No routes are configured for model "${body.model}"`,
          type: "server_error",
        },
      });
      return;
    }

    let attempts = 0;
    let switched = false;
    let lastSwitchReason = null;

    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index];
      const nextRoute = routes[index + 1];
      if (!route.usable) {
        if (nextRoute) {
          switched = true;
          lastSwitchReason = route.skip_reason;
          store.recordSwitch({
            requestedModel: body.model,
            fromTarget: route.target_name,
            toTarget: nextRoute.target_name,
            reason: route.skip_reason,
          });
        }
        continue;
      }

      attempts += 1;
      try {
        store.consumeRoute(route.id);
      } catch (error) {
        if (error.message === "Provider minute rate limit exhausted") {
          if (nextRoute) {
            switched = true;
            lastSwitchReason = "provider-rate-limited";
            store.recordSwitch({
              requestedModel: body.model,
              fromTarget: route.target_name,
              toTarget: nextRoute.target_name,
              reason: "provider-rate-limited",
            });
            continue;
          }
          store.recordRequestLog({
            requestedModel: body.model,
            statusCode: 429,
            errorCode: "provider-rate-limited",
            attempts,
            switchReason: "provider-rate-limited",
          });
          json(res, 429, {
            error: {
              message: "All available providers for this model are currently rate limited per minute",
              type: "rate_limit_error",
            },
          });
          return;
        }
        if (nextRoute) {
          switched = true;
          lastSwitchReason = "quota-exhausted";
          store.recordSwitch({
            requestedModel: body.model,
            fromTarget: route.target_name,
            toTarget: nextRoute.target_name,
            reason: "quota-exhausted",
          });
          continue;
        }
        store.recordRequestLog({
          requestedModel: body.model,
          statusCode: 429,
          errorCode: "quota-exhausted",
          attempts,
          switchReason: "quota-exhausted",
        });
        json(res, 429, {
          error: {
            message: "All free request quotas have been exhausted for this model group",
            type: "rate_limit_error",
          },
        });
        return;
      }

      const startedAt = Date.now();
      const upstream = await forwardToProvider(route, endpointPath, {
        ...body,
        model: route.provider_model_name,
      });
      const latencyMs = Date.now() - startedAt;

      if (upstream.upstreamResponse && upstream.upstreamResponse.ok) {
        store.markProviderKeySuccess(route.provider_key_id);
      const routeHeaders = {
          "X-Route-Requested-Model": body.model,
          "X-Route-Group": routingPlan.group.name,
          "X-Route-Provider": route.provider_name,
          "X-Route-Model": route.provider_model_name,
          "X-Route-Switched": switched ? "true" : "false",
        };

        store.recordRequestLog({
          requestedModel: body.model,
          routedProvider: route.provider_name,
          routedModel: route.provider_model_name,
          switched,
          statusCode: upstream.upstreamResponse.status,
          latencyMs,
          attempts,
          switchReason: lastSwitchReason,
        });

        if (wantsStream(body) && upstream.upstreamResponse.body) {
          const headers = {};
          headers["Content-Type"] =
            upstream.upstreamResponse.headers.get("content-type") || "text/event-stream";
          Object.assign(headers, routeHeaders);
          res.writeHead(upstream.upstreamResponse.status, headers);
          Readable.fromWeb(upstream.upstreamResponse.body).pipe(res);
          return;
        }

        const responseText = await upstream.upstreamResponse.text();
        res.writeHead(upstream.upstreamResponse.status, {
          "Content-Type":
            upstream.upstreamResponse.headers.get("content-type") || "application/json",
          ...routeHeaders,
        });
        res.end(responseText);
        return;
      }

      if (!upstream.upstreamResponse) {
        store.markProviderKeyFailure(route.provider_key_id, upstream.errorMessage);
        if (nextRoute) {
          switched = true;
          lastSwitchReason = upstream.errorCode;
          store.recordSwitch({
            requestedModel: body.model,
            fromTarget: route.target_name,
            toTarget: nextRoute.target_name,
            reason: upstream.errorCode,
          });
          continue;
        }

        store.recordRequestLog({
          requestedModel: body.model,
          routedProvider: route.provider_name,
          routedModel: route.provider_model_name,
          switched,
          statusCode: 503,
          latencyMs,
          errorCode: upstream.errorCode,
          errorDetail: compactErrorDetail(upstream.errorMessage),
          switchReason: lastSwitchReason || upstream.errorCode,
          attempts,
        });
        json(res, 503, {
          error: {
            message: upstream.errorMessage || "No upstream provider could satisfy this request",
            type: "server_error",
          },
        });
        return;
      }

      const failureBody = await upstream.upstreamResponse.text();
      if (upstream.upstreamResponse.status === 404) {
        deleteMissingRoute(store, route);
        if (nextRoute) {
          switched = true;
          lastSwitchReason = "status-404-route-deleted";
          store.recordSwitch({
            requestedModel: body.model,
            fromTarget: route.target_name,
            toTarget: nextRoute.target_name,
            reason: lastSwitchReason,
          });
          continue;
        }

        store.recordRequestLog({
          requestedModel: body.model,
          routedProvider: route.provider_name,
          routedModel: route.provider_model_name,
          switched,
          statusCode: 404,
          latencyMs,
          errorCode: "status-404-route-deleted",
          errorDetail: compactErrorDetail(failureBody),
          switchReason: lastSwitchReason,
          attempts,
        });
        res.writeHead(404, {
          "Content-Type": upstream.upstreamResponse.headers.get("content-type") || "application/json",
          "X-Route-Provider": route.provider_name,
          "X-Route-Model": route.provider_model_name,
          "X-Route-Switched": switched ? "true" : "false",
        });
        res.end(failureBody);
        return;
      }

      store.markProviderKeyFailure(route.provider_key_id, `status-${upstream.upstreamResponse.status}`);
      if (upstream.upstreamResponse.status === 429) {
        store.markRouteRateLimited(route.id);
      }

      if (isSwitchableStatus(upstream.upstreamResponse.status) && nextRoute) {
        switched = true;
        lastSwitchReason = `status-${upstream.upstreamResponse.status}`;
        store.recordSwitch({
          requestedModel: body.model,
          fromTarget: route.target_name,
          toTarget: nextRoute.target_name,
          reason: lastSwitchReason,
        });
        continue;
      }

      store.recordRequestLog({
        requestedModel: body.model,
        routedProvider: route.provider_name,
        routedModel: route.provider_model_name,
        switched,
        statusCode: upstream.upstreamResponse.status,
        latencyMs,
        errorCode: `status-${upstream.upstreamResponse.status}`,
        errorDetail: compactErrorDetail(failureBody),
        switchReason: lastSwitchReason,
        attempts,
      });
      res.writeHead(upstream.upstreamResponse.status, {
        "Content-Type": upstream.upstreamResponse.headers.get("content-type") || "application/json",
        "X-Route-Provider": route.provider_name,
        "X-Route-Model": route.provider_model_name,
        "X-Route-Switched": switched ? "true" : "false",
      });
      res.end(failureBody);
      return;
    }

    store.recordRequestLog({
      requestedModel: body.model,
      switched,
      statusCode: 503,
      errorCode: "no-usable-route",
      attempts,
      switchReason: lastSwitchReason,
    });
    json(res, 503, {
      error: {
        message: `All routes for model "${body.model}" are unavailable, unhealthy, disabled, or out of quota`,
        type: "server_error",
      },
    });
  }

  async function testProvider(providerId) {
    const provider = store.getProvider(Number(providerId));
    if (!provider) {
      return { statusCode: 404, payload: { error: "Provider not found" } };
    }
    const testKey = provider.keys.find((key) => key.enabled);
    const baseUrl = provider.base_url;
    const response = await fetch(normalizeBaseUrl(baseUrl, "/v1/models"), {
      method: "GET",
      headers: testKey ? buildProviderAuthHeaders(store.getProviderKey(testKey.id).api_key) : {},
    }).catch((error) => ({ ok: false, status: 503, error }));
    if (!response.ok) {
      return {
        statusCode: response.status || 503,
        payload: {
          ok: false,
          error: response.error ? response.error.message : `Upstream returned ${response.status}`,
        },
      };
    }
    return { statusCode: 200, payload: { ok: true } };
  }

  function buildSystemPayload(req) {
    const summary = store.getSystemSummary();
    return {
      ...summary,
      gateway: {
        ...buildGatewaySnippet(req, summary.gatewayApiKeyConfigured),
        exampleModel: summary.preferredExternalModelName,
      },
    };
  }

  async function handleAdmin(req, res, pathname) {
    if (pathname === "/admin/auth/status" && req.method === "GET") {
      const token = parseCookies(req).admin_session;
      const session = token ? store.getSession(hashToken(token)) : null;
      json(res, 200, {
        needsSetup: !store.hasAdmin(),
        authenticated: Boolean(session),
        username: session?.username || null,
      });
      return;
    }

    if (pathname === "/admin/auth/bootstrap" && req.method === "POST") {
      if (store.hasAdmin()) {
        json(res, 409, { error: "Admin account already exists" });
        return;
      }
      const body = await readJsonBody(req).catch(() => null);
      if (!body || !body.password || body.password.length < 8) {
        json(res, 400, { error: "Password must be at least 8 characters" });
        return;
      }
      const password = createPasswordHash(body.password);
      const adminId = store.createAdmin({
        passwordHash: password.hash,
        salt: password.salt,
      });
      if (body.gatewayApiKey) {
        store.setSetting("gateway_api_key_hash", hashToken(body.gatewayApiKey));
      }
      const sessionToken = crypto.randomBytes(32).toString("hex");
      store.createSession(adminId, hashToken(sessionToken), new Date(Date.now() + config.sessionTtlMs).toISOString());
      json(
        res,
        201,
        { ok: true },
        {
          "Set-Cookie": setSessionCookie(sessionToken, config),
        }
      );
      return;
    }

    if (pathname === "/admin/auth/login" && req.method === "POST") {
      if (!store.hasAdmin()) {
        json(res, 400, { error: "Bootstrap is required before login" });
        return;
      }
      const body = await readJsonBody(req).catch(() => null);
      const admin = store.getAdminByUsername("admin");
      const password = body?.password || "";
      if (!admin || !verifyPassword(password, admin.password_hash, admin.salt)) {
        json(res, 401, { error: "Invalid password" });
        return;
      }
      const sessionToken = crypto.randomBytes(32).toString("hex");
      store.createSession(admin.id, hashToken(sessionToken), new Date(Date.now() + config.sessionTtlMs).toISOString());
      json(
        res,
        200,
        { ok: true },
        {
          "Set-Cookie": setSessionCookie(sessionToken, config),
        }
      );
      return;
    }

    if (pathname === "/admin/auth/logout" && req.method === "POST") {
      const token = parseCookies(req).admin_session;
      if (token) {
        store.deleteSession(hashToken(token));
      }
      noContent(res, { "Set-Cookie": clearSessionCookie() });
      return;
    }

    if (pathname === "/admin" || pathname === "/admin/") {
      sendStaticFile(res, path.join(adminDir, "index.html"), { "Cache-Control": "no-cache" });
      return;
    }

    if (!pathname.startsWith("/admin/api/")) {
      const servedAsset = trySendStaticAsset(res, publicDir, pathname);
      if (servedAsset) {
        return;
      }
    }

    const session = requireAdminSession(req, res);
    if (!session) {
      return;
    }

    if (pathname === "/admin/api/overview" && req.method === "GET") {
      json(res, 200, { data: store.getOverview() });
      return;
    }

    if (pathname === "/admin/api/providers" && req.method === "GET") {
      json(res, 200, {
        data: {
          providers: store.listProvidersForAdmin(),
          providerKeyOptions: store.listProviderKeyOptions(),
        },
      });
      return;
    }

    if (/^\/admin\/api\/providers\/\d+$/.test(pathname) && req.method === "GET") {
      const providerId = Number(pathname.split("/").pop());
      const provider = store.getProviderDetail(providerId);
      if (!provider) {
        json(res, 404, { error: "Provider not found" });
        return;
      }
      json(res, 200, { data: provider });
      return;
    }

    if (pathname === "/admin/api/providers" && req.method === "POST") {
      const body = await readJsonBody(req);
      const provider = store.createProvider({
        name: body.name,
        baseUrl: body.baseUrl,
        enabled: body.enabled,
        timeoutMs: body.timeoutMs,
        requestsPerMinute: body.requestsPerMinute,
        priority: body.priority,
        keys: Array.isArray(body.keys) ? body.keys : [],
      });
      json(res, 201, { data: provider });
      return;
    }

    if (/^\/admin\/api\/providers\/\d+$/.test(pathname) && req.method === "PATCH") {
      const providerId = Number(pathname.split("/").pop());
      const body = await readJsonBody(req);
      const provider = store.updateProvider(providerId, body);
      json(res, 200, { data: provider });
      return;
    }

    if (/^\/admin\/api\/providers\/\d+\/test$/.test(pathname) && req.method === "POST") {
      const providerId = Number(pathname.split("/")[4]);
      const result = await testProvider(providerId);
      json(res, result.statusCode, result.payload);
      return;
    }

    if (pathname === "/admin/api/provider-keys" && req.method === "POST") {
      const body = await readJsonBody(req);
      const key = store.addProviderKey(Number(body.providerId), {
        label: body.label,
        apiKey: body.apiKey,
        enabled: body.enabled,
      });
      json(res, 201, { data: key });
      return;
    }

    if (/^\/admin\/api\/provider-keys\/\d+$/.test(pathname) && req.method === "PATCH") {
      const keyId = Number(pathname.split("/").pop());
      const body = await readJsonBody(req);
      const key = store.updateProviderKey(keyId, body);
      json(res, 200, { data: key });
      return;
    }

    if (pathname === "/admin/api/routing" && req.method === "GET") {
      json(res, 200, { data: store.getRoutingCatalog() });
      return;
    }

    if (/^\/admin\/api\/routing\/groups\/\d+$/.test(pathname) && req.method === "GET") {
      const groupId = Number(pathname.split("/").pop());
      const group = store.getRoutingGroupDetail(groupId);
      if (!group) {
        json(res, 404, { error: "Model group not found" });
        return;
      }
      json(res, 200, { data: group });
      return;
    }

    if (pathname === "/admin/api/model-aliases" && req.method === "POST") {
      const body = await readJsonBody(req);
      const alias = store.createModelAlias({
        name: body.name,
        groupId: Number(body.groupId),
        enabled: body.enabled,
      });
      json(res, 201, { data: alias });
      return;
    }

    if (/^\/admin\/api\/model-aliases\/\d+$/.test(pathname) && req.method === "PATCH") {
      const aliasId = Number(pathname.split("/").pop());
      const body = await readJsonBody(req);
      const alias = store.updateModelAlias(aliasId, {
        name: body.name,
        groupId: body.groupId ? Number(body.groupId) : undefined,
        enabled: body.enabled,
      });
      json(res, 200, { data: alias });
      return;
    }

    if (pathname === "/admin/api/model-groups" && req.method === "POST") {
      const body = await readJsonBody(req);
      const group = store.createModelGroup({
        name: body.name,
        capabilityLevel: body.capabilityLevel,
        fallbackPolicy: body.fallbackPolicy,
        enabled: body.enabled,
      });
      json(res, 201, { data: group });
      return;
    }

    if (/^\/admin\/api\/model-groups\/\d+$/.test(pathname) && req.method === "PATCH") {
      const groupId = Number(pathname.split("/").pop());
      const body = await readJsonBody(req);
      const group = store.updateModelGroup(groupId, body);
      json(res, 200, { data: group });
      return;
    }

    if (pathname === "/admin/api/model-routes" && req.method === "POST") {
      const body = await readJsonBody(req);
      const route = store.addModelRoute(Number(body.groupId), {
        providerKeyId: Number(body.providerKeyId),
        providerModelName: body.providerModelName,
        order: body.order,
        enabled: body.enabled,
        dailyLimit: body.dailyLimit,
        monthlyLimit: body.monthlyLimit,
        warningThreshold: body.warningThreshold,
      });
      json(res, 201, { data: route });
      return;
    }

    if (/^\/admin\/api\/model-routes\/\d+$/.test(pathname) && req.method === "PATCH") {
      const routeId = Number(pathname.split("/").pop());
      const body = await readJsonBody(req);
      const route = store.updateModelRoute(routeId, {
        providerKeyId: body.providerKeyId ? Number(body.providerKeyId) : undefined,
        providerModelName: body.providerModelName,
        order: body.order,
        enabled: body.enabled,
        dailyLimit: body.dailyLimit,
        monthlyLimit: body.monthlyLimit,
        warningThreshold: body.warningThreshold,
      });
      json(res, 200, { data: route });
      return;
    }

    if (/^\/admin\/api\/model-routes\/\d+$/.test(pathname) && req.method === "DELETE") {
      const routeId = Number(pathname.split("/").pop());
      store.deleteModelRoute(routeId);
      noContent(res);
      return;
    }

    if (pathname === "/admin/api/quotas" && req.method === "GET") {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      json(res, 200, {
        data: {
          items: store.listQuotaItems({
            groupId: toOptionalNumber(url.searchParams.get("groupId")),
            providerId: toOptionalNumber(url.searchParams.get("providerId")),
            status: url.searchParams.get("status") || undefined,
          }),
          groups: store.listModelGroups().map((group) => ({ id: group.id, name: group.name })),
          providers: store.listProviders().map((provider) => ({ id: provider.id, name: provider.name })),
        },
      });
      return;
    }

    if (/^\/admin\/api\/quotas\/\d+$/.test(pathname) && req.method === "PATCH") {
      const routeId = Number(pathname.split("/").pop());
      const body = await readJsonBody(req);
      const route = store.updateQuota(routeId, body);
      json(res, 200, { data: route });
      return;
    }

    if (/^\/admin\/api\/quotas\/\d+\/reset$/.test(pathname) && req.method === "POST") {
      const routeId = Number(pathname.split("/")[4]);
      const body = await readJsonBody(req).catch(() => ({}));
      const route = store.resetQuota(routeId, body.period || "all");
      json(res, 200, { data: route });
      return;
    }

    if (pathname === "/admin/api/logs/requests" && req.method === "GET") {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      json(res, 200, {
        data: {
          items: store.listRequestLogs({
            limit: toOptionalNumber(url.searchParams.get("limit")),
            model: url.searchParams.get("model") || undefined,
            provider: url.searchParams.get("provider") || undefined,
            status: url.searchParams.get("status") || undefined,
          }),
          models: store.listDistinctModels(),
          providers: store.listDistinctProviders(),
        },
      });
      return;
    }

    if (pathname === "/admin/api/logs/switches" && req.method === "GET") {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      json(res, 200, {
        data: {
          items: store.listSwitchEvents({
            limit: toOptionalNumber(url.searchParams.get("limit")),
            model: url.searchParams.get("model") || undefined,
            reason: url.searchParams.get("reason") || undefined,
          }),
          models: store.listDistinctModels(),
          reasons: store.listDistinctSwitchReasons(),
        },
      });
      return;
    }

    if (pathname === "/admin/api/system" && req.method === "GET") {
      json(res, 200, { data: buildSystemPayload(req) });
      return;
    }

    if (pathname === "/admin/api/system" && req.method === "PATCH") {
      const body = await readJsonBody(req);
      if (body.gatewayApiKey) {
        store.setSetting("gateway_api_key_hash", hashToken(body.gatewayApiKey));
      }
      json(res, 200, { data: buildSystemPayload(req) });
      return;
    }

    if (pathname === "/admin/api/system/password" && req.method === "POST") {
      const body = await readJsonBody(req);
      const admin = store.getAdminByUsername("admin");
      if (!body.currentPassword || !verifyPassword(body.currentPassword, admin.password_hash, admin.salt)) {
        json(res, 401, { error: "Current password is incorrect" });
        return;
      }
      if (!body.newPassword || body.newPassword.length < 8) {
        json(res, 400, { error: "New password must be at least 8 characters" });
        return;
      }
      const updated = createPasswordHash(body.newPassword);
      store.updateAdminPassword(admin.id, { passwordHash: updated.hash, salt: updated.salt });
      json(res, 200, { data: { ok: true } });
      return;
    }

    if (pathname.startsWith("/admin/")) {
      sendStaticFile(res, path.join(adminDir, "index.html"), { "Cache-Control": "no-cache" });
      return;
    }

    json(res, 404, { error: "Admin route not found" });
  }

  async function requestHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      const pathname = url.pathname;

      if (pathname === "/") {
        text(res, 302, "Redirecting to /admin", { Location: "/admin" });
        return;
      }

      if (pathname === "/healthz") {
        json(res, 200, { ok: true });
        return;
      }

      if (pathname === "/v1/models" && req.method === "GET") {
        if (!requireGatewayAuth(req, res)) {
          return;
        }
        json(res, 200, { object: "list", data: store.listRoutableModels() });
        return;
      }

      if (
        (pathname === "/v1/chat/completions" ||
          pathname === "/v1/responses" ||
          pathname === "/v1/embeddings") &&
        req.method === "POST"
      ) {
        await handleGatewayProxy(req, res, pathname);
        return;
      }

      if (pathname === "/admin" || pathname.startsWith("/admin/")) {
        await handleAdmin(req, res, pathname);
        return;
      }

      text(res, 404, "Not found");
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        json(res, 413, { error: "Request body too large" });
        return;
      }
      json(res, 500, { error: "Internal server error" });
    }
  }

  const server = http.createServer((req, res) => {
    void requestHandler(req, res);
  });

  return {
    config,
    store,
    server,
    async start() {
      await new Promise((resolve) => {
        server.listen(config.port, config.host, resolve);
      });
      if (!config.disableHealthMonitor) {
        healthMonitor = setInterval(() => {
          void runHealthChecks();
        }, config.healthCheckIntervalMs);
        healthMonitor.unref();
      }
      return server.address();
    },
    async stop() {
      if (healthMonitor) {
        clearInterval(healthMonitor);
      }
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      store.close();
    },
  };
}

module.exports = {
  createApp,
  createPasswordHash,
  verifyPassword,
  hashToken,
};
