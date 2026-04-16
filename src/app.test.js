const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createApp } = require('./app');

function createTempDbPath() {
  return path.join(os.tmpdir(), `openclaw-app-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

function request(server, { method = 'GET', url = '/', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const req = Readable.from(payload ? [Buffer.from(payload)] : []);
    req.method = method;
    req.url = url;
    req.headers = {
      ...(payload ? {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      } : {}),
      ...headers,
    };

    const res = {
      statusCode: 200,
      headers: {},
      body: '',
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = Object.fromEntries(
          Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
        );
      },
      end(chunk = '') {
        this.body += chunk;
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: this.body,
        });
      },
      on() {},
      once() {},
      emit() {},
    };

    try {
      server.emit('request', req, res);
    } catch (error) {
      reject(error);
    }
  });
}

function requestJson(server, body) {
  return request(server, {
    method: 'POST',
    url: '/v1/chat/completions',
    body,
  });
}

test('deletes a route after upstream 404 and falls through to the next route', async () => {
  const dbPath = createTempDbPath();
  const app = createApp({
    host: '127.0.0.1',
    port: 0,
    dbPath,
    disableHealthMonitor: true,
  });

  const provider = app.store.createProvider({
    name: 'volcengine',
    baseUrl: 'https://router.test/v1',
    keys: [{ label: 'primary', apiKey: 've-key' }],
  });
  const group = app.store.createModelGroup({ name: 'chat-main' });
  const missingRoute = app.store.addModelRoute(group.id, {
    providerKeyId: provider.keys[0].id,
    providerModelName: 'missing-model',
    order: 10,
  });
  const backupRoute = app.store.addModelRoute(group.id, {
    providerKeyId: provider.keys[0].id,
    providerModelName: 'working-model',
    order: 20,
  });

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const parsed = JSON.parse(options.body);
    if (url === 'https://router.test/v1/chat/completions' && parsed.model === 'missing-model') {
      return new Response(
        JSON.stringify({
          error: {
            code: 'InvalidEndpointOrModel.NotFound',
            message: 'missing',
          },
        }),
        {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }
      );
    }

    if (url === 'https://router.test/v1/chat/completions' && parsed.model === 'working-model') {
      return new Response(
        JSON.stringify({
          id: 'ok',
          object: 'chat.completion',
          model: 'working-model',
          choices: [],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await requestJson(app.server, {
      model: 'chat-main',
      messages: [{ role: 'user', content: 'hello' }],
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-route-model'], 'working-model');
    assert.equal(response.headers['x-route-switched'], 'true');

    const plan = app.store.getRoutingPlan('chat-main');
    assert.equal(plan.routes.length, 1);
    assert.equal(plan.routes[0].id, backupRoute.id);
    assert.equal(plan.routes[0].provider_model_name, 'working-model');
    assert.equal(plan.routes.some((route) => route.id === missingRoute.id), false);

    const switches = app.store.listSwitchEvents(1);
    assert.equal(switches[0].reason, 'status-404-route-deleted');

    const logs = app.store.listRequestLogs(1);
    assert.equal(logs[0].status_code, 200);
    assert.equal(logs[0].routed_model, 'working-model');
    assert.equal(logs[0].switch_reason, 'status-404-route-deleted');
  } finally {
    global.fetch = originalFetch;
    app.store.close();
    fs.rmSync(dbPath, { force: true });
  }
});

test('forwards requests to providers without Authorization when api key is blank', async () => {
  const dbPath = createTempDbPath();
  const app = createApp({
    host: '127.0.0.1',
    port: 0,
    dbPath,
    disableHealthMonitor: true,
  });

  const provider = app.store.createProvider({
    name: 'lm-studio',
    baseUrl: 'http://lm-studio.test/v1',
    keys: [{ label: 'local', apiKey: '' }],
  });
  const group = app.store.createModelGroup({ name: 'chat-main' });
  app.store.addModelRoute(group.id, {
    providerKeyId: provider.keys[0].id,
    providerModelName: 'local-model',
    order: 10,
  });

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, 'http://lm-studio.test/v1/chat/completions');
    assert.equal(options.headers.Authorization, undefined);

    return new Response(
      JSON.stringify({
        id: 'ok',
        object: 'chat.completion',
        model: 'local-model',
        choices: [],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  };

  try {
    const response = await requestJson(app.server, {
      model: 'chat-main',
      messages: [{ role: 'user', content: 'hello' }],
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-route-provider'], 'lm-studio');
    assert.equal(response.headers['x-route-model'], 'local-model');
  } finally {
    global.fetch = originalFetch;
    app.store.close();
    fs.rmSync(dbPath, { force: true });
  }
});

test('serves the admin SPA index and static assets', async () => {
  const dbPath = createTempDbPath();
  const app = createApp({
    host: '127.0.0.1',
    port: 0,
    dbPath,
    disableHealthMonitor: true,
  });

  try {
    const bootstrapResponse = await request(app.server, {
      method: 'POST',
      url: '/admin/auth/bootstrap',
      body: { password: 'secret-pass' },
    });
    const cookie = bootstrapResponse.headers['set-cookie'];
    const indexResponse = await request(app.server, { url: '/admin' });
    const assetResponse = await request(app.server, { url: '/admin/main.js' });
    const nestedRouteResponse = await request(app.server, {
      url: '/admin/providers/volcengine',
      headers: { cookie },
    });

    assert.equal(indexResponse.statusCode, 200);
    assert.match(indexResponse.body, /<div id="appRoot" hidden><\/div>/);
    assert.equal(indexResponse.headers['cache-control'], 'no-cache');

    assert.equal(assetResponse.statusCode, 200);
    assert.equal(assetResponse.headers['content-type'], 'application/javascript; charset=utf-8');

    assert.equal(nestedRouteResponse.statusCode, 200);
    assert.match(nestedRouteResponse.body, /<script type="module" src="\/admin\/main.js"><\/script>/);
  } finally {
    app.store.close();
    fs.rmSync(dbPath, { force: true });
  }
});

test('returns aggregated admin data from the new overview and logs APIs', async () => {
  const dbPath = createTempDbPath();
  const app = createApp({
    host: '127.0.0.1',
    port: 0,
    dbPath,
    disableHealthMonitor: true,
  });

  const password = 'secret-pass';
  const bootstrapResponse = await request(app.server, {
    method: 'POST',
    url: '/admin/auth/bootstrap',
    body: { password },
  });
  const cookie = bootstrapResponse.headers['set-cookie'];

  const provider = app.store.createProvider({
    name: 'modelscope',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    keys: [{ label: 'primary', apiKey: 'ms-key' }],
  });
  const group = app.store.createModelGroup({ name: 'chat-main' });
  app.store.addModelRoute(group.id, {
    providerKeyId: provider.keys[0].id,
    providerModelName: 'Qwen/Qwen3.5-27B',
  });
  app.store.recordRequestLog({
    requestedModel: 'chat-main',
    routedProvider: 'modelscope',
    routedModel: 'Qwen/Qwen3.5-27B',
    statusCode: 503,
    errorCode: 'network-error',
    attempts: 2,
  });
  app.store.recordSwitch({
    requestedModel: 'chat-main',
    fromTarget: 'modelscope/a',
    toTarget: 'modelscope/b',
    reason: 'status-503',
  });

  try {
    const overviewResponse = await request(app.server, {
      url: '/admin/api/overview',
      headers: { cookie },
    });
    const logsResponse = await request(app.server, {
      url: '/admin/api/logs/requests?status=error&model=chat-main',
      headers: { cookie },
    });

    assert.equal(overviewResponse.statusCode, 200);
    const overviewPayload = JSON.parse(overviewResponse.body);
    assert.equal(overviewPayload.data.totals.providers, 1);
    assert.equal(overviewPayload.data.recentErrors[0].error_code, 'network-error');

    assert.equal(logsResponse.statusCode, 200);
    const logsPayload = JSON.parse(logsResponse.body);
    assert.equal(logsPayload.data.items.length, 1);
    assert.equal(logsPayload.data.items[0].requested_model, 'chat-main');
    assert.deepEqual(logsPayload.data.models, ['chat-main']);
  } finally {
    app.store.close();
    fs.rmSync(dbPath, { force: true });
  }
});

test('falls through when the primary provider hits its per-minute request limit', async () => {
  const dbPath = createTempDbPath();
  const app = createApp({
    host: '127.0.0.1',
    port: 0,
    dbPath,
    disableHealthMonitor: true,
  });

  const limitedProvider = app.store.createProvider({
    name: 'limited-provider',
    baseUrl: 'https://limited.test/v1',
    requestsPerMinute: 1,
    keys: [{ label: 'primary', apiKey: 'limited-key' }],
  });
  const backupProvider = app.store.createProvider({
    name: 'backup-provider',
    baseUrl: 'https://backup.test/v1',
    keys: [{ label: 'backup', apiKey: 'backup-key' }],
  });
  const group = app.store.createModelGroup({ name: 'chat-main' });
  app.store.addModelRoute(group.id, {
    providerKeyId: limitedProvider.keys[0].id,
    providerModelName: 'limited-model',
    order: 10,
  });
  app.store.addModelRoute(group.id, {
    providerKeyId: backupProvider.keys[0].id,
    providerModelName: 'backup-model',
    order: 20,
  });

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const parsed = JSON.parse(options.body);
    if (url === 'https://limited.test/v1/chat/completions' && parsed.model === 'limited-model') {
      return new Response(JSON.stringify({ id: 'limited', choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === 'https://backup.test/v1/chat/completions' && parsed.model === 'backup-model') {
      return new Response(JSON.stringify({ id: 'backup', choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const firstResponse = await requestJson(app.server, {
      model: 'chat-main',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const secondResponse = await requestJson(app.server, {
      model: 'chat-main',
      messages: [{ role: 'user', content: 'hello again' }],
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(firstResponse.headers['x-route-provider'], 'limited-provider');
    assert.equal(secondResponse.statusCode, 200);
    assert.equal(secondResponse.headers['x-route-provider'], 'backup-provider');
    assert.equal(secondResponse.headers['x-route-switched'], 'true');

    const switches = app.store.listSwitchEvents({ limit: 5 });
    assert.equal(switches[0].reason, 'provider-rate-limited');
  } finally {
    global.fetch = originalFetch;
    app.store.close();
    fs.rmSync(dbPath, { force: true });
  }
});
