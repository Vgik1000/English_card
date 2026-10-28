import test from 'node:test';
import assert from 'node:assert/strict';
import { registerOffline } from './offline.js';

class Worker extends EventTarget {
  constructor(ready) { super(); this.ready = ready; }
  postMessage(message, ports) {
    assert.equal(message.type, 'CHECK_OFFLINE_READY');
    ports[0].postMessage({ type: 'OFFLINE_STATUS', ready: this.ready });
  }
}

test('offline status follows cache readiness and update lifecycle', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
  function install(registration) {
    const serviceWorker = new EventTarget();
    serviceWorker.register = async (url, options) => {
      assert.equal(url, '/english-trainer/sw.js');
      assert.deepEqual(options, { scope: '/english-trainer/', updateViaCache: 'none' });
      return registration;
    };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker } });
  }

  await t.test('only a fully cached active worker reports readiness', async () => {
    const registration = Object.assign(new EventTarget(), { active: new Worker(true) });
    install(registration);
    const messages = [];
    await registerOffline('/english-trainer/', (message) => messages.push(message));
    assert.equal(messages.at(-1), 'Готово к работе без интернета');
    registration.active.ready = false;
    await registerOffline('/english-trainer/', (message) => messages.push(message));
    assert.match(messages.at(-1), /Не удалось подготовить/);
  });

  await t.test('initial installation is pending until the worker activates', async () => {
    const worker = new Worker(true);
    const registration = Object.assign(new EventTarget(), { installing: worker });
    install(registration);
    const messages = [];
    let becameReady;
    const ready = new Promise((resolve) => { becameReady = resolve; });
    await registerOffline('/english-trainer/', (message) => {
      messages.push(message);
      if (message === 'Готово к работе без интернета') becameReady();
    });
    assert.match(messages.at(-1), /Подготовка/);
    registration.installing = null;
    registration.active = worker;
    worker.dispatchEvent(new Event('statechange'));
    await ready;
    assert.equal(messages.at(-1), 'Готово к работе без интернета');
  });

  await t.test('waiting update asks to close tabs rather than claiming readiness', async () => {
    install(Object.assign(new EventTarget(), { waiting: new Worker(true) }));
    const messages = [];
    await registerOffline('/english-trainer/', (message) => messages.push(message));
    assert.match(messages.at(-1), /Закройте все вкладки/);
  });

  await t.test('registration failure and unsupported browser show an explanation', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { register: async () => { throw new Error('No connection'); } } } });
    const messages = [];
    await registerOffline('/english-trainer/', (message) => messages.push(message));
    assert.match(messages.at(-1), /Подключитесь к интернету/);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    await registerOffline('/english-trainer/', (message) => messages.push(message));
    assert.match(messages.at(-1), /недоступен/);
  });
});
