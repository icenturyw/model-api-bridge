const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("./store");

function createTempDbPath() {
  return path.join(os.tmpdir(), `openclaw-store-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

test("migrates volcengine routes into a dedicated logical group", () => {
  const dbPath = createTempDbPath();
  const store = new Store(dbPath);

  const modelscope = store.createProvider({
    name: "modelscope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    keys: [{ label: "primary", apiKey: "ms-key" }],
  });
  const volcengine = store.createProvider({
    name: "volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    keys: [{ label: "primary", apiKey: "ve-key" }],
  });
  const sharedGroup = store.createModelGroup({
    name: "modelscope",
    capabilityLevel: "standard",
    fallbackPolicy: "same-group",
  });

  store.addModelRoute(sharedGroup.id, {
    providerKeyId: modelscope.keys[0].id,
    providerModelName: "Qwen/Qwen3.5-27B",
  });
  const volcengineRoute = store.addModelRoute(sharedGroup.id, {
    providerKeyId: volcengine.keys[0].id,
    providerModelName: "doubao-seed-1-6-thinking-250715",
  });

  store.close();

  const migratedStore = new Store(dbPath);
  const groups = migratedStore.listModelGroups();
  const volcengineGroup = groups.find((group) => group.name === "volcengine");
  const modelscopeGroup = groups.find((group) => group.name === "modelscope");

  assert.ok(volcengineGroup, "expected volcengine group to be created");
  assert.ok(modelscopeGroup, "expected original group to remain");
  assert.equal(volcengineGroup.routes.length, 1);
  assert.equal(volcengineGroup.routes[0].id, volcengineRoute.id);
  assert.equal(volcengineGroup.routes[0].provider_name, "volcengine");
  assert.equal(modelscopeGroup.routes.length, 1);
  assert.equal(modelscopeGroup.routes[0].provider_name, "modelscope");

  migratedStore.close();
  fs.rmSync(dbPath, { force: true });
});

test("does not auto-migrate when volcengine routes already span multiple groups", () => {
  const dbPath = createTempDbPath();
  const store = new Store(dbPath);

  const volcengine = store.createProvider({
    name: "volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    keys: [{ label: "primary", apiKey: "ve-key" }],
  });
  const groupA = store.createModelGroup({ name: "group-a" });
  const groupB = store.createModelGroup({ name: "group-b" });

  store.addModelRoute(groupA.id, {
    providerKeyId: volcengine.keys[0].id,
    providerModelName: "doubao-a",
  });
  store.addModelRoute(groupB.id, {
    providerKeyId: volcengine.keys[0].id,
    providerModelName: "doubao-b",
  });

  store.close();

  const migratedStore = new Store(dbPath);
  const groups = migratedStore.listModelGroups();

  assert.equal(groups.some((group) => group.name === "volcengine"), false);
  assert.equal(groups.find((group) => group.name === "group-a").routes.length, 1);
  assert.equal(groups.find((group) => group.name === "group-b").routes.length, 1);

  migratedStore.close();
  fs.rmSync(dbPath, { force: true });
});

test("resolves external aliases to logical model groups", () => {
  const dbPath = createTempDbPath();
  const store = new Store(dbPath);
  const provider = store.createProvider({
    name: "modelscope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    keys: [{ label: "primary", apiKey: "ms-key" }],
  });
  const group = store.createModelGroup({ name: "modelscope" });
  store.addModelRoute(group.id, {
    providerKeyId: provider.keys[0].id,
    providerModelName: "Qwen/Qwen3.5-27B",
  });
  const alias = store.createModelAlias({
    name: "chat-main",
    groupId: group.id,
  });

  const plan = store.getRoutingPlan("chat-main");

  assert.equal(plan.alias.id, alias.id);
  assert.equal(plan.group.id, group.id);
  assert.equal(plan.group.name, "modelscope");
  assert.equal(plan.routes.length, 1);
  assert.equal(plan.routes[0].provider_model_name, "Qwen/Qwen3.5-27B");

  store.close();
  fs.rmSync(dbPath, { force: true });
});

test("lists enabled aliases ahead of direct logical group names", () => {
  const dbPath = createTempDbPath();
  const store = new Store(dbPath);
  const provider = store.createProvider({
    name: "modelscope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    keys: [{ label: "primary", apiKey: "ms-key" }],
  });
  const aliasedGroup = store.createModelGroup({ name: "modelscope" });
  const directGroup = store.createModelGroup({ name: "volcengine" });

  store.addModelRoute(aliasedGroup.id, {
    providerKeyId: provider.keys[0].id,
    providerModelName: "Qwen/Qwen3.5-27B",
  });
  store.addModelRoute(directGroup.id, {
    providerKeyId: provider.keys[0].id,
    providerModelName: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
  });
  store.createModelAlias({
    name: "chat-main",
    groupId: aliasedGroup.id,
  });

  const models = store.listRoutableModels();

  assert.deepEqual(
    models.map((item) => item.name),
    ["chat-main", "volcengine"]
  );
  assert.equal(models[0].target_group, "modelscope");
  assert.equal(models[1].target_group, "volcengine");

  store.close();
  fs.rmSync(dbPath, { force: true });
});

test("deprioritizes routes for the rest of the day after a 429", () => {
  const dbPath = createTempDbPath();
  const store = new Store(dbPath);
  const provider = store.createProvider({
    name: "modelscope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    keys: [
      { label: "primary", apiKey: "ms-key-1" },
      { label: "backup", apiKey: "ms-key-2" },
    ],
  });
  const group = store.createModelGroup({ name: "chat-main" });
  const primaryRoute = store.addModelRoute(group.id, {
    providerKeyId: provider.keys[1].id,
    providerModelName: "primary-model",
    order: 10,
  });
  const backupRoute = store.addModelRoute(group.id, {
    providerKeyId: provider.keys[0].id,
    providerModelName: "backup-model",
    order: 20,
  });

  let plan = store.getRoutingPlan("chat-main");
  assert.equal(plan.routes[0].id, primaryRoute.id);
  assert.equal(plan.routes[1].id, backupRoute.id);

  store.markRouteRateLimited(primaryRoute.id);

  plan = store.getRoutingPlan("chat-main");
  assert.equal(plan.routes[0].id, backupRoute.id);
  assert.equal(plan.routes[1].id, primaryRoute.id);
  assert.equal(plan.routes[1].rate_limited_today, true);

  store.close();
  fs.rmSync(dbPath, { force: true });
});

test("accepts provider keys with blank api_key for unauthenticated upstreams", () => {
  const dbPath = createTempDbPath();
  const store = new Store(dbPath);
  const provider = store.createProvider({
    name: "lm-studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    keys: [{ label: "local", apiKey: "" }],
  });
  const group = store.createModelGroup({ name: "chat-main" });

  store.addModelRoute(group.id, {
    providerKeyId: provider.keys[0].id,
    providerModelName: "local-model",
  });

  const key = store.getProviderKey(provider.keys[0].id);
  const plan = store.getRoutingPlan("chat-main");
  const models = store.listRoutableModels();

  assert.equal(key.api_key, "");
  assert.equal(plan.routes.length, 1);
  assert.equal(plan.routes[0].provider_name, "lm-studio");
  assert.equal(models[0].name, "chat-main");

  store.close();
  fs.rmSync(dbPath, { force: true });
});

test("filters request logs and quota items for the admin console", () => {
  const dbPath = createTempDbPath();
  const store = new Store(dbPath);
  const provider = store.createProvider({
    name: "modelscope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    keys: [{ label: "primary", apiKey: "ms-key" }],
  });
  const group = store.createModelGroup({ name: "chat-main" });
  const route = store.addModelRoute(group.id, {
    providerKeyId: provider.keys[0].id,
    providerModelName: "Qwen/Qwen3.5-27B",
    dailyLimit: 1,
    warningThreshold: 50,
  });

  store.consumeRoute(route.id);
  store.recordRequestLog({
    requestedModel: "chat-main",
    routedProvider: "modelscope",
    routedModel: "Qwen/Qwen3.5-27B",
    statusCode: 500,
    errorCode: "status-500",
    attempts: 1,
  });
  store.recordRequestLog({
    requestedModel: "chat-main",
    routedProvider: "modelscope",
    routedModel: "Qwen/Qwen3.5-27B",
    statusCode: 200,
    attempts: 1,
  });

  const filteredLogs = store.listRequestLogs({
    model: "chat-main",
    provider: "modelscope",
    status: "error",
  });
  const exhaustedQuotas = store.listQuotaItems({ status: "exhausted" });

  assert.equal(filteredLogs.length, 1);
  assert.equal(filteredLogs[0].error_code, "status-500");
  assert.equal(exhaustedQuotas.length, 1);
  assert.equal(exhaustedQuotas[0].id, route.id);

  store.close();
  fs.rmSync(dbPath, { force: true });
});

test("enforces provider-level requests per minute limits", () => {
  const dbPath = createTempDbPath();
  const store = new Store(dbPath);
  const provider = store.createProvider({
    name: "modelscope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    requestsPerMinute: 1,
    keys: [{ label: "primary", apiKey: "ms-key" }],
  });
  const group = store.createModelGroup({ name: "chat-main" });
  const route = store.addModelRoute(group.id, {
    providerKeyId: provider.keys[0].id,
    providerModelName: "Qwen/Qwen3.5-27B",
  });

  const firstConsume = store.consumeRoute(route.id);
  assert.equal(firstConsume.daily_used, 1);

  const plan = store.getRoutingPlan("chat-main");
  assert.equal(plan.routes[0].minute_rate_limited, true);
  assert.equal(plan.routes[0].skip_reason, "provider-rate-limited");

  assert.throws(() => store.consumeRoute(route.id), /Provider minute rate limit exhausted/);

  store.close();
  fs.rmSync(dbPath, { force: true });
});
