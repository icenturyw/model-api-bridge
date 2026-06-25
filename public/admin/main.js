import { api, jsonBody, boolValue, numberValue } from './api.js';
import { router } from './router.js';
import { registerViews, getViewList } from './views/index.js';
import { status } from './components/status.js';
import { modal } from './components/modal.js';
import { escapeHtml, formatTime, debounce } from './utils.js';

const state = {
  activeView: 'overview',
  logsTab: 'requests',
  loading: {},
  errors: {},
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
    filters: { status: '', groupId: '', providerId: '' },
  },
  logs: {
    requests: { items: [], models: [], providers: [], filters: { model: '', provider: '', status: '' } },
    switches: { items: [], models: [], reasons: [], filters: { model: '', reason: '' } },
  },
  system: null,
};

const appRoot = document.getElementById('appRoot');
const authRoot = document.getElementById('authRoot');
const setupCard = document.getElementById('setupCard');
const loginCard = document.getElementById('loginCard');
const modalElement = document.getElementById('modal');

function showAuth(mode) {
  authRoot.hidden = false;
  appRoot.hidden = true;
  setupCard.hidden = mode !== 'setup';
  loginCard.hidden = mode !== 'login';
  window.scrollTo(0, 0);
}

function showApp() {
  authRoot.hidden = true;
  appRoot.hidden = false;
  window.scrollTo(0, 0);
}

function setLoading(viewId, loading) {
  state.loading[viewId] = loading;
  renderApp();
}

function setError(viewId, error) {
  state.errors[viewId] = error;
  renderApp();
}

function clearError(viewId) {
  state.errors[viewId] = null;
}

async function loadOverview() {
  setLoading('overview', true);
  clearError('overview');
  try {
    const res = await api('/admin/api/overview');
    state.overview = res.data;
  } catch (error) {
    setError('overview', error.message);
  } finally {
    setLoading('overview', false);
  }
}

async function loadProviders() {
  setLoading('providers', true);
  clearError('providers');
  try {
    const res = await api('/admin/api/providers');
    const data = res.data;
    state.providers.providers = data.providers;
    state.providers.providerKeyOptions = data.providerKeyOptions;
    if (!data.providers.some((provider) => provider.id === state.providers.activeProviderId)) {
      state.providers.activeProviderId = data.providers[0]?.id || null;
    }
    if (!state.providers.activeProviderId && data.providers[0]) {
      state.providers.activeProviderId = data.providers[0].id;
    }
    if (state.providers.activeProviderId) {
      const detailRes = await api(`/admin/api/providers/${state.providers.activeProviderId}`);
      state.providers.detail = detailRes.data;
    } else {
      state.providers.detail = null;
    }
  } catch (error) {
    setError('providers', error.message);
  } finally {
    setLoading('providers', false);
  }
}

async function loadProviderDetail(providerId) {
  state.providers.activeProviderId = providerId;
  try {
    const res = await api(`/admin/api/providers/${providerId}`);
    state.providers.detail = res.data;
    renderApp();
  } catch (error) {
    status.show(error.message, 'error');
  }
}

async function loadRouting() {
  setLoading('routing', true);
  clearError('routing');
  try {
    const res = await api('/admin/api/routing');
    const data = res.data;
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
      const detailRes = await api(`/admin/api/routing/groups/${state.routing.activeGroupId}`);
      state.routing.detail = detailRes.data;
    } else {
      state.routing.detail = null;
    }
  } catch (error) {
    setError('routing', error.message);
  } finally {
    setLoading('routing', false);
  }
}

async function loadRoutingDetail(groupId) {
  state.routing.activeGroupId = groupId;
  try {
    const res = await api(`/admin/api/routing/groups/${groupId}`);
    state.routing.detail = res.data;
    renderApp();
  } catch (error) {
    status.show(error.message, 'error');
  }
}

async function loadQuotas() {
  setLoading('quotas', true);
  clearError('quotas');
  try {
    const params = new URLSearchParams();
    Object.entries(state.quotas.filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const res = await api(`/admin/api/quotas${params.toString() ? `?${params.toString()}` : ''}`);
    const data = res.data;
    state.quotas.items = data.items;
    state.quotas.groups = data.groups;
    state.quotas.providers = data.providers;
  } catch (error) {
    setError('quotas', error.message);
  } finally {
    setLoading('quotas', false);
  }
}

async function loadRequestLogs() {
  setLoading('logs', true);
  clearError('logs');
  try {
    const params = new URLSearchParams();
    Object.entries(state.logs.requests.filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const res = await api(`/admin/api/logs/requests${params.toString() ? `?${params.toString()}` : ''}`);
    const data = res.data;
    state.logs.requests.items = data.items;
    state.logs.requests.models = data.models;
    state.logs.requests.providers = data.providers;
  } catch (error) {
    setError('logs', error.message);
  } finally {
    setLoading('logs', false);
  }
}

async function loadSwitchLogs() {
  setLoading('logs', true);
  clearError('logs');
  try {
    const params = new URLSearchParams();
    Object.entries(state.logs.switches.filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const res = await api(`/admin/api/logs/switches${params.toString() ? `?${params.toString()}` : ''}`);
    const data = res.data;
    state.logs.switches.items = data.items;
    state.logs.switches.models = data.models;
    state.logs.switches.reasons = data.reasons;
  } catch (error) {
    setError('logs', error.message);
  } finally {
    setLoading('logs', false);
  }
}

async function loadSystem() {
  setLoading('system', true);
  clearError('system');
  try {
    const res = await api('/admin/api/system');
    state.system = res.data;
  } catch (error) {
    setError('system', error.message);
  } finally {
    setLoading('system', false);
  }
}

async function refreshCurrentView() {
  const view = router.getCurrentView();
  switch (view) {
    case 'overview': await loadOverview(); break;
    case 'providers': await loadProviders(); break;
    case 'routing': await loadRouting(); break;
    case 'quotas': await loadQuotas(); break;
    case 'logs':
      if (state.logsTab === 'requests') await loadRequestLogs();
      else await loadSwitchLogs();
      break;
    case 'system': await loadSystem(); break;
  }
  status.show('已刷新当前视图');
}

function renderApp() {
  if (appRoot.hidden) return;

  const viewList = getViewList();
  const currentView = router.getCurrentView() || 'overview';
  
  appRoot.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div>
          <p class="eyebrow">OpenClaw Router</p>
          <h1>Admin Console</h1>
          <p class="muted inverse">统一查看 provider、路由、额度与故障切换。</p>
        </div>
        
        <nav class="nav">
          ${viewList.map(view => `
            <button class="nav-link ${currentView === view.id ? 'active' : ''}" 
                    data-action="switch-view" data-view="${view.id}">
              ${view.icon} ${view.title}
            </button>
          `).join('')}
        </nav>
        
        <div class="sidebar-footer">
          <button class="ghost-button wide" data-action="logout">退出登录</button>
        </div>
      </aside>
      
      <main class="content">
        <header class="page-header">
          <div>
            <h2>${viewList.find(v => v.id === currentView)?.title || '运行总览'}</h2>
          </div>
          <div class="header-actions">
            <div class="status-chip" id="statusChip">准备就绪</div>
            <button data-action="refresh-view">刷新当前视图</button>
          </div>
        </header>
        
        <section class="page active" id="viewContainer">
          ${renderCurrentView()}
        </section>
      </main>
    </div>
  `;
  
  const statusChip = document.getElementById('statusChip');
  if (statusChip) status.init(statusChip);
}

function renderCurrentView() {
  const viewId = router.getCurrentView() || 'overview';
  const loading = state.loading[viewId];
  const error = state.errors[viewId];
  
  if (loading) {
    return '<div class="loading-container"><div class="loading-spinner"></div><p>加载中...</p></div>';
  }
  
  if (error) {
    return `
      <div class="error-container">
        <p class="error-message">${escapeHtml(error)}</p>
        <button data-action="retry-load">重试</button>
      </div>
    `;
  }
  
  switch (viewId) {
    case 'overview': return renderOverview();
    case 'providers': return renderProviders();
    case 'routing': return renderRouting();
    case 'quotas': return renderQuotas();
    case 'logs': return renderLogs();
    case 'system': return renderSystem();
    default: return renderOverview();
  }
}

function renderOverview() {
  if (!state.overview) return '<p class="empty-state">暂无数据</p>';
  const data = state.overview;
  
  const metrics = [
    ['Providers', data.totals.providers],
    ['API Keys', data.totals.providerKeys],
    ['Model Groups', data.totals.modelGroups],
    ['Aliases', data.totals.modelAliases],
    ['Today Requests', data.totals.requestCountToday],
  ];
  
  return `
    <div class="card-grid">
      ${metrics.map(([label, value]) => `
        <article class="metric-card">
          <span>${label}</span>
          <strong>${value}</strong>
        </article>
      `).join('')}
    </div>
    
    <div class="split-grid">
      <article class="panel-card">
        <div class="card-header">
          <h3>Provider 健康概览</h3>
        </div>
        <table class="data-table">
          <thead><tr><th>Provider</th><th>Healthy</th><th>Degraded</th><th>Unhealthy</th></tr></thead>
          <tbody>
            ${data.providerHealth.map(item => `
              <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${item.healthyKeys}</td>
                <td>${item.degradedKeys}</td>
                <td>${item.unhealthyKeys}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </article>
      
      <article class="panel-card">
        <div class="card-header">
          <h3>即将耗尽的路由</h3>
        </div>
        ${data.soonExhausted.length ? `
          <table class="data-table">
            <thead><tr><th>Group</th><th>Target</th><th>Status</th></tr></thead>
            <tbody>
              ${data.soonExhausted.map(item => `
                <tr>
                  <td>${escapeHtml(item.group_name)}</td>
                  <td>${escapeHtml(item.provider_name)} / ${escapeHtml(item.provider_model_name)}</td>
                  <td>${pill(item.quota_exhausted ? '已耗尽' : '接近阈值', quotaTone(item))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p class="empty-state">目前没有接近阈值的路由。</p>'}
      </article>
    </div>
    
    <div class="split-grid">
      <article class="panel-card">
        <div class="card-header">
          <h3>最近切换</h3>
        </div>
        ${data.recentSwitches.length ? `
          <table class="data-table">
            <thead><tr><th>模型</th><th>切换</th><th>原因</th><th>时间</th></tr></thead>
            <tbody>
              ${data.recentSwitches.map(item => `
                <tr>
                  <td>${escapeHtml(item.requested_model)}</td>
                  <td>${escapeHtml(item.from_target)} → ${escapeHtml(item.to_target)}</td>
                  <td>${escapeHtml(item.reason)}</td>
                  <td>${formatTime(item.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p class="empty-state">还没有切换事件。</p>'}
      </article>
      
      <article class="panel-card">
        <div class="card-header">
          <h3>最近错误</h3>
        </div>
        ${data.recentErrors.length ? `
          <table class="data-table">
            <thead><tr><th>模型</th><th>状态</th><th>实际路由</th><th>时间</th></tr></thead>
            <tbody>
              ${data.recentErrors.map(item => `
                <tr>
                  <td>${escapeHtml(item.requested_model)}</td>
                  <td>${item.status_code || '-'} ${item.error_code ? `<span class="muted">(${escapeHtml(item.error_code)})</span>` : ''}</td>
                  <td>${escapeHtml(item.routed_provider || '-')} / ${escapeHtml(item.routed_model || '-')}</td>
                  <td>${formatTime(item.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p class="empty-state">最近没有错误请求。</p>'}
      </article>
    </div>
  `;
}

function renderProviders() {
  const provider = state.providers.detail;
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
          ${state.providers.providers.map(item => `
            <button class="list-row ${item.id === state.providers.activeProviderId ? 'selected' : ''}" 
                    data-action="select-provider" data-id="${item.id}">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.base_url)}</span>
              <span>${pill(item.enabled ? '启用' : '停用', item.enabled ? 'ok' : 'bad')} 
                    ${pill(`${item.stats.healthyKeys}/${item.stats.keyCount} healthy`, 'neutral')}</span>
            </button>
          `).join('')}
        </div>
      </article>
      
      <article class="panel-card">
        ${provider ? `
          <div class="card-header">
            <div>
              <h3>${escapeHtml(provider.name)}</h3>
              <p class="muted">${escapeHtml(provider.base_url)}</p>
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
            <div><span>分钟频率</span><strong>${provider.requests_per_minute || '∞'}</strong></div>
            <div><span>路由数</span><strong>${provider.stats.routeCount}</strong></div>
            <div><span>关联组</span><strong>${provider.attachedGroups.length}</strong></div>
          </div>
          <p class="muted">当前分钟窗口请求数 ${provider.minute_window_count || 0}${provider.requests_per_minute > 0 ? ` / ${provider.requests_per_minute}` : ''}</p>
          <div class="subsection">
            <h4>API Keys</h4>
            <div class="stack-list">
              ${provider.keys.map(key => `
                <div class="detail-card">
                  <div class="card-header">
                    <strong>${escapeHtml(key.label)}</strong>
                    <div class="row-actions">
                      ${pill(key.health_status, healthTone(key.health_status))}
                      ${pill(key.enabled ? '启用' : '停用', key.enabled ? 'ok' : 'bad')}
                      <button data-action="open-modal" data-modal="edit-key" data-id="${key.id}" data-provider-id="${provider.id}">编辑</button>
                    </div>
                  </div>
                  <p class="muted">${escapeHtml(key.masked_key || '无鉴权 upstream')}</p>
                  <p class="muted">${escapeHtml(key.last_error || '最近无错误')}</p>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="subsection">
            <h4>关联模型组</h4>
            ${provider.attachedGroups.length
              ? provider.attachedGroups.map(group => `<span class="tag">${escapeHtml(group.name)}</span>`).join('')
              : '<p class="empty-state">当前没有模型组使用这个 provider。</p>'}
          </div>
        ` : '<p class="empty-state">选择左侧 provider 查看详情。</p>'}
      </article>
    </div>
  `;
}

function renderRouting() {
  const group = state.routing.detail;
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
          ${state.routing.groups.map(item => `
            <button class="list-row ${item.id === state.routing.activeGroupId ? 'selected' : ''}" 
                    data-action="select-group" data-id="${item.id}">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.capability_level)} · ${escapeHtml(item.fallback_policy)}</span>
              <span>${pill(item.enabled ? '启用' : '停用', item.enabled ? 'ok' : 'bad')}</span>
            </button>
          `).join('')}
        </div>
      </article>
      
      <article class="panel-card">
        ${group ? `
          <div class="card-header">
            <div>
              <h3>${escapeHtml(group.name)}</h3>
              <p class="muted">${escapeHtml(group.capability_level)} · ${escapeHtml(group.fallback_policy)}</p>
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
              ? group.aliases.map(alias => `
                <div class="detail-card">
                  <div class="card-header">
                    <strong>${escapeHtml(alias.name)}</strong>
                    <div class="row-actions">
                      ${pill(alias.enabled ? '启用' : '停用', alias.enabled ? 'ok' : 'bad')}
                      <button data-action="open-modal" data-modal="edit-alias" data-id="${alias.id}">编辑</button>
                    </div>
                  </div>
                </div>
              `).join('')
              : '<p class="empty-state">当前没有外部别名，客户端会直接使用模型组名。</p>'}
          </div>
          
          <div class="subsection">
            <h4>候选路由</h4>
            ${group.routes.length
              ? group.routes.map(route => `
                <div class="detail-card">
                  <div class="card-header">
                    <div>
                      <strong>#${route.route_order} ${escapeHtml(route.provider_name)} / ${escapeHtml(route.provider_model_name)}</strong>
                      <p class="muted">${escapeHtml(route.provider_key_label)}</p>
                    </div>
                    <div class="row-actions">
                      ${pill(route.health_status, healthTone(route.health_status))}
                      ${pill(route.enabled ? '启用' : '停用', route.enabled ? 'ok' : 'bad')}
                      ${group.forced_route_id === route.id ? pill('主路由', 'accent') : ''}
                    </div>
                  </div>
                  <p class="muted">日 ${route.daily_used}/${route.daily_limit || '∞'} · 月 ${route.monthly_used}/${route.monthly_limit || '∞'} · 阈值 ${route.warning_threshold}%</p>
                  <div class="row-actions">
                    <button data-action="force-route" data-group-id="${group.id}" data-route-id="${route.id}">设为主路由</button>
                    <button data-action="open-modal" data-modal="edit-route" data-id="${route.id}">编辑</button>
                    <button data-action="delete-route" data-id="${route.id}">删除</button>
                  </div>
                </div>
              `).join('')
              : '<p class="empty-state">当前模型组还没有候选路由。</p>'}
          </div>
        ` : '<p class="empty-state">选择左侧模型组查看详情。</p>'}
      </article>
    </div>
  `;
}

function renderQuotas() {
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
        <option value="warning" ${state.quotas.filters.status === 'warning' ? 'selected' : ''}>接近阈值</option>
        <option value="exhausted" ${state.quotas.filters.status === 'exhausted' ? 'selected' : ''}>已耗尽</option>
        <option value="normal" ${state.quotas.filters.status === 'normal' ? 'selected' : ''}>正常</option>
      </select>
      <select name="groupId">
        <option value="">全部模型组</option>
        ${state.quotas.groups.map(group => `<option value="${group.id}" ${String(state.quotas.filters.groupId) === String(group.id) ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}
      </select>
      <select name="providerId">
        <option value="">全部 Provider</option>
        ${state.quotas.providers.map(provider => `<option value="${provider.id}" ${String(state.quotas.filters.providerId) === String(provider.id) ? 'selected' : ''}>${escapeHtml(provider.name)}</option>`).join('')}
      </select>
      <button type="submit">应用筛选</button>
    </form>
    
    <article class="panel-card">
      <table class="data-table">
        <thead><tr><th>模型组</th><th>目标</th><th>额度</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${state.quotas.items.map(item => `
            <tr>
              <td>${escapeHtml(item.group_name)}</td>
              <td>${escapeHtml(item.provider_name)} / ${escapeHtml(item.provider_model_name)}<br /><span class="muted">${escapeHtml(item.provider_key_label)}</span></td>
              <td>日 ${item.daily_used}/${item.daily_limit || '∞'}<br />月 ${item.monthly_used}/${item.monthly_limit || '∞'}<br />阈值 ${item.warning_threshold}%</td>
              <td>${pill(item.quota_exhausted ? '已耗尽' : item.warning_reached ? '接近阈值' : '正常', quotaTone(item))}</td>
              <td>
                <div class="row-actions">
                  <button data-action="open-modal" data-modal="edit-quota" data-id="${item.id}">编辑</button>
                  <button data-action="reset-quota" data-id="${item.id}">重置</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </article>
  `;
}

function renderLogs() {
  return `
    <div class="page-toolbar">
      <div>
        <h3>日志观察</h3>
        <p class="muted">把错误、切换和尝试次数集中观察，而不是被动翻表格。</p>
      </div>
      <div class="row-actions">
        <button class="${state.logsTab === 'requests' ? 'tab-button active' : 'tab-button'}" 
                data-action="switch-logs-tab" data-tab="requests">请求日志</button>
        <button class="${state.logsTab === 'switches' ? 'tab-button active' : 'tab-button'}" 
                data-action="switch-logs-tab" data-tab="switches">切换日志</button>
      </div>
    </div>
    
    ${state.logsTab === 'requests' ? renderRequestLogs() : renderSwitchLogs()}
  `;
}

function renderRequestLogs() {
  const data = state.logs.requests;
  return `
    <form id="requestLogFilters" class="filter-row">
      <select name="model">
        <option value="">全部模型</option>
        ${data.models.map(item => `<option value="${item}" ${data.filters.model === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
      </select>
      <select name="provider">
        <option value="">全部 Provider</option>
        ${data.providers.map(item => `<option value="${item}" ${data.filters.provider === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
      </select>
      <select name="status">
        <option value="">全部状态</option>
        <option value="success" ${data.filters.status === 'success' ? 'selected' : ''}>成功</option>
        <option value="error" ${data.filters.status === 'error' ? 'selected' : ''}>错误</option>
      </select>
      <button type="submit">应用筛选</button>
    </form>
    <article class="panel-card">
      <table class="data-table">
        <thead><tr><th>模型</th><th>实际路由</th><th>状态</th><th>错误详情</th><th>尝试</th><th>时间</th></tr></thead>
        <tbody>
          ${data.items.map(item => `
            <tr>
              <td>${escapeHtml(item.requested_model)}</td>
              <td>${escapeHtml(item.routed_provider || '-')} / ${escapeHtml(item.routed_model || '-')}</td>
              <td>${item.status_code || '-'} ${item.error_code ? `<span class="muted">(${escapeHtml(item.error_code)})</span>` : ''}</td>
              <td class="log-detail">${escapeHtml(item.error_detail || '-')}</td>
              <td>${item.attempts}</td>
              <td>${formatTime(item.created_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </article>
  `;
}

function renderSwitchLogs() {
  const data = state.logs.switches;
  return `
    <form id="switchLogFilters" class="filter-row">
      <select name="model">
        <option value="">全部模型</option>
        ${data.models.map(item => `<option value="${item}" ${data.filters.model === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
      </select>
      <select name="reason">
        <option value="">全部原因</option>
        ${data.reasons.map(item => `<option value="${item}" ${data.filters.reason === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
      </select>
      <button type="submit">应用筛选</button>
    </form>
    <article class="panel-card">
      <table class="data-table">
        <thead><tr><th>模型</th><th>从</th><th>到</th><th>原因</th><th>时间</th></tr></thead>
        <tbody>
          ${data.items.map(item => `
            <tr>
              <td>${escapeHtml(item.requested_model)}</td>
              <td>${escapeHtml(item.from_target)}</td>
              <td>${escapeHtml(item.to_target)}</td>
              <td>${escapeHtml(item.reason)}</td>
              <td>${formatTime(item.created_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </article>
  `;
}

function renderSystem() {
  if (!state.system) return '<p class="empty-state">暂无数据</p>';
  const data = state.system;
  
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
        <pre class="snippet">Base URL: ${escapeHtml(data.gateway.baseURL)}
API Key 已配置: ${data.gatewayApiKeyConfigured ? '是' : '否'}
示例模型: ${escapeHtml(data.gateway.exampleModel)}</pre>
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

function pill(text, tone = 'neutral') {
  return `<span class="pill ${tone}">${escapeHtml(text)}</span>`;
}

function healthTone(status) {
  if (status === 'healthy') return 'ok';
  if (status === 'degraded') return 'warn';
  return 'bad';
}

function quotaTone(item) {
  if (item.quota_exhausted) return 'bad';
  if (item.warning_reached) return 'warn';
  return 'ok';
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
    if (route) return route;
  }
  return null;
}

function findKey(keyId) {
  for (const provider of state.providers.providers) {
    const key = provider.keys.find((item) => item.id === keyId);
    if (key) return key;
  }
  return null;
}

function setupEventListeners() {
  document.body.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const { action } = target.dataset;
    try {
      if (action === 'switch-view') {
        await router.navigate(target.dataset.view);
        return;
      }

      if (action === 'refresh-view') {
        await refreshCurrentView();
        return;
      }

      if (action === 'select-provider') {
        await loadProviderDetail(Number(target.dataset.id));
        return;
      }

      if (action === 'select-group') {
        await loadRoutingDetail(Number(target.dataset.id));
        return;
      }

      if (action === 'switch-logs-tab') {
        state.logsTab = target.dataset.tab;
        if (state.logsTab === 'requests') await loadRequestLogs();
        else await loadSwitchLogs();
        renderApp();
        return;
      }

      if (action === 'logout') {
        await api('/admin/auth/logout', { method: 'POST' });
        showAuth('login');
        return;
      }

      if (action === 'test-provider') {
        const result = await api(`/admin/api/providers/${target.dataset.id}/test`, { method: 'POST' });
        status.show(result.ok ? 'Provider 连接正常' : result.error, result.ok ? 'info' : 'error');
        return;
      }

      if (action === 'force-route') {
        await api(`/admin/api/model-groups/${target.dataset.groupId}`, {
          method: 'PATCH',
          body: jsonBody({ forcedRouteId: Number(target.dataset.routeId) }),
        });
        await loadRouting();
        status.show('已更新主路由');
        return;
      }

      if (action === 'delete-route') {
        if (!window.confirm('确认删除这条路由？')) return;
        await api(`/admin/api/model-routes/${target.dataset.id}`, { method: 'DELETE' });
        await Promise.all([loadRouting(), loadQuotas()]);
        status.show('路由已删除');
        return;
      }

      if (action === 'reset-quota') {
        if (!window.confirm('确认重置这条路由的额度计数？')) return;
        await api(`/admin/api/quotas/${target.dataset.id}/reset`, { method: 'POST', body: jsonBody({ period: 'all' }) });
        await Promise.all([loadQuotas(), loadRouting()]);
        status.show('额度已重置');
        return;
      }

      if (action === 'retry-load') {
        await refreshCurrentView();
        return;
      }

      if (action === 'open-modal') {
        const type = target.dataset.modal;
        if (type === 'create-provider') modal.open(modal.createProviderForm());
        if (type === 'edit-provider') modal.open(modal.createProviderForm(state.providers.detail));
        if (type === 'create-key') modal.open(modal.createKeyForm({}, Number(target.dataset.providerId || state.providers.activeProviderId)));
        if (type === 'edit-key') modal.open(modal.createKeyForm(findKey(Number(target.dataset.id)), Number(target.dataset.providerId)));
        if (type === 'create-group') modal.open(modal.createGroupForm());
        if (type === 'edit-group') modal.open(modal.createGroupForm(findGroup(Number(target.dataset.id))));
        if (type === 'create-alias') modal.open(modal.createAliasForm({}, state.routing.groups));
        if (type === 'edit-alias') modal.open(modal.createAliasForm(findAlias(Number(target.dataset.id)), state.routing.groups));
        if (type === 'create-route') modal.open(modal.createRouteForm({}, state.routing.groups, state.routing.providerKeyOptions));
        if (type === 'edit-route') modal.open(modal.createRouteForm(findRoute(Number(target.dataset.id)), state.routing.groups, state.routing.providerKeyOptions));
        if (type === 'edit-quota') modal.open(modal.createQuotaForm(state.quotas.items.find((item) => item.id === Number(target.dataset.id))));
      }
    } catch (error) {
      status.show(error.message, 'error');
    }
  });

  document.body.addEventListener('submit', async (event) => {
    const form = event.target;
    try {
      if (form.id === 'quotaFilters') {
        event.preventDefault();
        state.quotas.filters = {
          status: form.elements.status.value,
          groupId: form.elements.groupId.value,
          providerId: form.elements.providerId.value,
        };
        await loadQuotas();
        return;
      }

      if (form.id === 'requestLogFilters') {
        event.preventDefault();
        state.logs.requests.filters = {
          model: form.elements.model.value,
          provider: form.elements.provider.value,
          status: form.elements.status.value,
        };
        await loadRequestLogs();
        return;
      }

      if (form.id === 'switchLogFilters') {
        event.preventDefault();
        state.logs.switches.filters = {
          model: form.elements.model.value,
          reason: form.elements.reason.value,
        };
        await loadSwitchLogs();
        return;
      }

      if (form.id === 'systemForm') {
        event.preventDefault();
        await api('/admin/api/system', {
          method: 'PATCH',
          body: jsonBody({ gatewayApiKey: form.elements.gatewayApiKey.value }),
        });
        await loadSystem();
        form.reset();
        status.show('Gateway 设置已更新');
        return;
      }

      if (form.id === 'passwordForm') {
        event.preventDefault();
        await api('/admin/api/system/password', {
          method: 'POST',
          body: jsonBody({
            currentPassword: form.elements.currentPassword.value,
            newPassword: form.elements.newPassword.value,
          }),
        });
        form.reset();
        status.show('管理员密码已更新');
        return;
      }

      if (!modal.isOpen()) return;

      event.preventDefault();
      const submitType = form.dataset.form;

      if (submitType === 'create-provider') {
        await api('/admin/api/providers', {
          method: 'POST',
          body: jsonBody({
            name: form.elements.name.value,
            baseUrl: form.elements.baseUrl.value,
            timeoutMs: numberValue(form, 'timeoutMs'),
            requestsPerMinute: numberValue(form, 'requestsPerMinute'),
            priority: numberValue(form, 'priority'),
            enabled: boolValue(form, 'enabled'),
            keys: form.elements.keyLabel.value ? [{ label: form.elements.keyLabel.value, apiKey: form.elements.apiKey.value, enabled: true }] : [],
          }),
        });
        await loadProviders();
      }

      if (submitType === 'edit-provider') {
        await api(`/admin/api/providers/${form.querySelector('[data-submit]').dataset.id}`, {
          method: 'PATCH',
          body: jsonBody({
            name: form.elements.name.value,
            baseUrl: form.elements.baseUrl.value,
            timeoutMs: numberValue(form, 'timeoutMs'),
            requestsPerMinute: numberValue(form, 'requestsPerMinute'),
            priority: numberValue(form, 'priority'),
            enabled: boolValue(form, 'enabled'),
          }),
        });
        await loadProviders();
      }

      if (submitType === 'create-key') {
        await api('/admin/api/provider-keys', {
          method: 'POST',
          body: jsonBody({
            providerId: Number(form.elements.providerId.value),
            label: form.elements.label.value,
            apiKey: form.elements.apiKey.value,
            enabled: boolValue(form, 'enabled'),
          }),
        });
        await loadProviders();
      }

      if (submitType === 'edit-key') {
        await api(`/admin/api/provider-keys/${form.querySelector('[data-submit]').dataset.id}`, {
          method: 'PATCH',
          body: jsonBody({
            label: form.elements.label.value,
            apiKey: form.elements.apiKey.value || undefined,
            enabled: boolValue(form, 'enabled'),
          }),
        });
        await loadProviders();
      }

      if (submitType === 'create-group') {
        await api('/admin/api/model-groups', {
          method: 'POST',
          body: jsonBody({
            name: form.elements.name.value,
            capabilityLevel: form.elements.capabilityLevel.value,
            fallbackPolicy: form.elements.fallbackPolicy.value,
            enabled: boolValue(form, 'enabled'),
          }),
        });
        await loadRouting();
      }

      if (submitType === 'edit-group') {
        await api(`/admin/api/model-groups/${form.querySelector('[data-submit]').dataset.id}`, {
          method: 'PATCH',
          body: jsonBody({
            name: form.elements.name.value,
            capabilityLevel: form.elements.capabilityLevel.value,
            fallbackPolicy: form.elements.fallbackPolicy.value,
            enabled: boolValue(form, 'enabled'),
          }),
        });
        await loadRouting();
      }

      if (submitType === 'create-alias') {
        await api('/admin/api/model-aliases', {
          method: 'POST',
          body: jsonBody({
            name: form.elements.name.value,
            groupId: Number(form.elements.groupId.value),
            enabled: boolValue(form, 'enabled'),
          }),
        });
        await loadRouting();
      }

      if (submitType === 'edit-alias') {
        await api(`/admin/api/model-aliases/${form.querySelector('[data-submit]').dataset.id}`, {
          method: 'PATCH',
          body: jsonBody({
            name: form.elements.name.value,
            groupId: Number(form.elements.groupId.value),
            enabled: boolValue(form, 'enabled'),
          }),
        });
        await loadRouting();
      }

      if (submitType === 'create-route') {
        await api('/admin/api/model-routes', {
          method: 'POST',
          body: jsonBody({
            groupId: Number(form.elements.groupId.value),
            providerKeyId: Number(form.elements.providerKeyId.value),
            providerModelName: form.elements.providerModelName.value,
            order: numberValue(form, 'order'),
            dailyLimit: numberValue(form, 'dailyLimit'),
            monthlyLimit: numberValue(form, 'monthlyLimit'),
            warningThreshold: numberValue(form, 'warningThreshold'),
            enabled: boolValue(form, 'enabled'),
          }),
        });
        await Promise.all([loadRouting(), loadQuotas()]);
      }

      if (submitType === 'edit-route') {
        await api(`/admin/api/model-routes/${form.querySelector('[data-submit]').dataset.id}`, {
          method: 'PATCH',
          body: jsonBody({
            groupId: Number(form.elements.groupId.value),
            providerKeyId: Number(form.elements.providerKeyId.value),
            providerModelName: form.elements.providerModelName.value,
            order: numberValue(form, 'order'),
            dailyLimit: numberValue(form, 'dailyLimit'),
            monthlyLimit: numberValue(form, 'monthlyLimit'),
            warningThreshold: numberValue(form, 'warningThreshold'),
            enabled: boolValue(form, 'enabled'),
          }),
        });
        await Promise.all([loadRouting(), loadQuotas()]);
      }

      if (submitType === 'edit-quota') {
        await api(`/admin/api/quotas/${form.querySelector('[data-submit]').dataset.id}`, {
          method: 'PATCH',
          body: jsonBody({
            dailyLimit: numberValue(form, 'dailyLimit'),
            monthlyLimit: numberValue(form, 'monthlyLimit'),
            warningThreshold: numberValue(form, 'warningThreshold'),
            enabled: boolValue(form, 'enabled'),
          }),
        });
        await Promise.all([loadQuotas(), loadRouting()]);
      }

      modal.close();
      status.show('配置已更新');
    } catch (error) {
      status.show(error.message, 'error');
    }
  });
}

function startLogRefresh() {
  setInterval(async () => {
    if (appRoot.hidden || router.getCurrentView() !== 'logs') return;
    try {
      if (state.logsTab === 'requests') await loadRequestLogs();
      else await loadSwitchLogs();
    } catch {}
  }, 5000);
}

async function boot() {
  try {
    const authStatus = await api('/admin/auth/status');
    if (authStatus.needsSetup) {
      showAuth('setup');
      return;
    }
    if (!authStatus.authenticated) {
      showAuth('login');
      return;
    }
    
    showApp();
    registerViews();

    router.onChange = async (to) => {
      state.activeView = to;
      renderApp();

      switch (to) {
        case 'overview': await loadOverview(); break;
        case 'providers': await loadProviders(); break;
        case 'routing': await loadRouting(); break;
        case 'quotas': await loadQuotas(); break;
        case 'logs':
          if (state.logsTab === 'requests') await loadRequestLogs();
          else await loadSwitchLogs();
          break;
        case 'system': await loadSystem(); break;
      }
    };

    await Promise.all([loadOverview(), loadProviders(), loadRouting(), loadQuotas(), loadRequestLogs(), loadSwitchLogs(), loadSystem()]);
    renderApp();
    
    setupEventListeners();
    modal.init(modalElement);
    startLogRefresh();
    
    router.init();
  } catch (error) {
    status.show(error.message, 'error');
  }
}

document.getElementById('setupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api('/admin/auth/bootstrap', {
      method: 'POST',
      body: jsonBody({
        password: form.elements.password.value,
        gatewayApiKey: form.elements.gatewayApiKey.value,
      }),
    });
    showApp();
    registerViews();
    await Promise.all([loadOverview(), loadProviders(), loadRouting(), loadQuotas(), loadRequestLogs(), loadSwitchLogs(), loadSystem()]);
    renderApp();
    setupEventListeners();
    modal.init(modalElement);
    startLogRefresh();
    router.init();
    status.show('初始化完成');
  } catch (error) {
    status.show(error.message, 'error');
  }
});

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api('/admin/auth/login', {
      method: 'POST',
      body: jsonBody({ password: form.elements.password.value }),
    });
    showApp();
    registerViews();
    await Promise.all([loadOverview(), loadProviders(), loadRouting(), loadQuotas(), loadRequestLogs(), loadSwitchLogs(), loadSystem()]);
    renderApp();
    setupEventListeners();
    modal.init(modalElement);
    startLogRefresh();
    router.init();
    status.show('登录成功');
  } catch (error) {
    status.show(error.message, 'error');
  }
});

boot();