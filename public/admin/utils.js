export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(value) {
  return value ? new Date(value).toLocaleString() : '-';
}

export function debounce(fn, delay) {
  let timeoutId = null;
  return function (...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function throttle(fn, limit) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

export function pill(text, tone = 'neutral') {
  return `<span class="pill ${tone}">${escapeHtml(text)}</span>`;
}

export function healthTone(status) {
  if (status === 'healthy') return 'ok';
  if (status === 'degraded') return 'warn';
  return 'bad';
}

export function quotaTone(item) {
  if (item.quota_exhausted) return 'bad';
  if (item.warning_reached) return 'warn';
  return 'ok';
}

export function healthReasonLabel(reason) {
  switch (reason) {
    case 'authentication-failed': return '密钥无效';
    case 'forbidden': return '无权限';
    case 'rate-limited': return '请求频率限制';
    case 'timeout': return '请求超时';
    case 'server-error': return '服务器故障';
    case 'network-error': return '无法连接';
    case 'unknown-error': return '未知故障';
    default: return reason || '';
  }
}