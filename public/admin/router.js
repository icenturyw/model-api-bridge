export class Router {
  constructor() {
    this.routes = new Map();
    this.currentView = null;
    this.beforeNavigate = null;
    this.onChange = null;

    window.addEventListener('hashchange', () => this.handleRoute());
  }

  register(id, handler) {
    this.routes.set(id, handler);
    return this;
  }

  async navigate(viewId) {
    if (this.currentView === viewId) return;

    if (this.beforeNavigate) {
      const shouldContinue = await this.beforeNavigate(this.currentView, viewId);
      if (!shouldContinue) return;
    }

    window.location.hash = viewId;
  }

  async handleRoute() {
    const hash = window.location.hash.slice(1) || 'overview';
    const viewId = this.routes.has(hash) ? hash : 'overview';

    if (this.currentView && this.routes.has(this.currentView)) {
      const handler = this.routes.get(this.currentView);
      if (handler.cleanup) await handler.cleanup();
    }

    this.currentView = viewId;

    if (this.onChange) {
      await this.onChange(viewId);
    }

    if (this.routes.has(viewId)) {
      const handler = this.routes.get(viewId);
      if (handler.activate) await handler.activate();
    }
  }

  getCurrentView() {
    return this.currentView;
  }

  init() {
    this.handleRoute();
  }
}

export const router = new Router();