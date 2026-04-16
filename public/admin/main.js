import { api, jsonBody, boolValue, numberValue } from "./api.js";
import { layout, modalContent } from "./views.js";

const state = {
  activeView: "overview",
  logsTab: "requests",
  status: { message: "准备就绪" },
  overview: null,
  providers: {
    providers: [],
    providerKeyOptions: [],
    activeProviderId: null,
    detail: null,
  },
  routing: {
    groups: [],
    aliases: [],
    providerKeyOptions: [],
    activeGroupId: null,
    detail: null,
  },
  quotas: {
    items: [],
    groups: [],
    providers: [],
    filters: { status: "", groupId: "", providerId: "" },
  },
  logs: {
    requests: { items: [], models: [], providers: [], filters: { model: "", provider: "", status: "" } },
    switches: { items: [], models: [], reasons: [], filters: { model: "", reason: "" } },
  },
  system: null,
};

const authRoot = document.getElementById("authRoot");
const appRoot = document.getElementById("appRoot");
const setupCard = document.getElementById("setupCard");
const loginCard = document.getElementById("loginCard");
const modal = document.getElementById("modal");

let logTimer = null;

function setStatus(message, tone = "info") {
  state.status = { message, tone };
  renderApp();
}

function showAuth(mode) {
  authRoot.hidden = false;
  appRoot.hidden = true;
  setupCard.hidden = mode !== "setup";
  loginCard.hidden = mode !== "login";
  window.scrollTo(0, 0);
}

function showApp() {
  authRoot.hidden = true;
  appRoot.hidden = false;
  window.scrollTo(0, 0);
}

function renderApp() {
  if (appRoot.hidden) {
    return;
  }

  appRoot.innerHTML = layout({
    status: state.status,
    activeView: state.activeView,
    providers: state.providers,
    routing: state.routing,
    app: state,
    logsTab: state.logsTab,
  });
}

async function loadOverview() {
  state.overview = await api("/admin/api/overview");
}

async function loadProviders() {
  const data = await api("/admin/api/providers");
  state.providers.providers = data.providers;
  state.providers.providerKeyOptions = data.providerKeyOptions;
  if (!data.providers.some((provider) => provider.id === state.providers.activeProviderId)) {
    state.providers.activeProviderId = data.providers[0]?.id || null;
  }
  if (!state.providers.activeProviderId && data.providers[0]) {
    state.providers.activeProviderId = data.providers[0].id;
  }
  if (state.providers.activeProviderId) {
    state.providers.detail = await api(`/admin/api/providers/${state.providers.activeProviderId}`);
  } else {
    state.providers.detail = null;
  }
}

async function loadProviderDetail(providerId) {
  state.providers.activeProviderId = providerId;
  state.providers.detail = await api(`/admin/api/providers/${providerId}`);
  renderApp();
}

async function loadRouting() {
  const data = await api("/admin/api/routing");
  state.routing.groups = data.groups;
  state.routing.aliases = data.aliases;
  state.routing.providerKeyOptions = data.providerKeyOptions;
  if (!data.groups.some((group) => group.id === state.routing.activeGroupId)) {
    state.routing.activeGroupId = data.groups[0]?.id || null;
  }
  if (!state.routing.activeGroupId && data.groups[0]) {
    state.routing.activeGroupId = data.groups[0].id;
  }
  if (state.routing.activeGroupId) {
    state.routing.detail = await api(`/admin/api/routing/groups/${state.routing.activeGroupId}`);
  } else {
    state.routing.detail = null;
  }
}

async function loadRoutingDetail(groupId) {
  state.routing.activeGroupId = groupId;
  state.routing.detail = await api(`/admin/api/routing/groups/${groupId}`);
  renderApp();
}

async function loadQuotas() {
  const params = new URLSearchParams();
  Object.entries(state.quotas.filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  const data = await api(`/admin/api/quotas${params.toString() ? `?${params.toString()}` : ""}`);
  state.quotas.items = data.items;
  state.quotas.groups = data.groups;
  state.quotas.providers = data.providers;
}

async function loadRequestLogs() {
  const params = new URLSearchParams();
  Object.entries(state.logs.requests.filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  const data = await api(`/admin/api/logs/requests${params.toString() ? `?${params.toString()}` : ""}`);
  state.logs.requests.items = data.items;
  state.logs.requests.models = data.models;
  state.logs.requests.providers = data.providers;
}

async function loadSwitchLogs() {
  const params = new URLSearchParams();
  Object.entries(state.logs.switches.filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  const data = await api(`/admin/api/logs/switches${params.toString() ? `?${params.toString()}` : ""}`);
  state.logs.switches.items = data.items;
  state.logs.switches.models = data.models;
  state.logs.switches.reasons = data.reasons;
}

async function loadSystem() {
  state.system = await api("/admin/api/system");
}

async function refreshAll() {
  await Promise.all([loadOverview(), loadProviders(), loadRouting(), loadQuotas(), loadRequestLogs(), loadSwitchLogs(), loadSystem()]);
  renderApp();
}

function openModal(type, payload = {}) {
  modal.innerHTML = modalContent(type, payload);
  modal.showModal();
}

function closeModal() {
  modal.close();
  modal.innerHTML = "";
}

function findAlias(aliasId) {
  return state.routing.aliases.find((alias) => alias.id === aliasId) || null;
}

function findGroup(groupId) {
  return state.routing.groups.find((group) => group.id === groupId) || null;
}

function findRoute(routeId) {
  for (const group of state.routing.groups) {
    const route = group.routes.find((item) => item.id === routeId);
    if (route) {
      return route;
    }
  }
  return null;
}

function findKey(keyId) {
  for (const provider of state.providers.providers) {
    const key = provider.keys.find((item) => item.id === keyId);
    if (key) {
      return key;
    }
  }
  return null;
}

async function boot() {
  try {
    const status = await api("/admin/auth/status");
    if (status.needsSetup) {
      showAuth("setup");
      return;
    }
    if (!status.authenticated) {
      showAuth("login");
      return;
    }
    showApp();
    await refreshAll();
    startLogRefresh();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function startLogRefresh() {
  if (logTimer) {
    clearInterval(logTimer);
  }

  logTimer = setInterval(async () => {
    if (appRoot.hidden || state.activeView !== "logs") {
      return;
    }
    try {
      if (state.logsTab === "requests") {
        await loadRequestLogs();
      } else {
        await loadSwitchLogs();
      }
      renderApp();
    } catch {}
  }, 5000);
}

document.getElementById("setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/admin/auth/bootstrap", {
      method: "POST",
      body: jsonBody({
        password: form.elements.password.value,
        gatewayApiKey: form.elements.gatewayApiKey.value,
      }),
    });
    showApp();
    await refreshAll();
    startLogRefresh();
    setStatus("初始化完成");
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/admin/auth/login", {
      method: "POST",
      body: jsonBody({ password: form.elements.password.value }),
    });
    showApp();
    await refreshAll();
    startLogRefresh();
    setStatus("登录成功");
  } catch (error) {
    alert(error.message);
  }
});

document.body.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const { action } = target.dataset;
  try {
    if (action === "switch-view") {
      state.activeView = target.dataset.view;
      renderApp();
      return;
    }

    if (action === "refresh-view") {
      if (state.activeView === "overview") await loadOverview();
      if (state.activeView === "providers") await loadProviders();
      if (state.activeView === "routing") await loadRouting();
      if (state.activeView === "quotas") await loadQuotas();
      if (state.activeView === "logs") {
        if (state.logsTab === "requests") {
          await loadRequestLogs();
        } else {
          await loadSwitchLogs();
        }
      }
      if (state.activeView === "system") await loadSystem();
      renderApp();
      setStatus("已刷新当前视图");
      return;
    }

    if (action === "select-provider") {
      await loadProviderDetail(Number(target.dataset.id));
      return;
    }

    if (action === "select-group") {
      await loadRoutingDetail(Number(target.dataset.id));
      return;
    }

    if (action === "switch-logs-tab") {
      state.logsTab = target.dataset.tab;
      renderApp();
      return;
    }

    if (action === "logout") {
      await api("/admin/auth/logout", { method: "POST" });
      showAuth("login");
      return;
    }

    if (action === "test-provider") {
      const result = await api(`/admin/api/providers/${target.dataset.id}/test`, { method: "POST" });
      setStatus(result.ok ? "Provider 连接正常" : result.error, result.ok ? "info" : "error");
      return;
    }

    if (action === "force-route") {
      await api(`/admin/api/model-groups/${target.dataset.groupId}`, {
        method: "PATCH",
        body: jsonBody({ forcedRouteId: Number(target.dataset.routeId) }),
      });
      await loadRouting();
      renderApp();
      setStatus("已更新主路由");
      return;
    }

    if (action === "delete-route") {
      if (!window.confirm("确认删除这条路由？")) {
        return;
      }
      await api(`/admin/api/model-routes/${target.dataset.id}`, { method: "DELETE" });
      await Promise.all([loadRouting(), loadQuotas()]);
      renderApp();
      setStatus("路由已删除");
      return;
    }

    if (action === "reset-quota") {
      if (!window.confirm("确认重置这条路由的额度计数？")) {
        return;
      }
      await api(`/admin/api/quotas/${target.dataset.id}/reset`, { method: "POST", body: jsonBody({ period: "all" }) });
      await Promise.all([loadQuotas(), loadRouting()]);
      renderApp();
      setStatus("额度已重置");
      return;
    }

    if (action === "open-modal") {
      const type = target.dataset.modal;
      if (type === "create-provider") openModal(type);
      if (type === "edit-provider") openModal(type, { provider: state.providers.detail });
      if (type === "create-key") openModal(type, { providerId: Number(target.dataset.providerId || state.providers.activeProviderId) });
      if (type === "edit-key") openModal(type, { key: findKey(Number(target.dataset.id)), providerId: Number(target.dataset.providerId) });
      if (type === "create-group") openModal(type);
      if (type === "edit-group") openModal(type, { group: findGroup(Number(target.dataset.id)) });
      if (type === "create-alias") openModal(type, { groups: state.routing.groups, groupId: Number(target.dataset.groupId || state.routing.activeGroupId) });
      if (type === "edit-alias") openModal(type, { alias: findAlias(Number(target.dataset.id)), groups: state.routing.groups });
      if (type === "create-route") {
        openModal(type, { groups: state.routing.groups, providerKeyOptions: state.routing.providerKeyOptions, groupId: Number(target.dataset.groupId || state.routing.activeGroupId) });
      }
      if (type === "edit-route") {
        openModal(type, { route: findRoute(Number(target.dataset.id)), groups: state.routing.groups, providerKeyOptions: state.routing.providerKeyOptions });
      }
      if (type === "edit-quota") openModal(type, { route: state.quotas.items.find((item) => item.id === Number(target.dataset.id)) });
    }
  } catch (error) {
    alert(error.message);
  }
});

document.body.addEventListener("submit", async (event) => {
  const form = event.target;

  try {
    if (form.id === "quotaFilters") {
      event.preventDefault();
      state.quotas.filters = {
        status: form.elements.status.value,
        groupId: form.elements.groupId.value,
        providerId: form.elements.providerId.value,
      };
      await loadQuotas();
      renderApp();
      return;
    }

    if (form.id === "requestLogFilters") {
      event.preventDefault();
      state.logs.requests.filters = {
        model: form.elements.model.value,
        provider: form.elements.provider.value,
        status: form.elements.status.value,
      };
      await loadRequestLogs();
      renderApp();
      return;
    }

    if (form.id === "switchLogFilters") {
      event.preventDefault();
      state.logs.switches.filters = {
        model: form.elements.model.value,
        reason: form.elements.reason.value,
      };
      await loadSwitchLogs();
      renderApp();
      return;
    }

    if (form.id === "systemForm") {
      event.preventDefault();
      await api("/admin/api/system", {
        method: "PATCH",
        body: jsonBody({ gatewayApiKey: form.elements.gatewayApiKey.value }),
      });
      await loadSystem();
      renderApp();
      form.reset();
      setStatus("Gateway 设置已更新");
      return;
    }

    if (form.id === "passwordForm") {
      event.preventDefault();
      await api("/admin/api/system/password", {
        method: "POST",
        body: jsonBody({
          currentPassword: form.elements.currentPassword.value,
          newPassword: form.elements.newPassword.value,
        }),
      });
      form.reset();
      setStatus("管理员密码已更新");
      return;
    }

    if (!modal.open) {
      return;
    }

    event.preventDefault();
    const submitType = form.dataset.form;

    if (submitType === "create-provider") {
      await api("/admin/api/providers", {
        method: "POST",
        body: jsonBody({
          name: form.elements.name.value,
          baseUrl: form.elements.baseUrl.value,
          timeoutMs: numberValue(form, "timeoutMs"),
          requestsPerMinute: numberValue(form, "requestsPerMinute"),
          priority: numberValue(form, "priority"),
          enabled: boolValue(form, "enabled"),
          keys: form.elements.keyLabel.value ? [{ label: form.elements.keyLabel.value, apiKey: form.elements.apiKey.value, enabled: true }] : [],
        }),
      });
      await loadProviders();
    }

    if (submitType === "edit-provider") {
      await api(`/admin/api/providers/${form.querySelector("[data-submit]").dataset.id}`, {
        method: "PATCH",
        body: jsonBody({
          name: form.elements.name.value,
          baseUrl: form.elements.baseUrl.value,
          timeoutMs: numberValue(form, "timeoutMs"),
          requestsPerMinute: numberValue(form, "requestsPerMinute"),
          priority: numberValue(form, "priority"),
          enabled: boolValue(form, "enabled"),
        }),
      });
      await loadProviders();
    }

    if (submitType === "create-key") {
      await api("/admin/api/provider-keys", {
        method: "POST",
        body: jsonBody({
          providerId: Number(form.elements.providerId.value),
          label: form.elements.label.value,
          apiKey: form.elements.apiKey.value,
          enabled: boolValue(form, "enabled"),
        }),
      });
      await loadProviders();
    }

    if (submitType === "edit-key") {
      await api(`/admin/api/provider-keys/${form.querySelector("[data-submit]").dataset.id}`, {
        method: "PATCH",
        body: jsonBody({
          label: form.elements.label.value,
          apiKey: form.elements.apiKey.value || undefined,
          enabled: boolValue(form, "enabled"),
        }),
      });
      await loadProviders();
    }

    if (submitType === "create-group") {
      await api("/admin/api/model-groups", {
        method: "POST",
        body: jsonBody({
          name: form.elements.name.value,
          capabilityLevel: form.elements.capabilityLevel.value,
          fallbackPolicy: form.elements.fallbackPolicy.value,
          enabled: boolValue(form, "enabled"),
        }),
      });
      await loadRouting();
    }

    if (submitType === "edit-group") {
      await api(`/admin/api/model-groups/${form.querySelector("[data-submit]").dataset.id}`, {
        method: "PATCH",
        body: jsonBody({
          name: form.elements.name.value,
          capabilityLevel: form.elements.capabilityLevel.value,
          fallbackPolicy: form.elements.fallbackPolicy.value,
          enabled: boolValue(form, "enabled"),
        }),
      });
      await loadRouting();
    }

    if (submitType === "create-alias") {
      await api("/admin/api/model-aliases", {
        method: "POST",
        body: jsonBody({
          name: form.elements.name.value,
          groupId: Number(form.elements.groupId.value),
          enabled: boolValue(form, "enabled"),
        }),
      });
      await loadRouting();
    }

    if (submitType === "edit-alias") {
      await api(`/admin/api/model-aliases/${form.querySelector("[data-submit]").dataset.id}`, {
        method: "PATCH",
        body: jsonBody({
          name: form.elements.name.value,
          groupId: Number(form.elements.groupId.value),
          enabled: boolValue(form, "enabled"),
        }),
      });
      await loadRouting();
    }

    if (submitType === "create-route") {
      await api("/admin/api/model-routes", {
        method: "POST",
        body: jsonBody({
          groupId: Number(form.elements.groupId.value),
          providerKeyId: Number(form.elements.providerKeyId.value),
          providerModelName: form.elements.providerModelName.value,
          order: numberValue(form, "order"),
          dailyLimit: numberValue(form, "dailyLimit"),
          monthlyLimit: numberValue(form, "monthlyLimit"),
          warningThreshold: numberValue(form, "warningThreshold"),
          enabled: boolValue(form, "enabled"),
        }),
      });
      await Promise.all([loadRouting(), loadQuotas()]);
    }

    if (submitType === "edit-route") {
      await api(`/admin/api/model-routes/${form.querySelector("[data-submit]").dataset.id}`, {
        method: "PATCH",
        body: jsonBody({
          groupId: Number(form.elements.groupId.value),
          providerKeyId: Number(form.elements.providerKeyId.value),
          providerModelName: form.elements.providerModelName.value,
          order: numberValue(form, "order"),
          dailyLimit: numberValue(form, "dailyLimit"),
          monthlyLimit: numberValue(form, "monthlyLimit"),
          warningThreshold: numberValue(form, "warningThreshold"),
          enabled: boolValue(form, "enabled"),
        }),
      });
      await Promise.all([loadRouting(), loadQuotas()]);
    }

    if (submitType === "edit-quota") {
      await api(`/admin/api/quotas/${form.querySelector("[data-submit]").dataset.id}`, {
        method: "PATCH",
        body: jsonBody({
          dailyLimit: numberValue(form, "dailyLimit"),
          monthlyLimit: numberValue(form, "monthlyLimit"),
          warningThreshold: numberValue(form, "warningThreshold"),
          enabled: boolValue(form, "enabled"),
        }),
      });
      await Promise.all([loadQuotas(), loadRouting()]);
    }

    closeModal();
    renderApp();
    setStatus("配置已更新");
  } catch (error) {
    alert(error.message);
  }
});

modal.addEventListener("close", () => {
  modal.innerHTML = "";
});

boot();
