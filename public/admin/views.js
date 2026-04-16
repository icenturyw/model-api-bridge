function formatTime(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

function pill(text, tone = "neutral") {
  return `<span class="pill ${tone}">${text}</span>`;
}

function healthTone(status) {
  if (status === "healthy") return "ok";
  if (status === "degraded") return "warn";
  return "bad";
}

function quotaTone(item) {
  if (item.quota_exhausted) return "bad";
  if (item.warning_reached) return "warn";
  return "ok";
}

function layout({ status, activeView, providers, routing, app, logsTab }) {
  const providerCards = providers.providers
    .map(
      (provider) => `
        <button class="entity-card ${provider.id === providers.activeProviderId ? "selected" : ""}" data-action="select-provider" data-id="${provider.id}">
          <span class="entity-title">${provider.name}</span>
          <span class="entity-meta">${provider.base_url}</span>
          <span class="entity-meta">Keys ${provider.stats.keyCount} · Routes ${provider.stats.routeCount || 0}</span>
          <span class="entity-meta">RPM ${provider.requests_per_minute || "∞"} · 当前 ${provider.minute_window_count || 0}</span>
        </button>
      `
    )
    .join("");

  const groupCards = routing.groups
    .map(
      (group) => `
        <button class="entity-card ${group.id === routing.activeGroupId ? "selected" : ""}" data-action="select-group" data-id="${group.id}">
          <span class="entity-title">${group.name}</span>
          <span class="entity-meta">${group.capability_level} · ${group.fallback_policy}</span>
          <span class="entity-meta">${group.routes.length} routes</span>
        </button>
      `
    )
    .join("");

  return `
    <div class="shell">
      <aside class="sidebar">
        <div>
          <p class="eyebrow">OpenClaw Router</p>
          <h1>Admin Console</h1>
          <p class="muted inverse">统一查看 provider、路由、额度与故障切换。</p>
        </div>

        <nav class="nav">
          ${[
            ["overview", "Overview"],
            ["providers", "Providers"],
            ["routing", "Routing"],
            ["quotas", "Quotas"],
            ["logs", "Logs"],
            ["system", "System"],
          ]
            .map(
              ([key, label]) => `
                <button class="nav-link ${activeView === key ? "active" : ""}" data-action="switch-view" data-view="${key}">
                  ${label}
                </button>
              `
            )
            .join("")}
        </nav>

        <section class="sidebar-section">
          <div class="section-heading">
            <span>Provider Focus</span>
            <button class="ghost-button" data-action="open-modal" data-modal="create-provider">新增</button>
          </div>
          <div class="entity-list">${providerCards || '<p class="empty-mini">暂无 provider</p>'}</div>
        </section>

        <section class="sidebar-section">
          <div class="section-heading">
            <span>Routing Focus</span>
            <button class="ghost-button" data-action="open-modal" data-modal="create-group">新增</button>
          </div>
          <div class="entity-list">${groupCards || '<p class="empty-mini">暂无模型组</p>'}</div>
        </section>

        <button class="ghost-button wide" data-action="logout">退出登录</button>
      </aside>

      <main class="content">
        <header class="page-header">
          <div>
            <p class="eyebrow">${activeView}</p>
            <h2>${viewTitle(activeView)}</h2>
          </div>
          <div class="header-actions">
            <div class="status-chip">${status.message}</div>
            <button data-action="refresh-view">刷新当前视图</button>
          </div>
        </header>

        <section class="page ${activeView === "overview" ? "active" : ""}">${overview(app.overview)}</section>
        <section class="page ${activeView === "providers" ? "active" : ""}">${providersView(providers)}</section>
        <section class="page ${activeView === "routing" ? "active" : ""}">${routingView(routing)}</section>
        <section class="page ${activeView === "quotas" ? "active" : ""}">${quotasView(app.quotas)}</section>
        <section class="page ${activeView === "logs" ? "active" : ""}">${logsView(app.logs, logsTab)}</section>
        <section class="page ${activeView === "system" ? "active" : ""}">${systemView(app.system)}</section>
      </main>
    </div>
  `;
}

function viewTitle(activeView) {
  const titles = {
    overview: "运行总览",
    providers: "Provider 管理",
    routing: "模型路由",
    quotas: "额度控制",
    logs: "日志观察",
    system: "系统设置",
  };
  return titles[activeView];
}

function overview(data) {
  if (!data) {
    return "";
  }

  const metrics = [
    ["Providers", data.totals.providers],
    ["API Keys", data.totals.providerKeys],
    ["Model Groups", data.totals.modelGroups],
    ["Aliases", data.totals.modelAliases],
    ["Today Requests", data.totals.requestCountToday],
  ];

  return `
    <div class="card-grid">
      ${metrics
        .map(
          ([label, value]) => `
            <article class="metric-card">
              <span>${label}</span>
              <strong>${value}</strong>
            </article>
          `
        )
        .join("")}
    </div>

    <div class="split-grid">
      <article class="panel-card">
        <div class="card-header">
          <h3>Provider 健康概览</h3>
        </div>
        <table class="data-table">
          <thead><tr><th>Provider</th><th>Healthy</th><th>Degraded</th><th>Unhealthy</th></tr></thead>
          <tbody>
            ${data.providerHealth
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
      </article>

      <article class="panel-card">
        <div class="card-header">
          <h3>即将耗尽的路由</h3>
        </div>
        ${data.soonExhausted.length
          ? `
            <table class="data-table">
              <thead><tr><th>Group</th><th>Target</th><th>Status</th></tr></thead>
              <tbody>
                ${data.soonExhausted
                  .map(
                    (item) => `
                      <tr>
                        <td>${item.group_name}</td>
                        <td>${item.provider_name} / ${item.provider_model_name}</td>
                        <td>${pill(item.quota_exhausted ? "已耗尽" : "接近阈值", quotaTone(item))}</td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          `
          : '<p class="empty-state">目前没有接近阈值的路由。</p>'}
      </article>
    </div>

    <div class="split-grid">
      <article class="panel-card">
        <div class="card-header">
          <h3>最近切换</h3>
        </div>
        ${data.recentSwitches.length
          ? `
            <table class="data-table">
              <thead><tr><th>模型</th><th>切换</th><th>原因</th><th>时间</th></tr></thead>
              <tbody>
                ${data.recentSwitches
                  .map(
                    (item) => `
                      <tr>
                        <td>${item.requested_model}</td>
                        <td>${item.from_target} → ${item.to_target}</td>
                        <td>${item.reason}</td>
                        <td>${formatTime(item.created_at)}</td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          `
          : '<p class="empty-state">还没有切换事件。</p>'}
      </article>

      <article class="panel-card">
        <div class="card-header">
          <h3>最近错误</h3>
        </div>
        ${data.recentErrors.length
          ? `
            <table class="data-table">
              <thead><tr><th>模型</th><th>状态</th><th>实际路由</th><th>时间</th></tr></thead>
              <tbody>
                ${data.recentErrors
                  .map(
                    (item) => `
                      <tr>
                        <td>${item.requested_model}</td>
                        <td>${item.status_code || "-"} ${item.error_code ? `<span class="muted">(${item.error_code})</span>` : ""}</td>
                        <td>${item.routed_provider || "-"} / ${item.routed_model || "-"}</td>
                        <td>${formatTime(item.created_at)}</td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          `
          : '<p class="empty-state">最近没有错误请求。</p>'}
      </article>
    </div>
  `;
}

function providersView(state) {
  const provider = state.detail;
  return `
    <div class="page-toolbar">
      <div>
        <h3>Provider 列表</h3>
        <p class="muted">查看连接状态、Key 健康和被哪些模型组使用。</p>
      </div>
      <button data-action="open-modal" data-modal="create-provider">新增 Provider</button>
    </div>

    <div class="detail-layout">
      <article class="panel-card">
        <div class="stack-list">
          ${state.providers
            .map(
              (item) => `
                <button class="list-row ${item.id === state.activeProviderId ? "selected" : ""}" data-action="select-provider" data-id="${item.id}">
                  <strong>${item.name}</strong>
                  <span>${item.base_url}</span>
                  <span>${pill(item.enabled ? "启用" : "停用", item.enabled ? "ok" : "bad")} ${pill(`${item.stats.healthyKeys}/${item.stats.keyCount} healthy`, "neutral")}</span>
                </button>
              `
            )
            .join("")}
        </div>
      </article>

      <article class="panel-card">
        ${provider
          ? `
            <div class="card-header">
              <div>
                <h3>${provider.name}</h3>
                <p class="muted">${provider.base_url}</p>
              </div>
              <div class="row-actions">
                <button data-action="open-modal" data-modal="edit-provider" data-id="${provider.id}">编辑 Provider</button>
                <button data-action="test-provider" data-id="${provider.id}">测试连接</button>
                <button data-action="open-modal" data-modal="create-key" data-provider-id="${provider.id}">新增 Key</button>
              </div>
            </div>
            <div class="stats-strip">
              <div><span>优先级</span><strong>${provider.priority}</strong></div>
              <div><span>超时</span><strong>${provider.timeout_ms}ms</strong></div>
              <div><span>分钟频率</span><strong>${provider.requests_per_minute || "∞"}</strong></div>
              <div><span>路由数</span><strong>${provider.stats.routeCount}</strong></div>
              <div><span>关联组</span><strong>${provider.attachedGroups.length}</strong></div>
            </div>
            <p class="muted">当前分钟窗口请求数 ${provider.minute_window_count || 0}${provider.requests_per_minute > 0 ? ` / ${provider.requests_per_minute}` : ""}</p>
            <div class="subsection">
              <h4>API Keys</h4>
              <div class="stack-list">
                ${provider.keys
                  .map(
                    (key) => `
                      <div class="detail-card">
                        <div class="card-header">
                          <strong>${key.label}</strong>
                          <div class="row-actions">
                            ${pill(key.health_status, healthTone(key.health_status))}
                            ${pill(key.enabled ? "启用" : "停用", key.enabled ? "ok" : "bad")}
                            <button data-action="open-modal" data-modal="edit-key" data-id="${key.id}" data-provider-id="${provider.id}">编辑</button>
                          </div>
                        </div>
                        <p class="muted">${key.masked_key || "无鉴权 upstream"}</p>
                        <p class="muted">${key.last_error || "最近无错误"}</p>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>
            <div class="subsection">
              <h4>关联模型组</h4>
              ${provider.attachedGroups.length
                ? provider.attachedGroups.map((group) => `<span class="tag">${group.name}</span>`).join("")
                : '<p class="empty-state">当前没有模型组使用这个 provider。</p>'}
            </div>
          `
          : '<p class="empty-state">选择左侧 provider 查看详情。</p>'}
      </article>
    </div>
  `;
}

function routingView(state) {
  const group = state.detail;
  return `
    <div class="page-toolbar">
      <div>
        <h3>模型组与别名</h3>
        <p class="muted">把统一模型名、候选路由和强制主路由放到同一视图管理。</p>
      </div>
      <div class="row-actions">
        <button data-action="open-modal" data-modal="create-group">新增模型组</button>
        <button data-action="open-modal" data-modal="create-alias">新增别名</button>
      </div>
    </div>

    <div class="detail-layout">
      <article class="panel-card">
        <div class="stack-list">
          ${state.groups
            .map(
              (item) => `
                <button class="list-row ${item.id === state.activeGroupId ? "selected" : ""}" data-action="select-group" data-id="${item.id}">
                  <strong>${item.name}</strong>
                  <span>${item.capability_level} · ${item.fallback_policy}</span>
                  <span>${pill(item.enabled ? "启用" : "停用", item.enabled ? "ok" : "bad")}</span>
                </button>
              `
            )
            .join("")}
        </div>
      </article>

      <article class="panel-card">
        ${group
          ? `
            <div class="card-header">
              <div>
                <h3>${group.name}</h3>
                <p class="muted">${group.capability_level} · ${group.fallback_policy}</p>
              </div>
              <div class="row-actions">
                <button data-action="open-modal" data-modal="edit-group" data-id="${group.id}">编辑组</button>
                <button data-action="open-modal" data-modal="create-route" data-group-id="${group.id}">新增路由</button>
                <button data-action="open-modal" data-modal="create-alias" data-group-id="${group.id}">新增别名</button>
              </div>
            </div>

            <div class="subsection">
              <h4>统一模型名</h4>
              ${group.aliases.length
                ? group.aliases
                    .map(
                      (alias) => `
                        <div class="detail-card">
                          <div class="card-header">
                            <strong>${alias.name}</strong>
                            <div class="row-actions">
                              ${pill(alias.enabled ? "启用" : "停用", alias.enabled ? "ok" : "bad")}
                              <button data-action="open-modal" data-modal="edit-alias" data-id="${alias.id}">编辑</button>
                            </div>
                          </div>
                        </div>
                      `
                    )
                    .join("")
                : '<p class="empty-state">当前没有外部别名，客户端会直接使用模型组名。</p>'}
            </div>

            <div class="subsection">
              <h4>候选路由</h4>
              ${group.routes.length
                ? group.routes
                    .map(
                      (route) => `
                        <div class="detail-card">
                          <div class="card-header">
                            <div>
                              <strong>#${route.route_order} ${route.provider_name} / ${route.provider_model_name}</strong>
                              <p class="muted">${route.provider_key_label}</p>
                            </div>
                            <div class="row-actions">
                              ${pill(route.health_status, healthTone(route.health_status))}
                              ${pill(route.enabled ? "启用" : "停用", route.enabled ? "ok" : "bad")}
                              ${group.forced_route_id === route.id ? pill("主路由", "accent") : ""}
                            </div>
                          </div>
                          <p class="muted">日 ${route.daily_used}/${route.daily_limit || "∞"} · 月 ${route.monthly_used}/${route.monthly_limit || "∞"} · 阈值 ${route.warning_threshold}%</p>
                          <div class="row-actions">
                            <button data-action="force-route" data-group-id="${group.id}" data-route-id="${route.id}">设为主路由</button>
                            <button data-action="open-modal" data-modal="edit-route" data-id="${route.id}">编辑</button>
                            <button data-action="delete-route" data-id="${route.id}">删除</button>
                          </div>
                        </div>
                      `
                    )
                    .join("")
                : '<p class="empty-state">当前模型组还没有候选路由。</p>'}
            </div>
          `
          : '<p class="empty-state">选择左侧模型组查看详情。</p>'}
      </article>
    </div>
  `;
}

function quotasView(data) {
  return `
    <div class="page-toolbar">
      <div>
        <h3>额度与阈值</h3>
        <p class="muted">按状态、模型组、Provider 过滤，快速找到接近阈值或已耗尽的路由。</p>
      </div>
    </div>

    <form id="quotaFilters" class="filter-row">
      <select name="status">
        <option value="">全部状态</option>
        <option value="warning" ${data.filters.status === "warning" ? "selected" : ""}>接近阈值</option>
        <option value="exhausted" ${data.filters.status === "exhausted" ? "selected" : ""}>已耗尽</option>
        <option value="normal" ${data.filters.status === "normal" ? "selected" : ""}>正常</option>
      </select>
      <select name="groupId">
        <option value="">全部模型组</option>
        ${data.groups.map((group) => `<option value="${group.id}" ${String(data.filters.groupId) === String(group.id) ? "selected" : ""}>${group.name}</option>`).join("")}
      </select>
      <select name="providerId">
        <option value="">全部 Provider</option>
        ${data.providers.map((provider) => `<option value="${provider.id}" ${String(data.filters.providerId) === String(provider.id) ? "selected" : ""}>${provider.name}</option>`).join("")}
      </select>
      <button type="submit">应用筛选</button>
    </form>

    <article class="panel-card">
      <table class="data-table">
        <thead><tr><th>模型组</th><th>目标</th><th>额度</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${data.items
            .map(
              (item) => `
                <tr>
                  <td>${item.group_name}</td>
                  <td>${item.provider_name} / ${item.provider_model_name}<br /><span class="muted">${item.provider_key_label}</span></td>
                  <td>日 ${item.daily_used}/${item.daily_limit || "∞"}<br />月 ${item.monthly_used}/${item.monthly_limit || "∞"}<br />阈值 ${item.warning_threshold}%</td>
                  <td>${pill(item.quota_exhausted ? "已耗尽" : item.warning_reached ? "接近阈值" : "正常", quotaTone(item))}</td>
                  <td>
                    <div class="row-actions">
                      <button data-action="open-modal" data-modal="edit-quota" data-id="${item.id}">编辑</button>
                      <button data-action="reset-quota" data-id="${item.id}">重置</button>
                    </div>
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </article>
  `;
}

function logsView(data, activeTab) {
  return `
    <div class="page-toolbar">
      <div>
        <h3>日志观察</h3>
        <p class="muted">把错误、切换和尝试次数集中观察，而不是被动翻表格。</p>
      </div>
      <div class="row-actions">
        <button class="${activeTab === "requests" ? "tab-button active" : "tab-button"}" data-action="switch-logs-tab" data-tab="requests">请求日志</button>
        <button class="${activeTab === "switches" ? "tab-button active" : "tab-button"}" data-action="switch-logs-tab" data-tab="switches">切换日志</button>
      </div>
    </div>

    ${activeTab === "requests" ? requestLogs(data.requests) : switchLogs(data.switches)}
  `;
}

function requestLogs(data) {
  return `
    <form id="requestLogFilters" class="filter-row">
      <select name="model">
        <option value="">全部模型</option>
        ${data.models.map((item) => `<option value="${item}" ${data.filters.model === item ? "selected" : ""}>${item}</option>`).join("")}
      </select>
      <select name="provider">
        <option value="">全部 Provider</option>
        ${data.providers.map((item) => `<option value="${item}" ${data.filters.provider === item ? "selected" : ""}>${item}</option>`).join("")}
      </select>
      <select name="status">
        <option value="">全部状态</option>
        <option value="success" ${data.filters.status === "success" ? "selected" : ""}>成功</option>
        <option value="error" ${data.filters.status === "error" ? "selected" : ""}>错误</option>
      </select>
      <button type="submit">应用筛选</button>
    </form>
    <article class="panel-card">
      <table class="data-table">
        <thead><tr><th>模型</th><th>实际路由</th><th>状态</th><th>错误详情</th><th>尝试</th><th>时间</th></tr></thead>
        <tbody>
          ${data.items
            .map(
              (item) => `
                <tr>
                  <td>${item.requested_model}</td>
                  <td>${item.routed_provider || "-"} / ${item.routed_model || "-"}</td>
                  <td>${item.status_code || "-"} ${item.error_code ? `<span class="muted">(${item.error_code})</span>` : ""}</td>
                  <td class="log-detail">${item.error_detail || "-"}</td>
                  <td>${item.attempts}</td>
                  <td>${formatTime(item.created_at)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </article>
  `;
}

function switchLogs(data) {
  return `
    <form id="switchLogFilters" class="filter-row">
      <select name="model">
        <option value="">全部模型</option>
        ${data.models.map((item) => `<option value="${item}" ${data.filters.model === item ? "selected" : ""}>${item}</option>`).join("")}
      </select>
      <select name="reason">
        <option value="">全部原因</option>
        ${data.reasons.map((item) => `<option value="${item}" ${data.filters.reason === item ? "selected" : ""}>${item}</option>`).join("")}
      </select>
      <button type="submit">应用筛选</button>
    </form>
    <article class="panel-card">
      <table class="data-table">
        <thead><tr><th>模型</th><th>从</th><th>到</th><th>原因</th><th>时间</th></tr></thead>
        <tbody>
          ${data.items
            .map(
              (item) => `
                <tr>
                  <td>${item.requested_model}</td>
                  <td>${item.from_target}</td>
                  <td>${item.to_target}</td>
                  <td>${item.reason}</td>
                  <td>${formatTime(item.created_at)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </article>
  `;
}

function systemView(data) {
  return `
    <div class="split-grid">
      <article class="panel-card">
        <div class="card-header">
          <h3>Gateway 设置</h3>
        </div>
        <p class="muted">Gateway API Key 只存哈希，更新后客户端统一接到当前网关入口。</p>
        <form id="systemForm" class="stack-form">
          <label>
            新的 Gateway API Key
            <input name="gatewayApiKey" type="text" placeholder="留空则不修改" />
          </label>
          <button type="submit">更新 Gateway Key</button>
        </form>
        <pre class="snippet">Base URL: ${data.gateway.baseURL}
API Key 已配置: ${data.gatewayApiKeyConfigured ? "是" : "否"}
示例模型: ${data.gateway.exampleModel}</pre>
      </article>

      <article class="panel-card">
        <div class="card-header">
          <h3>管理员密码</h3>
        </div>
        <form id="passwordForm" class="stack-form">
          <label>
            当前密码
            <input name="currentPassword" type="password" required />
          </label>
          <label>
            新密码
            <input name="newPassword" type="password" minlength="8" required />
          </label>
          <button type="submit">修改密码</button>
        </form>
      </article>
    </div>
  `;
}

function optionList(items, selectedId) {
  return items
    .map((item) => `<option value="${item.id}" ${String(selectedId) === String(item.id) ? "selected" : ""}>${item.name}</option>`)
    .join("");
}

export function modalContent(type, data) {
  if (type === "create-provider" || type === "edit-provider") {
    const provider = data.provider || {};
    return `
      <form method="dialog" class="modal-shell" id="providerModalForm" data-form="${type}">
        <div class="card-header"><h3>${type === "edit-provider" ? "编辑 Provider" : "新增 Provider"}</h3><button class="ghost-button" value="cancel">关闭</button></div>
        <label>名称<input name="name" value="${provider.name || ""}" required /></label>
        <label>Base URL<input name="baseUrl" value="${provider.base_url || ""}" required /></label>
        <label>超时(ms)<input name="timeoutMs" type="number" value="${provider.timeout_ms || 25000}" /></label>
        <label>每分钟请求频率<input name="requestsPerMinute" type="number" min="0" value="${provider.requests_per_minute || 0}" placeholder="0 表示不限制" /></label>
        <label>优先级<input name="priority" type="number" value="${provider.priority || 100}" /></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${provider.enabled === 0 ? "" : "checked"} /> 启用</label>
        ${type === "create-provider" ? `
          <label>首个 Key 标签<input name="keyLabel" value="primary" /></label>
          <label>首个 API Key<input name="apiKey" /></label>
        ` : ""}
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="${type}" data-id="${provider.id || ""}">保存</button>
        </menu>
      </form>
    `;
  }

  if (type === "create-key" || type === "edit-key") {
    const key = data.key || {};
    const providerId = data.providerId || key.provider_id;
    return `
      <form method="dialog" class="modal-shell" id="providerKeyModalForm" data-form="${type}">
        <div class="card-header"><h3>${type === "edit-key" ? "编辑 API Key" : "新增 API Key"}</h3><button class="ghost-button" value="cancel">关闭</button></div>
        <input type="hidden" name="providerId" value="${providerId}" />
        <label>标签<input name="label" value="${key.label || ""}" required /></label>
        <label>API Key<input name="apiKey" placeholder="${type === "edit-key" ? "留空则不修改" : "留空表示无鉴权 upstream"}" /></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${key.enabled === 0 ? "" : "checked"} /> 启用</label>
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="${type}" data-id="${key.id || ""}">保存</button>
        </menu>
      </form>
    `;
  }

  if (type === "create-group" || type === "edit-group") {
    const group = data.group || {};
    return `
      <form method="dialog" class="modal-shell" id="groupModalForm" data-form="${type}">
        <div class="card-header"><h3>${type === "edit-group" ? "编辑模型组" : "新增模型组"}</h3><button class="ghost-button" value="cancel">关闭</button></div>
        <label>逻辑模型名<input name="name" value="${group.name || ""}" required /></label>
        <label>能力等级<input name="capabilityLevel" value="${group.capability_level || "standard"}" /></label>
        <label>Fallback 策略<input name="fallbackPolicy" value="${group.fallback_policy || "same-group"}" /></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${group.enabled === 0 ? "" : "checked"} /> 启用</label>
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="${type}" data-id="${group.id || ""}">保存</button>
        </menu>
      </form>
    `;
  }

  if (type === "create-alias" || type === "edit-alias") {
    const alias = data.alias || {};
    return `
      <form method="dialog" class="modal-shell" id="aliasModalForm" data-form="${type}">
        <div class="card-header"><h3>${type === "edit-alias" ? "编辑别名" : "新增别名"}</h3><button class="ghost-button" value="cancel">关闭</button></div>
        <label>统一模型名<input name="name" value="${alias.name || ""}" required /></label>
        <label>指向模型组<select name="groupId">${optionList(data.groups, alias.group_id || data.groupId)}</select></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${alias.enabled === 0 ? "" : "checked"} /> 启用</label>
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="${type}" data-id="${alias.id || ""}">保存</button>
        </menu>
      </form>
    `;
  }

  if (type === "create-route" || type === "edit-route") {
    const route = data.route || {};
    return `
      <form method="dialog" class="modal-shell" id="routeModalForm" data-form="${type}">
        <div class="card-header"><h3>${type === "edit-route" ? "编辑路由" : "新增路由"}</h3><button class="ghost-button" value="cancel">关闭</button></div>
        <label>模型组<select name="groupId">${optionList(data.groups, route.group_id || data.groupId)}</select></label>
        <label>Provider Key
          <select name="providerKeyId">
            ${data.providerKeyOptions
              .map(
                (item) => `<option value="${item.id}" ${String(item.id) === String(route.provider_key_id) ? "selected" : ""}>${item.provider_name} / ${item.label} / ${item.health_status}</option>`
              )
              .join("")}
          </select>
        </label>
        <label>上游模型名<input name="providerModelName" value="${route.provider_model_name || ""}" required /></label>
        <label>顺序<input name="order" type="number" value="${route.route_order || 100}" /></label>
        <label>日额度<input name="dailyLimit" type="number" value="${route.daily_limit || 0}" /></label>
        <label>月额度<input name="monthlyLimit" type="number" value="${route.monthly_limit || 0}" /></label>
        <label>告警阈值(%)<input name="warningThreshold" type="number" value="${route.warning_threshold || 80}" /></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${route.enabled === 0 ? "" : "checked"} /> 启用</label>
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="${type}" data-id="${route.id || ""}">保存</button>
        </menu>
      </form>
    `;
  }

  if (type === "edit-quota") {
    const route = data.route;
    return `
      <form method="dialog" class="modal-shell" id="quotaModalForm" data-form="${type}">
        <div class="card-header"><h3>编辑额度</h3><button class="ghost-button" value="cancel">关闭</button></div>
        <label>日额度<input name="dailyLimit" type="number" value="${route.daily_limit}" /></label>
        <label>月额度<input name="monthlyLimit" type="number" value="${route.monthly_limit}" /></label>
        <label>告警阈值(%)<input name="warningThreshold" type="number" value="${route.warning_threshold}" /></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${route.enabled === 0 ? "" : "checked"} /> 启用</label>
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="${type}" data-id="${route.id}">保存</button>
        </menu>
      </form>
    `;
  }

  return "";
}

export { layout, formatTime };
