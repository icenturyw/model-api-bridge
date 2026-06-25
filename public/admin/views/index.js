import { router } from '../router.js';
import { overviewView } from './overview.js';
import { providersView } from './providers.js';
import { routingView } from './routing.js';
import { quotasView } from './quotas.js';
import { logsView } from './logs.js';
import { systemView } from './system.js';

export const views = {
  overview: overviewView,
  providers: providersView,
  routing: routingView,
  quotas: quotasView,
  logs: logsView,
  system: systemView
};

export function registerViews() {
  Object.entries(views).forEach(([id, view]) => {
    router.register(id, view);
  });
}

export function getViewList() {
  return Object.entries(views).map(([id, view]) => ({
    id,
    title: view.title,
    icon: view.icon
  }));
}