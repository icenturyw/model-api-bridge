const state = {
  dashboard: null,
  providers: [],
  providerKeyOptions: [],
  groups: [],
  aliases: [],
  quotas: [],
  requestLogs: [],
  switchLogs: [],
  system: null,
  activePanel: "dashboard",
};

const LOG_REFRESH_INTERVAL_MS = 5000;
let logRefreshTimer = null;

const views = {
  authView: document.getElementById("authView"),
  setupPanel: document.getElementById("setupPanel"),
  loginPanel: document.getElementById("loginPanel"),
  appView: document.getElementById("appView"),
  nav: document.getElementById("nav"),
  sessionActions: document.getElementById("sessionActions"),
  pageTitle: document.getElementById("pageTitle"),
  pageEyebrow: document.getElementById("pageEyebrow"),
  statusMessage: document.getElementById("statusMessage"),
  summaryCards: document.getElementById("summaryCards"),
  providerHealth: document.getElementById("providerHealth"),
  soonExhausted: document.getElementById("soonExhausted"),
  recentSwitches: document.getElementById("recentSwitches"),
  providersTable: document.getElementById("providersTable"),
  providerSelect: document.getElementById("providerSelect"),
  providerKeySelect: document.getElementById("providerKeySelect"),
  groupSelect: document.getElementById("groupSelect"),
  aliasGroupSelect: document.getElementById("aliasGroupSelect"),
  groupsTable: document.getElementById("groupsTable"),
  aliasTable: document.getElementById("aliasTable"),
  quotaTable: document.getElementById("quotaTable"),
  requestLogs: document.getElementById("requestLogs"),
  switchLogs: document.getElementById("switchLogs"),
  gatewaySnippet: document.getElementById("gatewaySnippet"),
  logoutButton: document.getElementById("logoutButton"),
  providerForm: document.getElementById("providerForm"),
  providerFormTitle: document.getElementById("providerFormTitle"),
  providerFormSubmit: document.getElementById("providerFormSubmit"),
  providerFormCancel: document.getElementById("providerFormCancel"),
  providerKeyForm: document.getElementById("providerKeyForm"),
  providerKeyFormTitle: document.getElementById("providerKeyFormTitle"),
  providerKeyFormSubmit: document.getElementById("providerKeyFormSubmit"),
  providerKeyFormCancel: document.getElementById("providerKeyFormCancel"),
  groupForm: document.getElementById("groupForm"),
  groupFormTitle: document.getElementById("groupFormTitle"),
  groupFormSubmit: document.getElementById("groupFormSubmit"),
  groupFormCancel: document.getElementById("groupFormCancel"),
  aliasForm: document.getElementById("aliasForm"),
  aliasFormTitle: document.getElementById("aliasFormTitle"),
  aliasFormSubmit: document.getElementById("aliasFormSubmit"),
  aliasFormCancel: document.getElementById("aliasFormCancel"),
  routeForm: document.getElementById("routeForm"),
  routeFormTitle: document.getElementById("routeFormTitle"),
  routeFormSubmit: document.getElementById("routeFormSubmit"),
  routeFormCancel: document.getElementById("routeFormCancel"),
};

function setStatus(message, tone = "info") {
  views.statusMessage.textContent = message;
  views.statusMessage.style.color = tone === "error" ? "var(--bad)" : "var(--muted)";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || payload.detail || "Request failed");
  }
  return payload;
}

function boolField(form, name) {
  return form.elements[name]?.checked ?? false;
}

function numberField(form, name) {
  const value = form.elements[name]?.value;
  if (value === "" || value === undefined) {
    return undefined;
  }
  return Number(value);
}

function pill(text, tone = "ok") {
  return `<span class="pill ${tone}">${text}</span>`;
}

function resetProviderForm() {
  views.providerForm.dataset.editId = "";
  views.providerFormTitle.textContent = "新增服务商";
  views.providerFormSubmit.textContent = "创建服务商";
  views.providerFormCancel.hidden = true;
  views.providerForm.reset();
  views.providerForm.elements.timeoutMs.value = 25000;
  views.providerForm.elements.priority.value = 100;
  views.providerForm.elements.enabled.checked = true;
}

function resetProviderKeyForm() {
  views.providerKeyForm.dataset.editId = "";
  views.providerKeyFormTitle.textContent = "追加 API Key";
  views.providerKeyFormSubmit.textContent = "添加 Key";
  views.providerKeyFormCancel.hidden = true;
  views.providerKeyForm.reset();
  views.providerKeyForm.elements.enabled.checked = true;
}

function resetGroupForm() {
  views.groupForm.dataset.editId = "";
  views.groupFormTitle.textContent = "新增逻辑模型组";
  views.groupFormSubmit.textContent = "创建模型组";
  views.groupFormCancel.hidden = true;
  views.groupForm.reset();
  views.groupForm.elements.capabilityLevel.value = "standard";
  views.groupForm.elements.fallbackPolicy.value = "same-group";
  views.groupForm.elements.enabled.checked = true;
}

function resetAliasForm() {
  views.aliasForm.dataset.editId = "";
  views.aliasFormTitle.textContent = "新增统一模型名";
  views.aliasFormSubmit.textContent = "创建统一模型名";
  views.aliasFormCancel.hidden = true;
  views.aliasForm.reset();
  views.aliasForm.elements.enabled.checked = true;
}

function resetRouteForm() {
  views.routeForm.dataset.editId = "";
  views.routeFormTitle.textContent = "新增候选路由";
  views.routeFormSubmit.textContent = "添加路由";
  views.routeFormCancel.hidden = true;
  views.routeForm.reset();
  views.routeForm.elements.order.value = 100;
  views.routeForm.elements.dailyLimit.value = 0;
  views.routeForm.elements.monthlyLimit.value = 0;
  views.routeForm.elements.warningThreshold.value = 80;
  views.routeForm.elements.enabled.checked = true;
}

function findRoute(routeId) {
  for (const group of state.groups) {
    const route = group.routes.find((item) => item.id === routeId);
    if (route) {
      return { group, route };
    }
  }
  return null;
}

function beginEditProvider(providerId) {
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider) {
    throw new Error("Provider not found");
  }
  switchPanel("providers");
  views.providerForm.dataset.editId = String(provider.id);
  views.providerFormTitle.textContent = "编辑服务商";
  views.providerFormSubmit.textContent = "保存服务商";
  views.providerFormCancel.hidden = false;
  views.providerForm.elements.name.value = provider.name;
  views.providerForm.elements.baseUrl.value = provider.base_url;
  views.providerForm.elements.timeoutMs.value = provider.timeout_ms;
  views.providerForm.elements.priority.value = provider.priority;
  views.providerForm.elements.enabled.checked = Boolean(provider.enabled);
  views.providerForm.elements.keyLabel.value = "";
  views.providerForm.elements.apiKey.value = "";
}

function beginEditProviderKey(keyId) {
  for (const provider of state.providers) {
    const key = provider.keys.find((item) => item.id === keyId);
    if (!key) {
      continue;
    }
    switchPanel("providers");
    views.providerKeyForm.dataset.editId = String(key.id);
    views.providerKeyFormTitle.textContent = "编辑 API Key";
    views.providerKeyFormSubmit.textContent = "保存 Key";
    views.providerKeyFormCancel.hidden = false;
    views.providerKeyForm.elements.providerId.value = String(key.provider_id);
    views.providerKeyForm.elements.label.value = key.label;
    views.providerKeyForm.elements.apiKey.value = "";
    views.providerKeyForm.elements.apiKey.required = false;
    views.providerKeyForm.elements.apiKey.placeholder = "留空则不修改";
    views.providerKeyForm.elements.enabled.checked = Boolean(key.enabled);
    return;
  }
  throw new Error("Provider key not found");
}

function beginEditGroup(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) {
    throw new Error("Model group not found");
  }
  switchPanel("models");
  views.groupForm.dataset.editId = String(group.id);
  views.groupFormTitle.textContent = "编辑逻辑模型组";
  views.groupFormSubmit.textContent = "保存模型组";
  views.groupFormCancel.hidden = false;
  views.groupForm.elements.name.value = group.name;
  views.groupForm.elements.capabilityLevel.value = group.capability_level;
  views.groupForm.elements.fallbackPolicy.value = group.fallback_policy;
  views.groupForm.elements.enabled.checked = Boolean(group.enabled);
}

function beginEditAlias(aliasId) {
  const alias = state.aliases.find((item) => item.id === aliasId);
  if (!alias) {
    throw new Error("Model alias not found");
  }
  switchPanel("models");
  views.aliasForm.dataset.editId = String(alias.id);
  views.aliasFormTitle.textContent = "编辑统一模型名";
  views.aliasFormSubmit.textContent = "保存统一模型名";
  views.aliasFormCancel.hidden = false;
  views.aliasForm.elements.name.value = alias.name;
  views.aliasForm.elements.groupId.value = String(alias.group_id);
  views.aliasForm.elements.enabled.checked = Boolean(alias.enabled);
}

function beginEditRoute(routeId) {
  const match = findRoute(routeId);
  if (!match) {
    throw new Error("Model route not found");
  }
  switchPanel("models");
  views.routeForm.dataset.editId = String(match.route.id);
  views.routeFormTitle.textContent = "编辑候选路由";
  views.routeFormSubmit.textContent = "保存路由";
  views.routeFormCancel.hidden = false;
  views.routeForm.elements.groupId.value = String(match.group.id);
  views.routeForm.elements.providerKeyId.value = String(match.route.provider_key_id);
  views.routeForm.elements.providerModelName.value = match.route.provider_model_name;
  views.routeForm.elements.order.value = match.route.route_order;
  views.routeForm.elements.dailyLimit.value = match.route.daily_limit;
  views.routeForm.elements.monthlyLimit.value = match.route.monthly_limit;
  views.routeForm.elements.warningThreshold.value = match.route.warning_threshold;
  views.routeForm.elements.enabled.checked = Boolean(match.route.enabled);
}

function toneForHealth(status) {
  if (status === "healthy") return "ok";
  if (status === "degraded") return "warn";
  return "bad";
}

function toneForQuota(item) {
  if (item.quota_exhausted) return "bad";
  if (item.warning_reached) return "warn";
  return "ok";
}

function switchPanel(panelName) {
  state.activePanel = panelName;
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === panelName);
  });
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === panelName);
  });

  const labels = {
    dashboard: ["控制台", "仪表盘"],
    providers: ["配置中心", "服务商"],
    models: ["配置中心", "模型路由"],
    quotas: ["运行控制", "额度"],
    logs: ["运行观察", "日志"],
    system: ["系统", "系统设置"],
  };
  const [eyebrow, title] = labels[panelName];
  views.pageEyebrow.textContent = eyebrow;
  views.pageTitle.textContent = title;

  if (panelName === "logs") {
    refreshLogs().catch(() => null);
  }
}

function showAuth(mode) {
  views.authView.hidden = false;
  views.appView.hidden = true;
  views.nav.hidden = true;
  views.sessionActions.hidden = true;
  views.setupPanel.hidden = mode !== "setup";
  views.loginPanel.hidden = mode !== "login";
}

function showApp() {
  views.authView.hidden = true;
  views.appView.hidden = false;
  views.nav.hidden = false;
  views.sessionActions.hidden = false;
  switchPanel("dashboard");
}

function renderSummary() {
  if (!state.dashboard) return;
  const totals = state.dashboard.totals;
  views.summaryCards.innerHTML = `
    <div class="metric"><span>服务商</span><strong>${totals.providers}</strong></div>
    <div class="metric"><span>API Key</span><strong>${totals.providerKeys}</strong></div>
    <div class="metric"><span>逻辑模型组</span><strong>${totals.modelGroups}</strong></div>
    <div class="metric"><span>统一模型名</span><strong>${totals.modelAliases || 0}</strong></div>
    <div class="metric"><span>今日请求</span><strong>${totals.requestCountToday}</strong></div>
  `;

  views.providerHealth.innerHTML = `
    <table>
      <thead><tr><th>Provider</th><th>健康</th><th>降级</th><th>异常</th></tr></thead>
      <tbody>
        ${state.dashboard.providerHealth
          .map(
            (item) => `
              <tr>
                <td>${item.name}</td>
                <td>${item.healthyKeys}</td>
                <td>${item.degradedKeys}</td>
                <td>${item.unhealthyKeys}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;

  views.soonExhausted.innerHTML = state.dashboard.soonExhausted.length
    ? `
      <table>
        <thead><tr><th>逻辑模型</th><th>目标</th><th>状态</th></tr></thead>
        <tbody>
          ${state.dashboard.soonExhausted
            .map(
              (item) => `
                <tr>
                  <td>${item.group_name}</td>
                  <td>${item.provider_name} / ${item.provider_model_name}</td>
                  <td>${pill(item.quota_exhausted ? "已耗尽" : "接近阈值", toneForQuota(item))}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    `
    : `<p class="muted">目前没有接近阈值的路由。</p>`;

  views.recentSwitches.innerHTML = state.dashboard.recentSwitches.length
    ? `
      <table>
        <thead><tr><th>模型组</th><th>切换</th><th>原因</th><th>时间</th></tr></thead>
        <tbody>
          ${state.dashboard.recentSwitches
            .map(
              (item) => `
                <tr>
                  <td>${item.requested_model}</td>
                  <td>${item.from_target} → ${item.to_target}</td>
                  <td>${item.reason}</td>
                  <td>${new Date(item.created_at).toLocaleString()}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    `
    : `<p class="muted">还没有发生切换。</p>`;
}

function populateProviderSelects() {
  views.providerSelect.innerHTML = state.providers
    .map((provider) => `<option value="${provider.id}">${provider.name}</option>`)
    .join("");

  views.providerKeySelect.innerHTML = state.providerKeyOptions
    .map(
      (key) =>
        `<option value="${key.id}">${key.provider_name} / ${key.label} / ${key.health_status}</option>`
    )
    .join("");
}

function populateGroupSelects() {
  views.groupSelect.innerHTML = state.groups
    .map((group) => `<option value="${group.id}">${group.name}</option>`)
    .join("");

  views.aliasGroupSelect.innerHTML = state.groups
    .map((group) => `<option value="${group.id}">${group.name}</option>`)
    .join("");
}

function renderProviders() {
  populateProviderSelects();
  views.providersTable.innerHTML = `
    <table>
      <thead>
        <tr><th>Provider</th><th>配置</th><th>Keys</th><th>操作</th></tr>
      </thead>
      <tbody>
        ${state.providers
          .map(
            (provider) => `
              <tr>
                <td>
                  <strong>${provider.name}</strong><br />
                  <span class="muted">${provider.base_url}</span>
                </td>
                <td>
                  ${pill(provider.enabled ? "启用" : "停用", provider.enabled ? "ok" : "bad")}
                  <div>优先级 ${provider.priority} · 超时 ${provider.timeout_ms}ms</div>
                </td>
                <td>
                  ${provider.keys
                    .map(
                      (key) => `
                        <div class="stack-item">
                          ${pill(key.health_status, toneForHealth(key.health_status))}
                          ${pill(key.enabled ? "Key 开启" : "Key 关闭", key.enabled ? "ok" : "bad")}
                          <div>${key.label} · ${key.masked_key}</div>
                          <div class="muted">${key.last_error || "最近无错误"}</div>
                          <div class="row-actions">
                            <button data-action="toggle-key" data-id="${key.id}" data-enabled="${key.enabled}">${key.enabled ? "停用 Key" : "启用 Key"}</button>
                            <button data-action="edit-key" data-id="${key.id}" data-label="${key.label}">编辑 Key</button>
                          </div>
                        </div>
                      `
                    )
                    .join("<hr />")}
                </td>
                <td>
                  <div class="row-actions">
                    <button data-action="toggle-provider" data-id="${provider.id}" data-enabled="${provider.enabled}">${provider.enabled ? "停用" : "启用"}</button>
                    <button data-action="edit-provider" data-id="${provider.id}" data-name="${provider.name}" data-base="${provider.base_url}" data-priority="${provider.priority}" data-timeout="${provider.timeout_ms}">编辑</button>
                    <button data-action="test-provider" data-id="${provider.id}">测试连接</button>
                  </div>
                </td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderGroups() {
  populateGroupSelects();
  views.aliasTable.innerHTML = state.aliases.length
    ? `
      <table>
        <thead><tr><th>统一模型名</th><th>指向逻辑组</th><th>操作</th></tr></thead>
        <tbody>
          ${state.aliases
            .map(
              (alias) => `
                <tr>
                  <td>
                    <strong>${alias.name}</strong><br />
                    ${pill(alias.enabled ? "启用" : "停用", alias.enabled ? "ok" : "bad")}
                  </td>
                  <td>
                    ${alias.group_name}<br />
                    <span class="muted">${alias.capability_level} / ${alias.fallback_policy}</span>
                  </td>
                  <td>
                    <div class="row-actions">
                      <button data-action="toggle-alias" data-id="${alias.id}" data-enabled="${alias.enabled}">${alias.enabled ? "停用别名" : "启用别名"}</button>
                      <button data-action="edit-alias" data-id="${alias.id}">编辑别名</button>
                    </div>
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    `
    : '<p class="muted">暂无统一模型名，外部请求会直接使用逻辑模型组名。</p>';

  views.groupsTable.innerHTML = `
    <table>
      <thead><tr><th>逻辑模型</th><th>路由顺序</th><th>操作</th></tr></thead>
      <tbody>
        ${state.groups
          .map(
            (group) => `
              <tr>
                <td>
                  <strong>${group.name}</strong><br />
                  <span class="muted">${group.capability_level} / ${group.fallback_policy}</span><br />
                  ${pill(group.enabled ? "启用" : "停用", group.enabled ? "ok" : "bad")}
                </td>
                <td>
                  ${group.routes.length
                    ? group.routes
                        .map(
                          (route) => `
                            <div class="stack-item">
                              <div><strong>#${route.route_order}</strong> ${route.provider_name} / ${route.provider_model_name}</div>
                              <div class="muted">${route.provider_key_label} · 日 ${route.daily_used}/${route.daily_limit || "∞"} · 月 ${route.monthly_used}/${route.monthly_limit || "∞"}</div>
                              <div>${pill(route.health_status, toneForHealth(route.health_status))} ${pill(route.enabled ? "路由启用" : "路由停用", route.enabled ? "ok" : "bad")}</div>
                              <div class="row-actions">
                                <button data-action="force-route" data-group-id="${group.id}" data-route-id="${route.id}">设为主路由</button>
                                <button data-action="toggle-route" data-id="${route.id}" data-enabled="${route.enabled}">${route.enabled ? "停用路由" : "启用路由"}</button>
                                <button data-action="edit-route" data-id="${route.id}" data-key-id="${route.provider_key_id}" data-order="${route.route_order}" data-model="${route.provider_model_name}" data-daily="${route.daily_limit}" data-monthly="${route.monthly_limit}" data-threshold="${route.warning_threshold}">编辑</button>
                                <button data-action="delete-route" data-id="${route.id}" data-group-name="${group.name}" data-model="${route.provider_model_name}">删除</button>
                              </div>
                            </div>
                          `
                        )
                        .join("<hr />")
                    : '<span class="muted">暂无路由</span>'}
                </td>
                <td>
                  <div class="row-actions">
                    <button data-action="toggle-group" data-id="${group.id}" data-enabled="${group.enabled}">${group.enabled ? "停用组" : "启用组"}</button>
                    <button data-action="edit-group" data-id="${group.id}" data-name="${group.name}" data-level="${group.capability_level}" data-fallback="${group.fallback_policy}">编辑组</button>
                  </div>
                </td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderQuotas() {
  views.quotaTable.innerHTML = `
    <table>
      <thead><tr><th>逻辑模型</th><th>目标</th><th>额度</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        ${state.quotas
          .map(
            (item) => `
              <tr>
                <td>${item.group_name}</td>
                <td>${item.provider_name} / ${item.provider_model_name}<br /><span class="muted">${item.provider_key_label}</span></td>
                <td>
                  日 ${item.daily_used}/${item.daily_limit || "∞"}<br />
                  月 ${item.monthly_used}/${item.monthly_limit || "∞"}<br />
                  阈值 ${item.warning_threshold}%
                </td>
                <td>${pill(item.quota_exhausted ? "已耗尽" : item.warning_reached ? "接近阈值" : "正常", toneForQuota(item))}</td>
                <td>
                  <div class="row-actions">
                    <button data-action="edit-quota" data-id="${item.id}" data-daily="${item.daily_limit}" data-monthly="${item.monthly_limit}" data-threshold="${item.warning_threshold}">编辑额度</button>
                    <button data-action="reset-quota" data-id="${item.id}">重置</button>
                  </div>
                </td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderLogs() {
  views.requestLogs.innerHTML = `
    <table>
      <thead><tr><th>模型</th><th>实际路由</th><th>状态</th><th>错误详情</th><th>尝试</th><th>时间</th></tr></thead>
      <tbody>
        ${state.requestLogs
          .map(
            (item) => `
              <tr>
                <td>${item.requested_model}</td>
                <td>${item.routed_provider || "-"} / ${item.routed_model || "-"}</td>
                <td>${item.status_code || "-"} ${item.error_code ? `<span class="muted">(${item.error_code})</span>` : ""}</td>
                <td class="muted">${item.error_detail ? item.error_detail : "-"}</td>
                <td>${item.attempts}</td>
                <td>${new Date(item.created_at).toLocaleString()}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;

  views.switchLogs.innerHTML = `
    <table>
      <thead><tr><th>模型</th><th>从</th><th>到</th><th>原因</th><th>时间</th></tr></thead>
      <tbody>
        ${state.switchLogs
          .map(
            (item) => `
              <tr>
                <td>${item.requested_model}</td>
                <td>${item.from_target}</td>
                <td>${item.to_target}</td>
                <td>${item.reason}</td>
                <td>${new Date(item.created_at).toLocaleString()}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderSystem() {
  if (!state.system) return;
  const snippet = [
    `Base URL: ${state.system.gateway.baseURL}`,
    `API Key 已配置: ${state.system.gatewayApiKeyConfigured ? "是" : "否"}`,
    `示例模型: ${state.system.gateway.exampleModel}`,
  ].join("\n");
  views.gatewaySnippet.textContent = snippet;
}

async function refreshAll() {
  const [dashboard, providers, groups, quotas, requests, switches, system] = await Promise.all([
    api("/admin/dashboard/summary"),
    api("/admin/providers"),
    api("/admin/model-groups"),
    api("/admin/quotas"),
    api("/admin/logs/requests"),
    api("/admin/logs/switches"),
    api("/admin/system/settings"),
  ]);

  state.dashboard = dashboard;
  state.providers = providers.providers;
  state.providerKeyOptions = providers.providerKeyOptions;
  state.groups = groups.groups;
  state.aliases = groups.aliases || [];
  state.quotas = quotas.items;
  state.requestLogs = requests.items;
  state.switchLogs = switches.items;
  state.system = system;

  renderSummary();
  renderProviders();
  renderGroups();
  renderQuotas();
  renderLogs();
  renderSystem();
}

async function refreshLogs() {
  const [requests, switches] = await Promise.all([
    api("/admin/logs/requests"),
    api("/admin/logs/switches"),
  ]);

  state.requestLogs = requests.items;
  state.switchLogs = switches.items;
  renderLogs();
}

function startAutoRefresh() {
  if (logRefreshTimer) {
    clearInterval(logRefreshTimer);
  }

  logRefreshTimer = setInterval(() => {
    if (views.appView.hidden || state.activePanel !== "logs") {
      return;
    }

    refreshLogs().catch(() => null);
  }, LOG_REFRESH_INTERVAL_MS);
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
    startAutoRefresh();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

document.getElementById("setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    setStatus("正在初始化...");
    await api("/admin/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify({
        password: form.elements.password.value,
        gatewayApiKey: form.elements.gatewayApiKey.value,
      }),
    });
    showApp();
    await refreshAll();
    startAutoRefresh();
    setStatus("初始化完成");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    setStatus("正在登录...");
    await api("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: form.elements.password.value }),
    });
    showApp();
    await refreshAll();
    startAutoRefresh();
    setStatus("已登录");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

views.providerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const providerId = form.dataset.editId;
    await api(providerId ? `/admin/providers/${providerId}` : "/admin/providers", {
      method: providerId ? "PATCH" : "POST",
      body: JSON.stringify({
        name: form.elements.name.value,
        baseUrl: form.elements.baseUrl.value,
        timeoutMs: numberField(form, "timeoutMs"),
        priority: numberField(form, "priority"),
        enabled: boolField(form, "enabled"),
        keys: !providerId && form.elements.apiKey.value
          ? [
              {
                label: form.elements.keyLabel.value || "primary",
                apiKey: form.elements.apiKey.value,
                enabled: true,
              },
            ]
          : [],
      }),
    });
    resetProviderForm();
    await refreshAll();
    setStatus(providerId ? "服务商已更新" : "服务商已创建");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

views.providerKeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const keyId = form.dataset.editId;
    await api(keyId ? `/admin/provider-keys/${keyId}` : "/admin/provider-keys", {
      method: keyId ? "PATCH" : "POST",
      body: JSON.stringify({
        providerId: keyId ? undefined : form.elements.providerId.value,
        label: form.elements.label.value,
        ...(form.elements.apiKey.value ? { apiKey: form.elements.apiKey.value } : {}),
        enabled: boolField(form, "enabled"),
      }),
    });
    resetProviderKeyForm();
    form.elements.apiKey.required = true;
    form.elements.apiKey.placeholder = "";
    await refreshAll();
    setStatus(keyId ? "API Key 已更新" : "API Key 已添加");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

views.groupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const groupId = form.dataset.editId;
    await api(groupId ? `/admin/model-groups/${groupId}` : "/admin/model-groups", {
      method: groupId ? "PATCH" : "POST",
      body: JSON.stringify({
        name: form.elements.name.value,
        capabilityLevel: form.elements.capabilityLevel.value,
        fallbackPolicy: form.elements.fallbackPolicy.value,
        enabled: boolField(form, "enabled"),
      }),
    });
    resetGroupForm();
    await refreshAll();
    setStatus(groupId ? "逻辑模型组已更新" : "逻辑模型组已创建");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

views.aliasForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const aliasId = form.dataset.editId;
    await api(aliasId ? `/admin/model-aliases/${aliasId}` : "/admin/model-aliases", {
      method: aliasId ? "PATCH" : "POST",
      body: JSON.stringify({
        name: form.elements.name.value,
        groupId: form.elements.groupId.value,
        enabled: boolField(form, "enabled"),
      }),
    });
    resetAliasForm();
    await refreshAll();
    setStatus(aliasId ? "统一模型名已更新" : "统一模型名已创建");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

views.routeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const routeId = form.dataset.editId;
    await api(routeId ? `/admin/model-routes/${routeId}` : "/admin/model-routes", {
      method: routeId ? "PATCH" : "POST",
      body: JSON.stringify({
        groupId: routeId ? undefined : form.elements.groupId.value,
        providerKeyId: form.elements.providerKeyId.value,
        providerModelName: form.elements.providerModelName.value,
        order: numberField(form, "order"),
        dailyLimit: numberField(form, "dailyLimit"),
        monthlyLimit: numberField(form, "monthlyLimit"),
        warningThreshold: numberField(form, "warningThreshold"),
        enabled: boolField(form, "enabled"),
      }),
    });
    resetRouteForm();
    await refreshAll();
    setStatus(routeId ? "候选路由已更新" : "候选路由已添加");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("systemForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/admin/system/settings", {
      method: "PATCH",
      body: JSON.stringify({ gatewayApiKey: form.elements.gatewayApiKey.value }),
    });
    form.reset();
    await refreshAll();
    setStatus("Gateway API Key 已更新");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/admin/system/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: form.elements.currentPassword.value,
        newPassword: form.elements.newPassword.value,
      }),
    });
    form.reset();
    setStatus("管理员密码已更新");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

views.logoutButton.addEventListener("click", async () => {
  await api("/admin/auth/logout", { method: "POST" }).catch(() => null);
  if (logRefreshTimer) {
    clearInterval(logRefreshTimer);
    logRefreshTimer = null;
  }
  showAuth("login");
  setStatus("已退出");
});

views.nav.addEventListener("click", (event) => {
  const button = event.target.closest(".nav-link");
  if (!button) return;
  switchPanel(button.dataset.view);
});

views.providerFormCancel.addEventListener("click", () => resetProviderForm());
views.providerKeyFormCancel.addEventListener("click", () => {
  resetProviderKeyForm();
  views.providerKeyForm.elements.apiKey.required = true;
  views.providerKeyForm.elements.apiKey.placeholder = "";
});
views.groupFormCancel.addEventListener("click", () => resetGroupForm());
views.aliasFormCancel.addEventListener("click", () => resetAliasForm());
views.routeFormCancel.addEventListener("click", () => resetRouteForm());

document.body.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action } = button.dataset;
  try {
    if (action === "toggle-provider") {
      await api(`/admin/providers/${button.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: button.dataset.enabled !== "1" }),
      });
    } else if (action === "edit-provider") {
      beginEditProvider(Number(button.dataset.id));
      setStatus("已加载服务商配置到表单");
      return;
    } else if (action === "test-provider") {
      setStatus("正在测试连接...");
      await api(`/admin/providers/${button.dataset.id}/test`, { method: "POST" });
      setStatus("Provider 连接测试成功");
      return;
    } else if (action === "toggle-key") {
      await api(`/admin/provider-keys/${button.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: button.dataset.enabled !== "1" }),
      });
    } else if (action === "edit-key") {
      beginEditProviderKey(Number(button.dataset.id));
      setStatus("已加载 API Key 配置到表单");
      return;
    } else if (action === "toggle-group") {
      await api(`/admin/model-groups/${button.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: button.dataset.enabled !== "1" }),
      });
    } else if (action === "edit-group") {
      beginEditGroup(Number(button.dataset.id));
      setStatus("已加载模型组配置到表单");
      return;
    } else if (action === "toggle-alias") {
      await api(`/admin/model-aliases/${button.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: button.dataset.enabled !== "1" }),
      });
    } else if (action === "edit-alias") {
      beginEditAlias(Number(button.dataset.id));
      setStatus("已加载统一模型名配置到表单");
      return;
    } else if (action === "force-route") {
      await api(`/admin/model-groups/${button.dataset.groupId}`, {
        method: "PATCH",
        body: JSON.stringify({ forcedRouteId: Number(button.dataset.routeId) }),
      });
    } else if (action === "toggle-route") {
      await api(`/admin/model-routes/${button.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: button.dataset.enabled !== "1" }),
      });
    } else if (action === "edit-route") {
      beginEditRoute(Number(button.dataset.id));
      setStatus("已加载路由配置到表单");
      return;
    } else if (action === "delete-route") {
      const confirmed = confirm(
        `确认删除模型组 ${button.dataset.groupName} 下的路由 ${button.dataset.model} 吗？`
      );
      if (!confirmed) return;
      await api(`/admin/model-routes/${button.dataset.id}`, {
        method: "DELETE",
      });
    } else if (action === "edit-quota") {
      beginEditRoute(Number(button.dataset.id));
      setStatus("已加载额度配置到路由表单");
      return;
    } else if (action === "reset-quota") {
      await api(`/admin/quotas/${button.dataset.id}/reset`, {
        method: "POST",
        body: JSON.stringify({ period: "all" }),
      });
    }

    await refreshAll();
    setStatus("操作已完成");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

boot();
