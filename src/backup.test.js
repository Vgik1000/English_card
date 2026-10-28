import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, validateBackup, SNAPSHOT_STORES } from './backup.js';
import { cardKey } from './domain.js';

function fixture() {
  const date = '2026-10-28T12:00:00.000Z';
  return {
    format: 'english-trainer-backup', formatVersion: 1, schemaVersion: 1, createdAt: date,
    cards: [{ id: 'c1', english: 'sing', russian: 'петь', key: cardKey('sing', 'петь'), pastSimple: 'sang', pastParticiple: 'sung' }],
    dictionaries: [{ id: 'd1', name: 'Глаголы', createdAt: date, updatedAt: date }],
    dictionaryCards: [{ dictionaryId: 'd1', cardId: 'c1' }],
    trainerProgress: [{ cardId: 'c1', trainerId: 'flashcards', attemptsCount: 2, correctCount: 1, incorrectCount: 1, recentResults: [true, false], updatedAt: date }],
    settings: [{ id: 'app', activeDictionaryId: 'd1', activeTrainerId: 'flashcards', direction: 'en', priority: 'hard' }],
    selectionRecent: [{ dictionaryId: 'd1', cardIds: [] }],
  };
}

test('backup JSON round trip preserves optional fields, settings and progress', () => {
  const source = fixture();
  const snapshot = Object.fromEntries(SNAPSHOT_STORES.map((name) => [name, source[name]]));
  const restored = validateBackup(JSON.parse(JSON.stringify(makeBackup(snapshot))));
  assert.deepEqual(restored, snapshot);
  restored.cards[0].english = 'changed';
  assert.equal(source.cards[0].english, 'sing');
});

test('empty backup is valid, as are archived cards and a removed active dictionary', () => {
  const empty = Object.fromEntries(SNAPSHOT_STORES.map((name) => [name, []]));
  assert.deepEqual(validateBackup(makeBackup(empty)), empty);
  const backup = fixture();
  backup.dictionaryCards = [];
  backup.settings[0].activeDictionaryId = 'deleted';
  assert.doesNotThrow(() => validateBackup(backup));
});

const invalidCases = [
  ['unknown version', (b) => { b.formatVersion = 2; }],
  ['unknown schema', (b) => { b.schemaVersion = 2; }],
  ['invalid date', (b) => { b.createdAt = 'wrong'; }],
  ['missing store', (b) => { delete b.settings; }],
  ['null row', (b) => { b.cards[0] = null; }],
  ['missing card ID', (b) => { delete b.cards[0].id; }],
  ['missing translation', (b) => { delete b.cards[0].russian; }],
  ['invalid key', (b) => { b.cards[0].key = 'wrong'; }],
  ['non-text example', (b) => { b.cards[0].exampleEn = {}; }],
  ['duplicate card ID', (b) => { b.cards.push({ ...b.cards[0], english: 'go', key: cardKey('go', 'петь') }); }],
  ['duplicate card pair', (b) => { b.cards.push({ ...b.cards[0], id: 'c2' }); }],
  ['duplicate dictionary', (b) => { b.dictionaries.push({ ...b.dictionaries[0] }); }],
  ['invalid dictionary', (b) => { b.dictionaries[0].name = ''; }],
  ['dangling card link', (b) => { b.dictionaryCards[0].cardId = 'missing'; }],
  ['dangling dictionary link', (b) => { b.dictionaryCards[0].dictionaryId = 'missing'; }],
  ['duplicate link', (b) => { b.dictionaryCards.push({ ...b.dictionaryCards[0] }); }],
  ['dangling progress', (b) => { b.trainerProgress[0].cardId = 'missing'; }],
  ['unknown trainer', (b) => { b.trainerProgress[0].trainerId = 'unknown'; }],
  ['negative counters', (b) => { Object.assign(b.trainerProgress[0], { correctCount: -1, incorrectCount: 3 }); }],
  ['fractional counters', (b) => { Object.assign(b.trainerProgress[0], { correctCount: 0.5, incorrectCount: 1.5 }); }],
  ['inconsistent counters', (b) => { b.trainerProgress[0].attemptsCount = 3; }],
  ['non-boolean history', (b) => { b.trainerProgress[0].recentResults = [1, 0]; }],
  ['missing history', (b) => { delete b.trainerProgress[0].recentResults; }],
  ['short history', (b) => { b.trainerProgress[0].recentResults = [true]; }],
  ['inconsistent history', (b) => { b.trainerProgress[0].recentResults = [true, true]; }],
  ['duplicate progress', (b) => { b.trainerProgress.push({ ...b.trainerProgress[0] }); }],
  ['invalid direction', (b) => { b.settings[0].direction = 'unknown'; }],
  ['invalid priority', (b) => { b.settings[0].priority = 'unknown'; }],
  ['duplicate settings', (b) => { b.settings.push({ ...b.settings[0] }); }],
  ['dangling recent dictionary', (b) => { b.selectionRecent[0].dictionaryId = 'missing'; }],
  ['dangling recent card', (b) => { b.selectionRecent[0].cardIds = ['missing']; }],
];

for (const [name, damage] of invalidCases) {
  test(`rejects backup: ${name}`, () => {
    const backup = fixture();
    damage(backup);
    assert.throws(() => validateBackup(backup), Error);
  });
}

test('history retains only the latest 20 answers with all-time totals', () => {
  const backup = fixture();
  Object.assign(backup.trainerProgress[0], { attemptsCount: 100, correctCount: 90, incorrectCount: 10, recentResults: Array(20).fill(true) });
  assert.doesNotThrow(() => validateBackup(backup));
  backup.trainerProgress[0].recentResults.push(true);
  assert.throws(() => validateBackup(backup));
});
