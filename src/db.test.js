import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { applyDictionaryImport, loadSnapshot, recordRating, replaceSnapshot, saveSettings, saveRecent } from './db.js';
import { makeBackup, validateBackup, SNAPSHOT_STORES } from './backup.js';
import { cardKey } from './domain.js';

function row(english, russian) {
  return { english, russian, key: cardKey(english, russian), errors: [], warnings: [] };
}

test('dictionary imports share card identity and preserve progress across lists', async () => {
  const firstId = await applyDictionaryImport({ name: 'Основной', rows: [row('light', 'свет'), row('light', 'лёгкий')] });
  let snapshot = await loadSnapshot();
  const sharedCard = snapshot.cards.find((card) => card.key === cardKey('light', 'свет'));
  await recordRating(sharedCard.id, true);
  const secondId = await applyDictionaryImport({ name: 'Повтор', rows: [row('light', 'свет')] });
  snapshot = await loadSnapshot();
  assert.equal(snapshot.dictionaries.length, 2);
  assert.equal(snapshot.dictionaryCards.filter((link) => link.cardId === sharedCard.id).length, 2);
  assert.equal(snapshot.trainerProgress.find((item) => item.cardId === sharedCard.id).attemptsCount, 1);
  assert.equal(snapshot.settings.find((item) => item.id === 'app').activeDictionaryId, secondId);

  await applyDictionaryImport({ dictionaryId: firstId, name: 'Основной', rows: [row('light', 'свет')], replaceComposition: true });
  snapshot = await loadSnapshot();
  assert.equal(snapshot.dictionaryCards.filter((link) => link.dictionaryId === firstId).length, 1);
  assert.equal(snapshot.dictionaryCards.filter((link) => link.cardId === sharedCard.id).length, 2);
});

test('backup restores every store after clearing the database and rolls back write failures', async (t) => {
  const dictionaryId = await applyDictionaryImport({ name: 'Копия', rows: [row('sing', 'петь'), row('go', 'идти')] });
  const card = (await loadSnapshot()).cards.find((item) => item.english === 'sing');
  await recordRating(card.id, true);
  await recordRating(card.id, false);
  await saveSettings({ direction: 'ru', priority: 'hard' });
  await saveRecent(dictionaryId, [card.id]);
  const before = await loadSnapshot();
  const backup = JSON.parse(JSON.stringify(makeBackup(before)));

  await t.test('export → empty database → restore preserves all data', async () => {
    await replaceSnapshot(Object.fromEntries(SNAPSHOT_STORES.map((name) => [name, []])));
    assert.equal((await loadSnapshot()).cards.length, 0);
    await replaceSnapshot(validateBackup(backup));
    assert.deepEqual(await loadSnapshot(), before);
    await replaceSnapshot(validateBackup(backup));
    assert.deepEqual(await loadSnapshot(), before);
  });

  await t.test('malformed data does not clear existing stores', async () => {
    const damaged = structuredClone(before);
    delete damaged.cards[0].id;
    await assert.rejects(replaceSnapshot(damaged));
    assert.deepEqual(await loadSnapshot(), before);
  });

  for (const asynchronous of [false, true]) {
    await t.test(`${asynchronous ? 'asynchronous constraint' : 'synchronous put'} failure rolls back all stores`, async () => {
      const original = IDBObjectStore.prototype.put;
      // Inject a failure late in the transaction, after clears and writes in other stores.
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (this.name === 'settings') {
          if (!asynchronous) throw new DOMException('Simulated write failure', 'DataCloneError');
          return this.transaction.objectStore('cards').add(before.cards[0]);
        }
        return original.call(this, value, ...args);
      };
      const replacement = structuredClone(before);
      replacement.dictionaries[0].name = 'Не должно сохраниться';
      try {
        await assert.rejects(replaceSnapshot(replacement), { name: asynchronous ? 'ConstraintError' : 'DataCloneError' });
      } finally {
        IDBObjectStore.prototype.put = original;
      }
      assert.deepEqual(await loadSnapshot(), before);
    });
  }
});
