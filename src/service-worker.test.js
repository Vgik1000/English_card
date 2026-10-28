import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';
import { buildServiceWorker } from '../scripts/offline-build.js';

// Execute the emitted worker with Cache/Fetch adapters; no browser or network required.
function environment(files, scope = 'https://example.test/english-trainer/') {
  const stores = new Map();
  const network = { offline: false, missing: null, calls: [] };
  const key = (request) => typeof request === 'string' ? request : request.url;
  const fetch = async (request) => {
    const url = key(request);
    network.calls.push(url);
    if (network.offline) throw new TypeError('Offline');
    const file = url.startsWith(scope) ? url.slice(scope.length) : null;
    if (!files.has(file) || network.missing === file) return new Response('Missing', { status: 404 });
    return new Response(files.get(file));
  };
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(request) { return entries.get(key(request))?.clone(); },
        async put(request, response) { entries.set(key(request), response.clone()); },
        async addAll(requests) {
          const responses = await Promise.all(requests.map(fetch));
          if (responses.some((response) => !response.ok)) throw new TypeError('Precache failed');
          requests.forEach((request, index) => entries.set(key(request), responses[index]));
        },
      };
    },
  };
  function worker(source) {
    const handlers = {};
    let claimed = false;
    const self = {
      location: new URL('sw.js', scope),
      clients: { async claim() { claimed = true; } },
      addEventListener(type, callback) { handlers[type] = callback; },
      skipWaiting() { throw new Error('An update must not interrupt existing tabs'); },
    };
    runInNewContext(source, { self, caches, fetch, URL, Request });
    return {
      async lifecycle(type) {
        let pending;
        handlers[type]({ waitUntil(promise) { pending = promise; } });
        await pending;
      },
      fetch(path, { navigate = false, method = 'GET' } = {}) {
        let response;
        const url = new URL(path, scope).href;
        const request = navigate ? { url, mode: 'navigate', method } : new Request(url, { method });
        handlers.fetch({ request, respondWith(promise) { response = promise; } });
        return response;
      },
      async ready() {
        let pending, result;
        handlers.message({ data: { type: 'CHECK_OFFLINE_READY' }, ports: [{ postMessage(message) { result = message.ready; } }], waitUntil(promise) { pending = promise; } });
        await pending;
        return result;
      },
      get claimed() { return claimed; },
    };
  }
  return { worker, stores, network, scope };
}

test('production offline cache covers lazy Excel, nested paths, failed installs and updates', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'lexika-offline-'));
  try {
    await build({ configFile: resolve('vite.config.js'), base: '/english-trainer/', logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const first = await buildServiceWorker(outDir);
    const source = await readFile(join(outDir, 'sw.js'), 'utf8');
    const files = new Map(await Promise.all(first.files.map(async (file) => [file, await readFile(join(outDir, file))])));
    const excelFiles = first.files.filter((file) => /excel.*\.js$/.test(file));
    assert.ok(excelFiles.length >= 2, 'Both the lazy Excel wrapper and library are cached');
    assert.ok(first.files.some((file) => /xlsx-compat.*\.js$/.test(file)), 'Excel compatibility retry must also work offline');
    assert.ok(first.files.includes('manifest.webmanifest'));
    assert.ok(first.files.includes('icons/icon.svg'));
    assert.match(files.get('index.html').toString(), /\/english-trainer\/assets\//);
    assert.ok(!source.includes('__PRECACHE_FILES__') && !source.includes('__BUILD_ID__'));
    assert.equal((await buildServiceWorker(outDir)).version, first.version, 'Unchanged output has stable version');

    await t.test('first install saves every file before first Excel import, then serves offline', async () => {
      const env = environment(files);
      const sw = env.worker(source);
      await sw.lifecycle('install');
      await sw.lifecycle('activate');
      assert.equal(sw.claimed, true);
      assert.equal(await sw.ready(), true);
      env.network.offline = true;
      env.network.calls = [];
      for (const path of ['', '?from=homescreen', 'index.html', 'nested-route']) {
        assert.equal(await (await sw.fetch(path, { navigate: true })).text(), files.get('index.html').toString());
      }
      for (const file of first.files) {
        const response = await sw.fetch(file);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), files.get(file));
      }
      assert.equal(env.network.calls.length, 0);
      assert.equal(sw.fetch('../another-app/', { navigate: true }), undefined);
      assert.equal(sw.fetch('https://other.test/'), undefined);
      assert.equal(sw.fetch('index.html', { method: 'POST' }), undefined);
    });

    await t.test('failed initial download never reports offline readiness', async () => {
      const env = environment(files);
      env.network.missing = excelFiles[0];
      const sw = env.worker(source);
      await assert.rejects(sw.lifecycle('install'));
      assert.equal(await sw.ready(), false);
    });

    await t.test('cache eviction is detected and HTTP errors are not cached', async () => {
      const env = environment(files);
      const sw = env.worker(source);
      await sw.lifecycle('install');
      const cache = [...env.stores.values()][0];
      const file = excelFiles[0];
      cache.delete(env.scope + file);
      assert.equal(await sw.ready(), false);
      env.network.missing = file;
      assert.equal((await sw.fetch(file)).status, 404);
      assert.equal(cache.has(env.scope + file), false);
      env.network.missing = null;
      assert.equal((await sw.fetch(file)).status, 200);
      assert.equal(await sw.ready(), true);
    });

    await t.test('new release leaves running version intact; activation cleans only its own scope', async () => {
      const env = environment(files);
      const previous = env.worker(source);
      await previous.lifecycle('install');
      await previous.lifecycle('activate');
      const oldCache = (await env.stores.keys().next()).value;
      env.stores.set('lexika:/other-app/:keep', new Map());
      // A public file change must version the worker, even when JS hashes stay the same.
      await writeFile(join(outDir, 'icons/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      const second = await buildServiceWorker(outDir);
      assert.notEqual(second.version, first.version);
      const next = env.worker(await readFile(join(outDir, 'sw.js'), 'utf8'));
      env.network.missing = excelFiles[0];
      await assert.rejects(next.lifecycle('install'));
      assert.equal(await previous.ready(), true);
      env.network.missing = null;
      await next.lifecycle('install');
      assert.equal(env.stores.has(oldCache), true, 'Installing an update retains the running version');
      await next.lifecycle('activate');
      assert.equal(env.stores.has(oldCache), false);
      assert.equal(env.stores.has('lexika:/other-app/:keep'), true);
    });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
