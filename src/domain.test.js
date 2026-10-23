import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardKey,
  chooseNextCard,
  getStatus,
  getWeight,
  nextRecentIds,
  recordAnswer,
  summarizeCards,
} from './domain.js';

test('card identity ignores case and repeated outer whitespace', () => {
  assert.equal(cardKey('  Bring   me ', ' ПРИНОСИТЬ '), cardKey('bring me', 'приносить'));
  assert.notEqual(cardKey('light', 'свет'), cardKey('light', 'лёгкий'));
});

test('status uses attempts total and the latest ten outcomes', () => {
  const outcomes = [true, true, true, true, true, true, true, true, true, false];
  assert.equal(getStatus({ attemptsCount: 10, recentResults: outcomes }), 'learned');
  assert.equal(getStatus({ attemptsCount: 11, recentResults: [...outcomes, false] }), 'learning');
  assert.equal(getStatus({ attemptsCount: 0, recentResults: [] }), 'not-started');
});

test('answers update lifetime totals and retain only twenty recent results', () => {
  const progress = { cardId: 'a', attemptsCount: 22, correctCount: 18, incorrectCount: 4, recentResults: Array(20).fill(true) };
  const updated = recordAnswer(progress, false, '2026-10-23T00:00:00.000Z');
  assert.equal(updated.attemptsCount, 23);
  assert.equal(updated.correctCount, 18);
  assert.equal(updated.incorrectCount, 5);
  assert.equal(updated.recentResults.length, 20);
  assert.equal(updated.recentResults.at(-1), false);
});

test('new and hard priorities compute the specified positive weights', () => {
  assert.equal(getWeight({ attemptsCount: 0 }, 'new'), 1);
  assert.equal(getWeight({ attemptsCount: 3 }, 'new'), 1 / 8);
  assert.equal(getWeight({ attemptsCount: 5, recentResults: [true, false] }, 'hard'), 3.5);
  assert.equal(getWeight({ attemptsCount: 0, recentResults: [] }, 'hard'), 1);
});

test('selection avoids recent IDs and works with one-card dictionaries', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(chooseNextCard(cards, new Map(), 'random', ['a', 'b'], () => 0).id, 'c');
  assert.equal(chooseNextCard([{ id: 'only' }], new Map(), 'new', ['only'], () => 0).id, 'only');
  assert.deepEqual(nextRecentIds(['a', 'b'], 'a', 3), ['b', 'a']);
});

test('summary partitions every card into one status', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const progress = new Map([['a', { attemptsCount: 1, recentResults: [false] }]]);
  assert.deepEqual(summarizeCards(cards, progress), { total: 3, learned: 0, learning: 1, notStarted: 2 });
});