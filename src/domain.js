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
    const recent = progress?.recentResults ?? [];
    if (!recent.length) return 1;
    const errors = recent.filter((result) => !result).length;
    return 1 + 5 * (errors / recent.length);
  }
  return 1;
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