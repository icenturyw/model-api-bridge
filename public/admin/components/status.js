export function createStatus() {
  let container = null;
  let timeout = null;

  function init(element) {
    container = element;
  }

  function show(message, tone = 'info', duration = 3000) {
    if (!container) return;
    
    if (timeout) clearTimeout(timeout);
    
    container.textContent = message;
    container.className = `status-chip ${tone}`;
    
    if (duration > 0) {
      timeout = setTimeout(() => {
        container.textContent = '准备就绪';
        container.className = 'status-chip';
      }, duration);
    }
  }

  function clear() {
    if (!container) return;
    if (timeout) clearTimeout(timeout);
    container.textContent = '准备就绪';
    container.className = 'status-chip';
  }

  return { init, show, clear };
}

export const status = createStatus();