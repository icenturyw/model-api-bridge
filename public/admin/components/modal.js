import { escapeHtml, healthReasonLabel } from '../utils.js';

export function createModal() {
  let modalElement = null;
  let onSubmitCallback = null;

  function init(element) {
    modalElement = element;
    modalElement.addEventListener('close', () => {
      modalElement.innerHTML = '';
    });
  }

  function open(content) {
    if (!modalElement) return;
    modalElement.innerHTML = content;
    modalElement.showModal();
  }

  function close() {
    if (!modalElement) return;
    modalElement.close();
    modalElement.innerHTML = '';
  }

  function isOpen() {
    return modalElement?.open || false;
  }

  function onSubmit(callback) {
    onSubmitCallback = callback;
  }

  function getForm() {
    return modalElement?.querySelector('form');
  }

  function createProviderForm(provider = {}) {
    const isEdit = !!provider.id;
    return `
      <form method="dialog" class="modal-shell" data-form="${isEdit ? 'edit-provider' : 'create-provider'}">
        <div class="card-header">
          <h3>${isEdit ? '编辑 Provider' : '新增 Provider'}</h3>
          <button class="ghost-button" value="cancel">关闭</button>
        </div>
        <label>名称<input name="name" value="${escapeHtml(provider.name || '')}" required /></label>
        <label>Base URL<input name="baseUrl" value="${escapeHtml(provider.base_url || '')}" required /></label>
        <label>超时(ms)<input name="timeoutMs" type="number" value="${provider.timeout_ms || 25000}" /></label>
        <label>每分钟请求频率<input name="requestsPerMinute" type="number" min="0" value="${provider.requests_per_minute || 0}" placeholder="0 表示不限制" /></label>
        <label>优先级<input name="priority" type="number" value="${provider.priority || 100}" /></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${provider.enabled === 0 ? '' : 'checked'} /> 启用</label>
        ${!isEdit ? `
          <label>首个 Key 标签<input name="keyLabel" value="primary" /></label>
          <label>首个 API Key<input name="apiKey" /></label>
        ` : ''}
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="${isEdit ? 'edit-provider' : 'create-provider'}" data-id="${provider.id || ''}">保存</button>
        </menu>
      </form>
    `;
  }

  function createKeyForm(key = {}, providerId) {
    const isEdit = !!key.id;
    return `
      <form method="dialog" class="modal-shell" data-form="${isEdit ? 'edit-key' : 'create-key'}">
        <div class="card-header">
          <h3>${isEdit ? '编辑 API Key' : '新增 API Key'}</h3>
          <button class="ghost-button" value="cancel">关闭</button>
        </div>
        <input type="hidden" name="providerId" value="${providerId}" />
        <label>标签<input name="label" value="${escapeHtml(key.label || '')}" required /></label>
        <label>API Key<input name="apiKey" placeholder="${isEdit ? '留空则不修改' : '留空表示无鉴权 upstream'}" /></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${key.enabled === 0 ? '' : 'checked'} /> 启用</label>
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="${isEdit ? 'edit-key' : 'create-key'}" data-id="${key.id || ''}">保存</button>
        </menu>
      </form>
    `;
  }

  function createGroupForm(group = {}) {
    const isEdit = !!group.id;
    return `
      <form method="dialog" class="modal-shell" data-form="${isEdit ? 'edit-group' : 'create-group'}">
        <div class="card-header">
          <h3>${isEdit ? '编辑模型组' : '新增模型组'}</h3>
          <button class="ghost-button" value="cancel">关闭</button>
        </div>
        <label>逻辑模型名<input name="name" value="${escapeHtml(group.name || '')}" required /></label>
        <label>能力等级<input name="capabilityLevel" value="${escapeHtml(group.capability_level || 'standard')}" /></label>
        <label>Fallback 策略<input name="fallbackPolicy" value="${escapeHtml(group.fallback_policy || 'same-group')}" /></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${group.enabled === 0 ? '' : 'checked'} /> 启用</label>
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="${isEdit ? 'edit-group' : 'create-group'}" data-id="${group.id || ''}">保存</button>
        </menu>
      </form>
    `;
  }

  function createAliasForm(alias = {}, groups = []) {
    const isEdit = !!alias.id;
    const groupOptions = groups.map(g => 
      `<option value="${g.id}" ${String(alias.group_id) === String(g.id) ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
    ).join('');

    return `
      <form method="dialog" class="modal-shell" data-form="${isEdit ? 'edit-alias' : 'create-alias'}">
        <div class="card-header">
          <h3>${isEdit ? '编辑别名' : '新增别名'}</h3>
          <button class="ghost-button" value="cancel">关闭</button>
        </div>
        <label>统一模型名<input name="name" value="${escapeHtml(alias.name || '')}" required /></label>
        <label>指向模型组<select name="groupId">${groupOptions}</select></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${alias.enabled === 0 ? '' : 'checked'} /> 启用</label>
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="${isEdit ? 'edit-alias' : 'create-alias'}" data-id="${alias.id || ''}">保存</button>
        </menu>
      </form>
    `;
  }

  function createRouteForm(route = {}, groups = [], providerKeyOptions = []) {
    const isEdit = !!route.id;
    const groupOptions = groups.map(g => 
      `<option value="${g.id}" ${String(route.group_id) === String(g.id) ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
    ).join('');
    const keyOptions = providerKeyOptions.map(k => 
      `<option value="${k.id}" ${String(route.provider_key_id) === String(k.id) ? 'selected' : ''}>${escapeHtml(k.provider_name)} / ${escapeHtml(k.label)} / ${escapeHtml(k.health_status)}${k.health_reason ? ' (' + healthReasonLabel(k.health_reason) + ')' : ''}</option>`
    ).join('');

    return `
      <form method="dialog" class="modal-shell" data-form="${isEdit ? 'edit-route' : 'create-route'}">
        <div class="card-header">
          <h3>${isEdit ? '编辑路由' : '新增路由'}</h3>
          <button class="ghost-button" value="cancel">关闭</button>
        </div>
        <label>模型组<select name="groupId">${groupOptions}</select></label>
        <label>Provider Key<select name="providerKeyId">${keyOptions}</select></label>
        <label>上游模型名<input name="providerModelName" value="${escapeHtml(route.provider_model_name || '')}" required /></label>
        <label>顺序<input name="order" type="number" value="${route.route_order || 100}" /></label>
        <label>日额度<input name="dailyLimit" type="number" value="${route.daily_limit || 0}" /></label>
        <label>月额度<input name="monthlyLimit" type="number" value="${route.monthly_limit || 0}" /></label>
        <label>告警阈值(%)<input name="warningThreshold" type="number" value="${route.warning_threshold || 80}" /></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${route.enabled === 0 ? '' : 'checked'} /> 启用</label>
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="${isEdit ? 'edit-route' : 'create-route'}" data-id="${route.id || ''}">保存</button>
        </menu>
      </form>
    `;
  }

  function createQuotaForm(route = {}) {
    return `
      <form method="dialog" class="modal-shell" data-form="edit-quota">
        <div class="card-header">
          <h3>编辑额度</h3>
          <button class="ghost-button" value="cancel">关闭</button>
        </div>
        <label>日额度<input name="dailyLimit" type="number" value="${route.daily_limit}" /></label>
        <label>月额度<input name="monthlyLimit" type="number" value="${route.monthly_limit}" /></label>
        <label>告警阈值(%)<input name="warningThreshold" type="number" value="${route.warning_threshold}" /></label>
        <label class="checkbox"><input name="enabled" type="checkbox" ${route.enabled === 0 ? '' : 'checked'} /> 启用</label>
        <menu class="row-actions">
          <button value="cancel" class="ghost-button">取消</button>
          <button type="submit" data-submit="edit-quota" data-id="${route.id}">保存</button>
        </menu>
      </form>
    `;
  }

  return {
    init,
    open,
    close,
    isOpen,
    onSubmit,
    getForm,
    createProviderForm,
    createKeyForm,
    createGroupForm,
    createAliasForm,
    createRouteForm,
    createQuotaForm
  };
}

export const modal = createModal();