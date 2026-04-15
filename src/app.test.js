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

function requestJson(server, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = Readable.from([Buffer.from(payload)]);
    req.method = 'POST';
    req.url = '/v1/chat/completions';
    req.headers = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
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
