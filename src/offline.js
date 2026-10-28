function checkCache(worker) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(ready);
    };
    // An older worker may not support this message yet.
    const timer = setTimeout(() => finish(false), 3000);
    channel.port1.onmessage = (event) => finish(event.data?.type === 'OFFLINE_STATUS' && event.data.ready === true);
    try {
      worker.postMessage({ type: 'CHECK_OFFLINE_READY' }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

export async function registerOffline(baseUrl, onStatus) {
  const failed = 'Не удалось подготовить офлайн-режим. Подключитесь к интернету и откройте приложение снова.';
  if (!('serviceWorker' in navigator)) {
    onStatus('Офлайн-режим недоступен в этом браузере или по этому адресу.');
    return;
  }
  onStatus('Подготовка к работе без интернета…');
  try {
    const registration = await navigator.serviceWorker.register(`${baseUrl}sw.js`, { scope: baseUrl, updateViaCache: 'none' });
    let revision = 0;
    const update = async () => {
      const current = ++revision;
      if (registration.waiting) {
        onStatus('Обновление готово. Закройте все вкладки приложения и откройте его снова.');
      } else if (registration.installing) {
        onStatus('Подготовка к работе без интернета…');
      } else if (registration.active) {
        const ready = await checkCache(registration.active);
        if (current === revision) onStatus(ready ? 'Готово к работе без интернета' : failed);
      } else {
        onStatus(failed);
      }
    };
    const watch = () => {
      registration.installing?.addEventListener('statechange', update);
      return update();
    };
    registration.addEventListener('updatefound', watch);
    navigator.serviceWorker.addEventListener('controllerchange', update);
    await watch();
  } catch {
    onStatus(failed);
  }
}
