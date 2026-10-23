import { TRAINER_ID } from './domain.js';

const DATABASE_NAME = 'english-trainer';
const DATABASE_VERSION = 1;

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Операция отменена'));
  });
}

export function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Браузер не поддерживает локальное хранилище IndexedDB'));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('cards')) {
        const cards = database.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('key', 'key', { unique: true });
      }
      if (!database.objectStoreNames.contains('dictionaries')) {
        database.createObjectStore('dictionaries', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('dictionaryCards')) {
        const links = database.createObjectStore('dictionaryCards', { keyPath: ['dictionaryId', 'cardId'] });
        links.createIndex('dictionaryId', 'dictionaryId');
        links.createIndex('cardId', 'cardId');
      }
      if (!database.objectStoreNames.contains('trainerProgress')) {
        database.createObjectStore('trainerProgress', { keyPath: ['cardId', 'trainerId'] });
      }
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('selectionRecent')) {
        database.createObjectStore('selectionRecent', { keyPath: 'dictionaryId' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error);
    };
    request.onblocked = () => reject(new Error('Закройте другие вкладки приложения, чтобы обновить локальную базу'));
  });
  return databasePromise;
}

export async function readAll(storeName) {
  const database = await openDatabase();
  return requestResult(database.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

export async function readById(storeName, id) {
  const database = await openDatabase();
  return requestResult(database.transaction(storeName, 'readonly').objectStore(storeName).get(id));
}

export async function loadSnapshot() {
  const database = await openDatabase();
  const transaction = database.transaction(['cards', 'dictionaries', 'dictionaryCards', 'trainerProgress', 'settings', 'selectionRecent'], 'readonly');
  const stores = ['cards', 'dictionaries', 'dictionaryCards', 'trainerProgress', 'settings', 'selectionRecent'];
  const rows = await Promise.all(stores.map((name) => requestResult(transaction.objectStore(name).getAll())));
  await transactionResult(transaction);
  return Object.fromEntries(stores.map((name, index) => [name, rows[index]]));
}

export async function saveSettings(patch) {
  const database = await openDatabase();
  const transaction = database.transaction('settings', 'readwrite');
  const store = transaction.objectStore('settings');
  const current = await requestResult(store.get('app'));
  store.put({
    id: 'app',
    activeDictionaryId: null,
    direction: 'mixed',
    priority: 'random',
    activeTrainerId: TRAINER_ID,
    ...current,
    ...patch,
  });
  await transactionResult(transaction);
}

export async function saveRecent(dictionaryId, cardIds) {
  const database = await openDatabase();
  const transaction = database.transaction('selectionRecent', 'readwrite');
  transaction.objectStore('selectionRecent').put({ dictionaryId, cardIds });
  await transactionResult(transaction);
}

export async function recordRating(cardId, correct) {
  const database = await openDatabase();
  const transaction = database.transaction('trainerProgress', 'readwrite');
  const store = transaction.objectStore('trainerProgress');
  const key = [cardId, TRAINER_ID];
  const current = await requestResult(store.get(key));
  const recentResults = [...(current?.recentResults ?? []), Boolean(correct)].slice(-20);
  store.put({
    cardId,
    trainerId: TRAINER_ID,
    attemptsCount: (current?.attemptsCount ?? 0) + 1,
    correctCount: (current?.correctCount ?? 0) + (correct ? 1 : 0),
    incorrectCount: (current?.incorrectCount ?? 0) + (correct ? 0 : 1),
    recentResults,
    updatedAt: new Date().toISOString(),
  });
  await transactionResult(transaction);
}

export async function applyDictionaryImport({ dictionaryId, name, rows, replaceComposition, replaceConflicts = false }) {
  const database = await openDatabase();
  const before = await loadSnapshot();
  const existingDictionary = dictionaryId ? before.dictionaries.find((item) => item.id === dictionaryId) : null;
  if (dictionaryId && !existingDictionary) throw new Error('Выбранный словарь больше не существует');
  const targetDictionaryId = existingDictionary?.id ?? crypto.randomUUID();
  const currentLinks = before.dictionaryCards.filter((link) => link.dictionaryId === targetDictionaryId);
  const cardsByKey = new Map(before.cards.map((card) => [card.key, card]));
  const importedKeys = new Set(rows.map((row) => row.key));
  const transaction = database.transaction(['cards', 'dictionaries', 'dictionaryCards', 'selectionRecent', 'settings'], 'readwrite');
  const cardsStore = transaction.objectStore('cards');
  const dictionariesStore = transaction.objectStore('dictionaries');
  const linksStore = transaction.objectStore('dictionaryCards');

  for (const row of rows) {
    const found = cardsByKey.get(row.key);
    const id = found?.id ?? crypto.randomUUID();
    const nextCard = found ? { ...found } : { id, key: row.key };
    for (const field of ['english', 'russian', 'transcription', 'pastSimple', 'pastParticiple', 'exampleEn', 'exampleRu']) {
      if (row[field] && (!found?.[field] || replaceConflicts)) nextCard[field] = row[field];
    }
    if (!found || JSON.stringify(found) !== JSON.stringify(nextCard)) cardsStore.put(nextCard);
    linksStore.put({ dictionaryId: targetDictionaryId, cardId: id });
  }

  if (replaceComposition && !rows.some((row) => row.errors?.length)) {
    for (const link of currentLinks) {
      const card = before.cards.find((item) => item.id === link.cardId);
      if (card && !importedKeys.has(card.key)) linksStore.delete([targetDictionaryId, link.cardId]);
    }
  }
  const timestamp = new Date().toISOString();
  dictionariesStore.put({
    id: targetDictionaryId,
    name: name.trim() || 'Мой словарь',
    createdAt: existingDictionary?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
  transaction.objectStore('selectionRecent').delete(targetDictionaryId);
  const settingsStore = transaction.objectStore('settings');
  const currentSettings = before.settings.find((item) => item.id === 'app') ?? {};
  settingsStore.put({ id: 'app', direction: 'mixed', priority: 'random', activeTrainerId: TRAINER_ID, ...currentSettings, activeDictionaryId: targetDictionaryId });
  await transactionResult(transaction);
  return targetDictionaryId;
}

export async function removeDictionary(dictionaryId) {
  const database = await openDatabase();
  const snapshot = await loadSnapshot();
  const dictionaries = snapshot.dictionaries.filter((dictionary) => dictionary.id !== dictionaryId);
  const transaction = database.transaction(['dictionaries', 'dictionaryCards', 'selectionRecent', 'settings'], 'readwrite');
  transaction.objectStore('dictionaries').delete(dictionaryId);
  for (const link of snapshot.dictionaryCards) {
    if (link.dictionaryId === dictionaryId) transaction.objectStore('dictionaryCards').delete([link.dictionaryId, link.cardId]);
  }
  transaction.objectStore('selectionRecent').delete(dictionaryId);
  const settingsStore = transaction.objectStore('settings');
  const current = snapshot.settings.find((item) => item.id === 'app') ?? { id: 'app', direction: 'mixed', priority: 'random', activeTrainerId: TRAINER_ID };
  settingsStore.put({ ...current, activeDictionaryId: dictionaries[0]?.id ?? null });
  await transactionResult(transaction);
  return dictionaries[0]?.id ?? null;
}

export async function replaceSnapshot(snapshot) {
  const database = await openDatabase();
  const storeNames = ['cards', 'dictionaries', 'dictionaryCards', 'trainerProgress', 'settings', 'selectionRecent'];
  const transaction = database.transaction(storeNames, 'readwrite');
  for (const name of storeNames) {
    const store = transaction.objectStore(name);
    store.clear();
    for (const row of snapshot[name]) store.put(row);
  }
  await transactionResult(transaction);
}