import { escapeHtml } from '../utils.js';

export function createTable() {
  function renderLoading(columns) {
    return `
      <tbody>
        <tr>
          <td colspan="${columns}" class="loading-cell">
            <div class="loading-spinner"></div>
            <span>加载中...</span>
          </td>
        </tr>
      </tbody>
    `;
  }

  function renderEmpty(columns, message = '暂无数据') {
    return `
      <tbody>
        <tr>
          <td colspan="${columns}" class="empty-cell">${escapeHtml(message)}</td>
        </tr>
      </tbody>
    `;
  }

  function renderPagination(currentPage, totalPages, onPageChange) {
    if (totalPages <= 1) return '';
    
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(`
        <button class="page-button ${i === currentPage ? 'active' : ''}" 
                data-page="${i}" 
                ${i === currentPage ? 'disabled' : ''}>
          ${i}
        </button>
      `);
    }

    return `
      <div class="pagination">
        <button class="page-button" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>
        ${pages.join('')}
        <button class="page-button" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>
      </div>
    `;
  }

  function renderSortHeader(label, field, currentSort, currentOrder) {
    const isActive = currentSort === field;
    const newOrder = isActive && currentOrder === 'asc' ? 'desc' : 'asc';
    const arrow = isActive ? (currentOrder === 'asc' ? '↑' : '↓') : '';
    
    return `
      <th class="sortable ${isActive ? 'active' : ''}" data-sort="${field}" data-order="${newOrder}">
        ${escapeHtml(label)} ${arrow}
      </th>
    `;
  }

  function renderFilterRow(filters, options) {
    return `
      <div class="filter-row">
        ${filters.map(filter => {
          if (filter.type === 'select') {
            const optionsHtml = filter.options.map(opt => 
              `<option value="${opt.value}" ${opt.value === filter.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`
            ).join('');
            return `
              <select name="${filter.name}" data-filter="${filter.name}">
                <option value="">${escapeHtml(filter.placeholder || '全部')}</option>
                ${optionsHtml}
              </select>
            `;
          }
          if (filter.type === 'text') {
            return `
              <input type="text" name="${filter.name}" placeholder="${escapeHtml(filter.placeholder || '')}" 
                     value="${escapeHtml(filter.value || '')}" data-filter="${filter.name}" />
            `;
          }
          return '';
        }).join('')}
        <button type="button" class="filter-apply" data-action="apply-filters">应用筛选</button>
        <button type="button" class="filter-reset ghost-button" data-action="reset-filters">重置</button>
      </div>
    `;
  }

  return {
    renderLoading,
    renderEmpty,
    renderPagination,
    renderSortHeader,
    renderFilterRow
  };
}

export const table = createTable();