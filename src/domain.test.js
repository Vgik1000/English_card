import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardKey,
  chooseNextCard,
  getStatus,
  getWeight,
  getRecentErrorRate,
  nextRecentIds,
  recordAnswer,
  summarizeCards,
  sortStatsCards,
  getStatsSort,
  toggleStatsSort,
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

test('difficulty uses only the latest twenty answers, not lifetime failures', () => {
  assert.equal(getRecentErrorRate(), null);
  assert.equal(getRecentErrorRate({ recentResults: [] }), null);
  assert.equal(getRecentErrorRate({ recentResults: [true, false, false] }), 2 / 3);
  const recovered = { attemptsCount: 120, incorrectCount: 100, recentResults: [...Array(100).fill(false), ...Array(20).fill(true)] };
  assert.equal(getRecentErrorRate(recovered), 0);
  assert.equal(getWeight(recovered, 'hard'), 1);
});

test('default ranking is descending by lifetime rated shows, including unrated words', () => {
  const cards = ['two', 'new', 'ten'].map((id) => ({ id, english: id, russian: id }));
  const progress = new Map([['two', { attemptsCount: 2, correctCount: 0 }], ['ten', { attemptsCount: 10, correctCount: 10 }]]);
  assert.deepEqual(sortStatsCards(cards, progress).map((card) => card.id), ['ten', 'two', 'new']);
  assert.deepEqual(sortStatsCards(cards, progress, [{ key: 'attempts', direction: 'asc' }]).map((card) => card.id), ['new', 'two', 'ten']);
  assert.deepEqual(cards.map((card) => card.id), ['two', 'new', 'ten']);
});

test('correct percentage sorts by lifetime accuracy, with missing percentages last in either direction', () => {
  const cards = ['new', 'low', 'high'].map((id) => ({ id, english: id, russian: id }));
  const progress = new Map([
    ['low', { attemptsCount: 10, correctCount: 2, recentResults: [true] }],
    ['high', { attemptsCount: 20, correctCount: 18, recentResults: [false] }],
  ]);
  assert.deepEqual(sortStatsCards(cards, progress, [{ key: 'correct', direction: 'desc' }]).map((card) => card.id), ['high', 'low', 'new']);
  assert.deepEqual(sortStatsCards(cards, progress, [{ key: 'correct', direction: 'asc' }]).map((card) => card.id), ['low', 'high', 'new']);
});

test('two ranking keys use independent directions and the first key takes precedence', () => {
  const cards = ['a', 'b', 'c', 'd'].map((id) => ({ id, english: id, russian: id }));
  const progress = new Map([
    ['a', { attemptsCount: 20, correctCount: 10 }],
    ['b', { attemptsCount: 10, correctCount: 5 }],
    ['c', { attemptsCount: 20, correctCount: 4 }],
    ['d', { attemptsCount: 5, correctCount: 1 }],
  ]);
  const sorted = (criteria) => sortStatsCards(cards, progress, criteria).map((card) => card.id);
  assert.deepEqual(sorted([{ key: 'correct', direction: 'asc' }, { key: 'attempts', direction: 'desc' }]), ['c', 'd', 'a', 'b']);
  assert.deepEqual(sorted([{ key: 'correct', direction: 'asc' }, { key: 'attempts', direction: 'asc' }]), ['d', 'c', 'b', 'a']);
  assert.deepEqual(sorted([{ key: 'attempts', direction: 'desc' }, { key: 'correct', direction: 'asc' }]), ['c', 'a', 'b', 'd']);
  assert.deepEqual(sorted([{ key: 'attempts', direction: 'desc' }, { key: 'correct', direction: 'desc' }]), ['a', 'c', 'b', 'd']);
});

test('ranking uses exact percentages rather than rounded display values', () => {
  const cards = ['a', 'b'].map((id) => ({ id, english: id, russian: id }));
  const progress = new Map([['a', { attemptsCount: 1000, correctCount: 501 }], ['b', { attemptsCount: 10, correctCount: 5 }]]);
  assert.deepEqual(sortStatsCards(cards, progress, [{ key: 'correct', direction: 'asc' }, { key: 'attempts', direction: 'desc' }]).map((card) => card.id), ['b', 'a']);
});

test('header clicks choose primary and secondary ranking and toggle only the clicked direction', () => {
  assert.deepEqual(getStatsSort(), [{ key: 'attempts', direction: 'desc' }]);
  assert.deepEqual(toggleStatsSort([], 'attempts'), [{ key: 'attempts', direction: 'asc' }]);
  const first = toggleStatsSort([], 'correct');
  assert.deepEqual(first, [{ key: 'correct', direction: 'desc' }]);
  const second = toggleStatsSort(first, 'attempts');
  assert.deepEqual(second, [{ key: 'correct', direction: 'desc' }, { key: 'attempts', direction: 'desc' }]);
  assert.deepEqual(toggleStatsSort(second, 'correct'), [{ key: 'correct', direction: 'asc' }, { key: 'attempts', direction: 'desc' }]);
  assert.deepEqual(first, [{ key: 'correct', direction: 'desc' }]);
  assert.deepEqual(getStatsSort([]), [{ key: 'attempts', direction: 'desc' }]);
});

test('tied statistics retain a deterministic alphabetical order for distinct meanings', () => {
  const cards = [
    { id: 'light-2', english: 'light', russian: 'свет' },
    { id: 'light-1', english: 'light', russian: 'лёгкий' },
    { id: 'bring', english: 'bring', russian: 'приносить' },
  ];
  for (const direction of ['asc', 'desc']) {
    assert.deepEqual(sortStatsCards(cards, new Map(), [{ key: 'correct', direction }, { key: 'attempts', direction }]).map((card) => card.id), ['bring', 'light-1', 'light-2']);
  }
  assert.deepEqual(sortStatsCards([], new Map()), []);
});
