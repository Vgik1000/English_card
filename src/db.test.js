import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { applyDictionaryImport, loadSnapshot, recordRating } from './db.js';
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