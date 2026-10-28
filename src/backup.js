import { cardKey, RECENT_LIMIT, TRAINER_ID } from './domain.js';

export const SNAPSHOT_STORES = ['cards', 'dictionaries', 'dictionaryCards', 'trainerProgress', 'settings', 'selectionRecent'];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isDate = (value) => isText(value) && Number.isFinite(Date.parse(value));
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

function unique(rows, key, message) {
  const keys = rows.map(key);
  check(new Set(keys).size === keys.length, message);
}

// Validate before opening a write transaction, including calls outside the UI.
export function validateSnapshot(data) {
  check(isRecord(data) && SNAPSHOT_STORES.every((name) => Array.isArray(data[name])), 'В резервной копии отсутствуют необходимые разделы данных');
  for (const name of SNAPSHOT_STORES) {
    check(data[name].every(isRecord), `Повреждён раздел резервной копии: ${name}`);
  }

  for (const card of data.cards) {
    check(isText(card.id) && isText(card.english) && isText(card.russian), 'У карточки отсутствует ID, слово или перевод');
    check(card.key === cardKey(card.english, card.russian), 'Некорректный ключ карточки в резервной копии');
    check(['transcription', 'pastSimple', 'pastParticiple', 'exampleEn', 'exampleRu'].every((field) => card[field] === undefined || typeof card[field] === 'string'), 'Некорректные дополнительные поля карточки');
  }
  unique(data.cards, (card) => card.id, 'В резервной копии повторяются ID карточек');
  unique(data.cards, (card) => card.key, 'В резервной копии повторяются пары слов и переводов');
  const cardIds = new Set(data.cards.map((card) => card.id));

  for (const dictionary of data.dictionaries) {
    check(isText(dictionary.id) && isText(dictionary.name) && isDate(dictionary.createdAt) && isDate(dictionary.updatedAt), 'Некорректные данные словаря в резервной копии');
  }
  unique(data.dictionaries, (dictionary) => dictionary.id, 'В резервной копии повторяются ID словарей');
  const dictionaryIds = new Set(data.dictionaries.map((dictionary) => dictionary.id));
  const members = new Map(data.dictionaries.map((dictionary) => [dictionary.id, new Set()]));
  for (const link of data.dictionaryCards) {
    check(dictionaryIds.has(link.dictionaryId) && cardIds.has(link.cardId), 'В резервной копии есть связи на отсутствующие данные');
    members.get(link.dictionaryId).add(link.cardId);
  }
  unique(data.dictionaryCards, (link) => JSON.stringify([link.dictionaryId, link.cardId]), 'В резервной копии повторяются связи словарей с карточками');

  for (const progress of data.trainerProgress) {
    check(cardIds.has(progress.cardId) && progress.trainerId === TRAINER_ID, 'Некорректная ссылка или режим в статистике');
    check([progress.attemptsCount, progress.correctCount, progress.incorrectCount].every(isCount)
      && progress.attemptsCount === progress.correctCount + progress.incorrectCount, 'Некорректные счётчики ответов в статистике');
    check(Array.isArray(progress.recentResults) && progress.recentResults.every((result) => typeof result === 'boolean')
      && progress.recentResults.length === Math.min(RECENT_LIMIT, progress.attemptsCount), 'Некорректная история ответов в статистике');
    const correct = progress.recentResults.filter(Boolean).length;
    check(correct <= progress.correctCount && progress.recentResults.length - correct <= progress.incorrectCount
      && isDate(progress.updatedAt), 'История ответов не соответствует статистике');
  }
  unique(data.trainerProgress, (progress) => JSON.stringify([progress.cardId, progress.trainerId]), 'В резервной копии повторяется статистика карточки');

  check(data.settings.length <= 1, 'В резервной копии повторяются настройки');
  for (const settings of data.settings) {
    check(settings.id === 'app' && settings.activeTrainerId === TRAINER_ID
      && ['en', 'ru', 'mixed'].includes(settings.direction) && ['random', 'new', 'hard'].includes(settings.priority)
      && (settings.activeDictionaryId === null || isText(settings.activeDictionaryId)), 'Некорректные настройки в резервной копии');
    // A deleted active dictionary is repaired by refreshSnapshot after restore.
  }
  for (const recent of data.selectionRecent) {
    const ids = members.get(recent.dictionaryId);
    check(ids && Array.isArray(recent.cardIds) && recent.cardIds.every((id) => ids.has(id))
      && new Set(recent.cardIds).size === recent.cardIds.length
      && recent.cardIds.length <= Math.min(10, Math.max(0, ids.size - 1)), 'Некорректная история выбора карточек');
  }
  unique(data.selectionRecent, (recent) => recent.dictionaryId, 'В резервной копии повторяется история выбора карточек');

  return structuredClone(Object.fromEntries(SNAPSHOT_STORES.map((name) => [name, data[name]])));
}

export function makeBackup(snapshot) {
  return {
    format: 'english-trainer-backup',
    formatVersion: 1,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    ...validateSnapshot(snapshot),
  };
}

export function validateBackup(data) {
  check(isRecord(data) && data.format === 'english-trainer-backup' && data.formatVersion === 1 && data.schemaVersion === 1, 'Неизвестный формат или версия резервной копии');
  check(isDate(data.createdAt), 'Некорректная дата резервной копии');
  return validateSnapshot(data);
}
