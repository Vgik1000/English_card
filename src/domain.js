export const TRAINER_ID = 'flashcards';
export const RECENT_LIMIT = 20;

export function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function cardKey(english, russian) {
  return `${normalizeText(english).toLocaleLowerCase('en')}\u0000${normalizeText(russian).toLocaleLowerCase('ru')}`;
}

export function getStatus(progress) {
  if (!progress?.attemptsCount) return 'not-started';
  const latest = (progress.recentResults ?? []).slice(-10);
  if (progress.attemptsCount >= 10 && latest.length === 10 && latest.filter(Boolean).length >= 9) {
    return 'learned';
  }
  return 'learning';
}

export function getWeight(progress, priority) {
  const attempts = progress?.attemptsCount ?? 0;
  if (priority === 'new') return 1 / Math.pow(1 + attempts, 1.5);
  if (priority === 'hard') {
    return 1 + 5 * (getRecentErrorRate(progress) ?? 0);
  }
  return 1;
}

export function getRecentErrorRate(progress) {
  const recent = (progress?.recentResults ?? []).slice(-RECENT_LIMIT);
  if (!recent.length) return null;
  return recent.filter((result) => !result).length / recent.length;
}

export function getStatsSort(criteria = []) {
  return criteria.length ? criteria : [{ key: 'attempts', direction: 'desc' }];
}

export function toggleStatsSort(criteria, key) {
  if (!['correct', 'attempts'].includes(key)) return criteria;
  if (criteria.some((criterion) => criterion.key === key)) {
    return criteria.map((criterion) => criterion.key === key
      ? { ...criterion, direction: criterion.direction === 'desc' ? 'asc' : 'desc' }
      : criterion);
  }
  // Первый выбранный пользователем столбец заменяет порядок по умолчанию.
  const current = getStatsSort(criteria).find((criterion) => criterion.key === key);
  return [...criteria, { key, direction: current?.direction === 'desc' ? 'asc' : 'desc' }];
}

export function sortStatsCards(cards, progressByCard, criteria = []) {
  const sorting = getStatsSort(criteria);
  const value = (card, key) => {
    const progress = progressByCard.get(card.id);
    const attempts = progress?.attemptsCount ?? 0;
    return key === 'attempts' ? attempts : (attempts ? progress.correctCount / attempts : null);
  };
  return [...cards].sort((a, b) => {
    for (const { key, direction } of sorting) {
      const first = value(a, key);
      const second = value(b, key);
      // Без оценок процент неизвестен, а не равен нулю.
      if (first === null && second !== null) return 1;
      if (second === null && first !== null) return -1;
      const difference = (first - second) * (direction === 'asc' ? 1 : -1);
      if (difference) return difference;
    }
    return a.english.localeCompare(b.english, 'en', { sensitivity: 'base' })
      || a.russian.localeCompare(b.russian, 'ru', { sensitivity: 'base' })
      || a.id.localeCompare(b.id);
  });
}

export function pickWeighted(items, getItemWeight, random = Math.random) {
  if (!items.length) return null;
  const weights = items.map((item) => {
    const weight = Number(getItemWeight(item));
    return Number.isFinite(weight) && weight > 0 ? weight : 0;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) return items[Math.floor(random() * items.length)];
  let target = random() * total;
  for (let index = 0; index < items.length; index += 1) {
    target -= weights[index];
    if (target < 0) return items[index];
  }
  return items[items.length - 1];
}

export function chooseNextCard(cards, progressByCard, priority, recentIds = [], random = Math.random) {
  if (!cards.length) return null;
  const recent = new Set(recentIds);
  let candidates = cards.filter((card) => !recent.has(card.id));
  while (!candidates.length && recent.size) {
    recent.delete(recent.values().next().value);
    candidates = cards.filter((card) => !recent.has(card.id));
  }
  return pickWeighted(candidates, (card) => getWeight(progressByCard.get(card.id), priority), random);
}

export function nextRecentIds(recentIds, cardId, dictionarySize) {
  const limit = Math.min(10, Math.max(0, dictionarySize - 1));
  const next = [...recentIds.filter((id) => id !== cardId), cardId];
  return limit ? next.slice(-limit) : [];
}

export function recordAnswer(progress, correct, now = new Date().toISOString()) {
  const recentResults = [...(progress?.recentResults ?? []), Boolean(correct)].slice(-RECENT_LIMIT);
  return {
    cardId: progress?.cardId,
    trainerId: progress?.trainerId ?? TRAINER_ID,
    attemptsCount: (progress?.attemptsCount ?? 0) + 1,
    correctCount: (progress?.correctCount ?? 0) + (correct ? 1 : 0),
    incorrectCount: (progress?.incorrectCount ?? 0) + (correct ? 0 : 1),
    recentResults,
    updatedAt: now,
  };
}

export function summarizeCards(cards, progressByCard) {
  const summary = { total: cards.length, learned: 0, learning: 0, notStarted: 0 };
  for (const card of cards) {
    const status = getStatus(progressByCard.get(card.id));
    if (status === 'learned') summary.learned += 1;
    else if (status === 'learning') summary.learning += 1;
    else summary.notStarted += 1;
  }
  return summary;
}
