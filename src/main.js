import {
  chooseNextCard,
  getStatus,
  nextRecentIds,
  summarizeCards,
} from './domain.js';
import {
  applyDictionaryImport,
  loadSnapshot,
  openDatabase,
  readAll,
  readById,
  recordRating,
  removeDictionary,
  saveRecent,
  saveSettings,
} from './db.js';
import { analyzeImport, parseExcelFile } from './importer.js';
import './style.css';

const app = document.querySelector('#app');
const state = {
  snapshot: null,
  settings: { direction: 'mixed', priority: 'random', activeTrainerId: 'flashcards' },
  activeCard: null,
  showEnglish: true,
  face: 'front',
  busy: false,
  view: 'study',
  modal: null,
  toast: '',
};

const labels = {
  direction: { mixed: 'Смешанное', en: 'Английский → русский', ru: 'Русский → английский' },
  priority: { random: 'Вперемешку', new: 'Сначала новые', hard: 'Сначала сложные' },
  status: { 'not-started': 'Не начато', learning: 'Изучается', learned: 'Выучено' },
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function activeDictionary() {
  return state.snapshot?.dictionaries.find((dictionary) => dictionary.id === state.settings.activeDictionaryId) ?? null;
}

function dictionaryCards(dictionaryId = state.settings.activeDictionaryId) {
  if (!dictionaryId || !state.snapshot) return [];
  const ids = new Set(state.snapshot.dictionaryCards.filter((link) => link.dictionaryId === dictionaryId).map((link) => link.cardId));
  return state.snapshot.cards.filter((card) => ids.has(card.id));
}

function progressMap() {
  return new Map(state.snapshot.trainerProgress.filter((item) => item.trainerId === 'flashcards').map((item) => [item.cardId, item]));
}

async function refreshSnapshot() {
  state.snapshot = await loadSnapshot();
  state.settings = state.snapshot.settings.find((item) => item.id === 'app') ?? state.settings;
  const available = state.snapshot.dictionaries;
  if (!available.some((dictionary) => dictionary.id === state.settings.activeDictionaryId)) {
    state.settings.activeDictionaryId = available[0]?.id ?? null;
    await saveSettings({ activeDictionaryId: state.settings.activeDictionaryId });
    state.snapshot = await loadSnapshot();
  }
}

async function selectCard(force = false) {
  const cards = dictionaryCards();
  if (!cards.length) {
    state.activeCard = null;
    state.face = 'front';
    render();
    return;
  }
  if (!force && state.activeCard && cards.some((card) => card.id === state.activeCard.id)) {
    render();
    return;
  }
  const recentRecord = await readById('selectionRecent', state.settings.activeDictionaryId);
  const validIds = new Set(cards.map((card) => card.id));
  const recentIds = (recentRecord?.cardIds ?? []).filter((id) => validIds.has(id));
  const selected = chooseNextCard(cards, progressMap(), state.settings.priority, recentIds);
  state.activeCard = selected;
  state.showEnglish = state.settings.direction === 'en' || (state.settings.direction === 'mixed' && Math.random() < 0.5);
  state.face = 'front';
  await saveRecent(state.settings.activeDictionaryId, nextRecentIds(recentIds, selected.id, cards.length));
  render();
}

async function reload({ choose = false } = {}) {
  await refreshSnapshot();
  if (choose) state.activeCard = null;
  await selectCard(choose);
}

function renderCardFace() {
  if (!state.activeCard) return '';
  const card = state.activeCard;
  if (state.face === 'front') {
    const showEnglish = state.showEnglish;
    return `<button class="flashcard face-front" data-action="flip" aria-label="Показать перевод"><span class="card-kicker">${showEnglish ? 'АНГЛИЙСКОЕ СЛОВО' : 'ПЕРЕВОД'}</span><span class="card-word">${escapeHtml(showEnglish ? card.english : card.russian)}</span><span class="card-hint">Нажмите, чтобы открыть ответ</span></button>`;
  }
  const verbForms = card.pastSimple && card.pastParticiple ? `<p class="detail-forms">${escapeHtml(card.english)} <span>·</span> ${escapeHtml(card.pastSimple)} <span>·</span> ${escapeHtml(card.pastParticiple)}</p>` : '';
  return `<button class="flashcard face-back" data-action="flip" aria-label="Скрыть ответ"><span class="card-kicker">ОТВЕТ</span><span class="answer-english">${escapeHtml(card.english)}</span>${card.transcription ? `<span class="transcription">${escapeHtml(card.transcription)}</span>` : ''}<span class="answer-russian">${escapeHtml(card.russian)}</span>${verbForms}${card.exampleEn ? `<span class="example">${escapeHtml(card.exampleEn)}</span>` : ''}${card.exampleRu ? `<span class="example example-ru">${escapeHtml(card.exampleRu)}</span>` : ''}</button>`;
}

function renderStudy() {
  const dictionary = activeDictionary();
  if (!dictionary) return `<section class="empty-state"><div class="empty-mark">Aa</div><p class="eyebrow">ВАША ЛИЧНАЯ ЛЕКСИКА</p><h1>Слова запоминаются<br>в своём ритме.</h1><p class="empty-copy">Добавьте словарь Excel, чтобы начать повторение.</p><button class="button button-primary" data-action="add-dictionary">＋ Добавить словарь из Excel</button><p class="privacy-note">Слова и прогресс остаются на этом устройстве.</p></section>`;
  return `<section class="study-shell"><header class="topbar"><a class="brand" href="#" data-action="home"><span class="brand-mark">l.</span><span>Лексика</span></a><div class="dictionary-heading"><span class="eyebrow">АКТИВНЫЙ СЛОВАРЬ</span><strong>${escapeHtml(dictionary.name)}</strong></div><button class="icon-button settings-trigger" data-action="settings" aria-label="Настройки" title="Настройки"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z"/><path d="m19.4 13.5 1.1.8-1.1 1.9-1.3-.5a7.8 7.8 0 0 1-1.6.9l-.2 1.4h-2.2l-.3-1.4a7.8 7.8 0 0 1-1.7-.1l-.9 1.1-1.9-1.1.5-1.3a7.8 7.8 0 0 1-.9-1.6l-1.4-.2v-2.2l1.4-.3a7.8 7.8 0 0 1 .1-1.7l-1.1-.9 1.1-1.9 1.3.5a7.8 7.8 0 0 1 1.6-.9l.2-1.4h2.2l.3 1.4a7.8 7.8 0 0 1 1.7.1l.9-1.1 1.9 1.1-.5 1.3a7.8 7.8 0 0 1 .9 1.6l1.4.2v2.2l-1.4.3a7.8 7.8 0 0 1-.1 1.7Z"/></svg></button></header><div class="study-body"><div class="study-meta"><span class="mode-dot"></span><span>${labels.direction[state.settings.direction]} <span class="meta-divider">·</span> ${labels.priority[state.settings.priority]}</span></div>${state.activeCard ? `<div class="card-stage">${renderCardFace()}</div><div class="rating-actions"><button class="button button-dont" data-action="rate" data-correct="false" ${state.busy ? 'disabled' : ''}><span class="rating-icon">×</span> Не знаю</button><button class="button button-know" data-action="rate" data-correct="true" ${state.busy ? 'disabled' : ''}><span class="rating-icon">✓</span> Знаю</button></div><p class="privacy-note study-note">Оценка сохраняется только после нажатия</p>` : `<div class="empty-dictionary"><p>В этом словаре пока нет карточек.</p><button class="button button-primary" data-action="settings">Открыть настройки</button></div>`}</div><footer class="study-footer"><span>${dictionaryCards().length} ${pluralCards(dictionaryCards().length)}</span><span>ПОВТОРЕНИЕ БЕЗ СПЕШКИ</span></footer></section>`;
}

function pluralCards(count) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'карточек';
  if (last === 1) return 'карточка';
  return last >= 2 && last <= 4 ? 'карточки' : 'карточек';
}

function renderSettings() {
  const dictionaries = state.snapshot.dictionaries;
  return `<div class="overlay" data-action="close-settings"><section class="settings-panel" role="dialog" aria-modal="true" aria-label="Настройки"><header class="panel-header"><div><p class="eyebrow">ПЕРСОНАЛЬНОЕ ПРОСТРАНСТВО</p><h2>Настройки</h2></div><button class="icon-button" data-action="close-settings" aria-label="Закрыть">×</button></header><section class="settings-section"><div class="section-title"><span class="section-index">01</span><h3>Словарь</h3></div>${dictionaries.length ? `<div class="dictionary-list">${dictionaries.map((dictionary) => `<div class="dictionary-row ${dictionary.id === state.settings.activeDictionaryId ? 'is-active' : ''}"><button class="dictionary-select" data-action="select-dictionary" data-id="${escapeHtml(dictionary.id)}"><span class="dictionary-radio"></span><span>${escapeHtml(dictionary.name)}</span><small>${state.snapshot.dictionaryCards.filter((link) => link.dictionaryId === dictionary.id).length}</small></button><button class="row-menu" data-action="dictionary-menu" data-id="${escapeHtml(dictionary.id)}" aria-label="Действия со словарём">•••</button></div>`).join('')}</div>` : '<p class="muted">Словарей пока нет</p>'}<div class="dictionary-tools"><button class="text-button" data-action="add-dictionary">＋ Добавить из Excel</button>${activeDictionary() ? '<button class="text-button" data-action="update-dictionary">Обновить из Excel</button>' : ''}</div></section><section class="settings-section"><div class="section-title"><span class="section-index">02</span><h3>Направление</h3></div><div class="segmented">${[['en', 'English'], ['ru', 'Русский'], ['mixed', 'Смешанное']].map(([value, text]) => `<button data-action="setting" data-key="direction" data-value="${value}" class="${state.settings.direction === value ? 'selected' : ''}">${text}</button>`).join('')}</div></section><section class="settings-section"><div class="section-title"><span class="section-index">03</span><h3>Порядок слов</h3></div><div class="option-list">${[['random', 'Вперемешку', 'Все слова с одинаковой частотой'], ['new', 'Сначала новые', 'Новые слова появляются чаще'], ['hard', 'Сначала сложные', 'Чаще повторяются слова с ошибками']].map(([value, title, subtitle]) => `<button class="option-row ${state.settings.priority === value ? 'selected' : ''}" data-action="setting" data-key="priority" data-value="${value}"><span class="option-radio"></span><span><strong>${title}</strong><small>${subtitle}</small></span></button>`).join('')}</div></section><section class="settings-section settings-last"><div class="section-title"><span class="section-index">04</span><h3>Данные</h3></div><div class="data-actions"><button class="data-action" data-action="stats"><span class="data-icon">↗</span>Статистика</button><button class="data-action" data-action="export"><span class="data-icon">↓</span>Сохранить резервную копию</button><button class="data-action" data-action="restore"><span class="data-icon">↑</span>Восстановить данные</button><input id="restore-file" type="file" accept="application/json,.json" hidden></div><p class="data-warning">Данные хранятся только на этом устройстве. Очистка браузера или смена телефона может удалить их без резервной копии.</p></section></section></div>`;
}

function renderStats() {
  const allCards = state.snapshot.cards.filter((card) => state.snapshot.dictionaryCards.some((link) => link.cardId === card.id));
  const dictionaries = state.snapshot.dictionaries;
  const progress = progressMap();
  const currentDictionary = state.snapshot.dictionaries.find((item) => item.id === state.modal?.dictionaryId) ?? null;
  const cards = currentDictionary ? dictionaryCards(currentDictionary.id) : allCards;
  const summary = summarizeCards(cards, progress);
  const title = currentDictionary ? currentDictionary.name : 'Все словари';
  return `<div class="overlay stats-overlay"><section class="settings-panel stats-panel" role="dialog" aria-modal="true"><header class="panel-header"><button class="back-button" data-action="settings">←</button><div><p class="eyebrow">ИСТОРИЯ ПОВТОРЕНИЯ</p><h2>Статистика</h2></div></header><div class="stats-picker"><label for="stats-dictionary">Показывать</label><select id="stats-dictionary"><option value="all" ${!currentDictionary ? 'selected' : ''}>Все словари</option>${dictionaries.map((dictionary) => `<option value="${escapeHtml(dictionary.id)}" ${dictionary.id === currentDictionary?.id ? 'selected' : ''}>${escapeHtml(dictionary.name)}</option>`).join('')}</select></div><div class="stats-heading"><h3>${escapeHtml(title)}</h3><span>${summary.total ? `${Math.round(summary.learned / summary.total * 100)}% выучено` : 'Пока нет слов'}</span></div><div class="stats-summary"><div><strong>${summary.total}</strong><span>Всего</span></div><div><strong>${summary.learned}</strong><span>Выучено</span></div><div><strong>${summary.learning}</strong><span>Изучается</span></div><div><strong>${summary.notStarted}</strong><span>Не начато</span></div></div><div class="word-table-wrap"><table><thead><tr><th>Слово</th><th>Показов</th><th>Верных ответов</th><th>Статус</th></tr></thead><tbody>${cards.map((card) => { const item = progress.get(card.id); const attempts = item?.attemptsCount ?? 0; const percent = attempts ? `${Math.round(item.correctCount / attempts * 100)}%` : '—'; return `<tr><td><strong>${escapeHtml(card.english)}</strong><small>${escapeHtml(card.russian)}</small></td><td>${attempts}</td><td>${percent}</td><td><span class="status status-${getStatus(item)}">${labels.status[getStatus(item)]}</span></td></tr>`; }).join('')}</tbody></table></div></section></div>`;
}

function renderModal() {
  const modal = state.modal;
  if (!modal) return '';
  if (modal.type === 'dictionary-menu') return `<div class="overlay modal-overlay" data-action="close-modal"><section class="confirm-dialog" role="dialog" aria-modal="true"><button class="icon-button modal-close" data-action="close-modal" aria-label="Закрыть">×</button><p class="eyebrow">СЛОВАРЬ</p><h2>${escapeHtml(modal.dictionary.name)}</h2><button class="data-action" data-action="rename-dictionary">Переименовать</button><button class="data-action" data-action="update-specific">Обновить из Excel</button><button class="data-action destructive" data-action="delete-dictionary">Удалить словарь</button></section></div>`;
  if (modal.type === 'rename') return `<div class="overlay modal-overlay" data-action="close-modal"><section class="confirm-dialog" role="dialog" aria-modal="true"><p class="eyebrow">ИЗМЕНИТЬ НАЗВАНИЕ</p><h2>Название словаря</h2><input id="rename-input" class="text-input" value="${escapeHtml(modal.dictionary.name)}" maxlength="80"><div class="dialog-actions"><button class="button button-secondary" data-action="close-modal">Отмена</button><button class="button button-primary" data-action="rename-confirm">Сохранить</button></div></section></div>`;
  if (modal.type === 'import') return renderImportModal(modal);
  if (modal.type === 'confirm-delete') return `<div class="overlay modal-overlay"><section class="confirm-dialog" role="dialog" aria-modal="true"><p class="eyebrow">УДАЛЕНИЕ СЛОВАРЯ</p><h2>Удалить «${escapeHtml(modal.dictionary.name)}»?</h2><p class="muted">Карточки, которые используются в других словарях, останутся на месте.</p><div class="dialog-actions"><button class="button button-secondary" data-action="close-modal">Отмена</button><button class="button button-danger" data-action="delete-confirm">Удалить словарь</button></div></section></div>`;
  if (modal.type === 'confirm-restore') return `<div class="overlay modal-overlay"><section class="confirm-dialog" role="dialog" aria-modal="true"><p class="eyebrow">ВОССТАНОВЛЕНИЕ ДАННЫХ</p><h2>Заменить текущие данные?</h2><p class="muted">Все локальные словари, настройки и прогресс будут заменены резервной копией.</p><div class="dialog-actions"><button class="button button-secondary" data-action="close-modal">Отмена</button><button class="button button-primary" data-action="restore-confirm">Заменить данные</button></div></section></div>`;
  return '';
}

function renderImportModal(modal) {
  if (modal.loading) return `<div class="overlay modal-overlay"><section class="confirm-dialog"><p class="eyebrow">ЧТЕНИЕ EXCEL</p><h2>Проверяю таблицу…</h2></section></div>`;
  const result = modal.analysis;
  if (modal.error) return `<div class="overlay modal-overlay"><section class="confirm-dialog" role="dialog" aria-modal="true"><p class="eyebrow">НЕ УДАЛОСЬ ПРОЧИТАТЬ ФАЙЛ</p><h2>Проверьте файл Excel</h2><p class="error-message">${escapeHtml(modal.error)}</p><button class="button button-primary" data-action="close-modal">Понятно</button></section></div>`;
  return `<div class="overlay modal-overlay import-overlay"><section class="confirm-dialog import-dialog" role="dialog" aria-modal="true"><header class="panel-header"><div><p class="eyebrow">ПРЕДПРОСМОТР ФАЙЛА</p><h2>${modal.dictionaryId ? 'Обновить словарь' : 'Новый словарь'}</h2></div><button class="icon-button" data-action="close-modal" aria-label="Закрыть">×</button></header><label class="field-label" for="dictionary-name">Название словаря</label><input id="dictionary-name" class="text-input" maxlength="80" value="${escapeHtml(modal.name)}"><div class="import-counts"><div><strong>${result.uniqueCount}</strong><span>уникальных пар</span></div><div><strong>${result.duplicateCount}</strong><span>дублей в файле</span></div><div><strong>${result.knownCount}</strong><span>уже известных</span></div><div><strong>${result.newCount}</strong><span>новых карточек</span></div>${modal.dictionaryId ? `<div><strong>${result.canRemoveMissing ? result.removedCount : '—'}</strong><span>будут удалены</span></div>` : ''}</div>${result.errors.length ? `<div class="import-notice error-notice"><strong>Ошибки: ${result.errors.length}</strong>${result.errors.map((row) => `<p>Строка ${row.rowNumber}: ${escapeHtml(row.errors.join(', '))}</p>`).join('')}</div>` : ''}${result.warnings.length ? `<div class="import-notice warning-notice"><strong>Предупреждения: ${result.warnings.length}</strong>${result.warnings.map((item) => `<p>Строка ${item.rowNumber}: ${escapeHtml(item.message)}</p>`).join('')}</div>` : ''}${result.conflicts.length ? `<div class="import-notice warning-notice"><strong>Заполненные дополнительные поля отличаются</strong><p>${result.conflicts.map((item) => `${escapeHtml(item.english)} — ${escapeHtml(item.russian)}`).join('<br>')}</p><label class="check-row"><input id="replace-conflicts" type="checkbox"> Заменить отличающиеся заполненные поля</label></div>` : ''}${modal.dictionaryId && result.removedCount && !result.canRemoveMissing ? '<p class="error-message">Из-за ошибок строк отсутствующие карточки не будут удалены.</p>' : ''}<div class="import-preview"><div class="preview-head"><span>СОСТАВ СПИСКА</span><span>${result.rowCount} строк · ${result.uniqueCount} уникальных пар</span></div>${result.rows.map((row) => `<div class="preview-row"><span><strong>${escapeHtml(row.english)}</strong><small>${escapeHtml(row.russian)}</small></span>${row.warnings.length ? '<span class="warning-dot" title="Неполные формы глагола">!</span>' : ''}</div>`).join('')}${result.errors.map((row) => `<div class="preview-row invalid-row"><span><strong>Строка ${row.rowNumber} · не импортируется</strong><small>${escapeHtml(row.errors.join(', '))}</small></span></div>`).join('')}</div><div class="dialog-actions"><button class="button button-secondary" data-action="close-modal">Отмена</button><button class="button button-primary" data-action="import-confirm" ${!result.uniqueCount ? 'disabled' : ''}>${modal.dictionaryId ? 'Подтвердить обновление' : 'Добавить словарь'}</button></div></section></div>`;
}

function render() {
  if (!state.snapshot) {
    app.innerHTML = '<div class="loading-state">Загружаю словари…</div>';
    return;
  }
  app.innerHTML = `${state.view === 'stats' ? renderStats() : state.view === 'settings' ? `${renderStudy()}${renderSettings()}` : renderStudy()}${renderModal()}${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ''}`;
}

function showToast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    state.toast = '';
    render();
  }, 2600);
}

async function startImport(file, dictionaryId = null) {
  if (!file) return;
  state.modal = { type: 'import', loading: true };
  render();
  try {
    const rows = await parseExcelFile(file);
    const snapshot = await loadSnapshot();
    const dictionary = snapshot.dictionaries.find((item) => item.id === dictionaryId);
    const previousCards = dictionary ? snapshot.dictionaryCards.filter((link) => link.dictionaryId === dictionaryId).map((link) => snapshot.cards.find((card) => card.id === link.cardId)).filter(Boolean) : [];
    state.modal = {
      type: 'import',
      dictionaryId,
      name: dictionary?.name ?? file.name.replace(/\.xlsx$/i, ''),
      analysis: analyzeImport(rows, snapshot.cards, previousCards),
    };
  } catch (error) {
    state.modal = { type: 'import', error: error.message || 'Не удалось прочитать файл' };
  }
  render();
}

function makeBackup(snapshot) {
  return {
    format: 'english-trainer-backup',
    formatVersion: 1,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    ...snapshot,
  };
}

function validateBackup(data) {
  const expected = ['cards', 'dictionaries', 'dictionaryCards', 'trainerProgress', 'settings', 'selectionRecent'];
  if (!data || data.format !== 'english-trainer-backup' || data.formatVersion !== 1 || data.schemaVersion !== 1) throw new Error('Неизвестный формат или версия резервной копии');
  if (expected.some((key) => !Array.isArray(data[key]))) throw new Error('В резервной копии отсутствуют необходимые данные');
  const cardIds = new Set(data.cards.map((card) => card.id));
  const dictionaryIds = new Set(data.dictionaries.map((dictionary) => dictionary.id));
  if (data.dictionaryCards.some((link) => !cardIds.has(link.cardId) || !dictionaryIds.has(link.dictionaryId))) throw new Error('В резервной копии есть связи на отсутствующие данные');
  if (data.trainerProgress.some((item) => !cardIds.has(item.cardId) || item.attemptsCount !== item.correctCount + item.incorrectCount || item.recentResults.length > 20)) throw new Error('В резервной копии обнаружена некорректная статистика');
  return Object.fromEntries(expected.map((key) => [key, data[key]]));
}

async function handleAction(action, target) {
  if (state.busy && action !== 'close-modal') return;
  if (action === 'flip') { state.face = state.face === 'front' ? 'back' : 'front'; render(); return; }
  if (action === 'settings') { state.view = 'settings'; state.modal = null; render(); return; }
  if (action === 'close-settings') { if (target.closest('.settings-panel') && target.tagName !== 'BUTTON') return; state.view = 'study'; render(); return; }
  if (action === 'home') { state.view = 'study'; state.modal = null; render(); return; }
  if (action === 'close-modal') { state.modal = null; render(); return; }
  if (action === 'add-dictionary') { const input = document.querySelector('#excel-file'); input.dataset.dictionaryId = ''; input.click(); return; }
  if (action === 'update-dictionary') { const input = document.querySelector('#excel-file'); input.dataset.dictionaryId = state.settings.activeDictionaryId; input.click(); return; }
  if (action === 'choose-file') { document.querySelector('#excel-file')?.click(); return; }
  if (action === 'select-dictionary') {
    await saveSettings({ activeDictionaryId: target.dataset.id });
    state.settings.activeDictionaryId = target.dataset.id;
    state.modal = null;
    state.view = 'study';
    state.activeCard = null;
    await reload({ choose: true });
    return;
  }
  if (action === 'setting') {
    await saveSettings({ [target.dataset.key]: target.dataset.value });
    state.settings[target.dataset.key] = target.dataset.value;
    render();
    return;
  }
  if (action === 'dictionary-menu') {
    const dictionary = state.snapshot.dictionaries.find((item) => item.id === target.dataset.id);
    state.modal = { type: 'dictionary-menu', dictionary };
    render();
    return;
  }
  if (action === 'rename-dictionary') {
    state.modal = { type: 'rename', dictionary: state.modal.dictionary };
    render();
    return;
  }
  if (action === 'rename-confirm') {
    const name = document.querySelector('#rename-input').value.trim();
    if (!name) return;
    const database = await openDatabase();
    const transaction = database.transaction('dictionaries', 'readwrite');
    const store = transaction.objectStore('dictionaries');
    const dictionary = await new Promise((resolve, reject) => { const request = store.get(state.modal.dictionary.id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    store.put({ ...dictionary, name, updatedAt: new Date().toISOString() });
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
    state.modal = null;
    await reload();
    return;
  }
  if (action === 'update-specific') { const input = document.querySelector('#excel-file'); input.dataset.dictionaryId = state.modal.dictionary.id; input.click(); return; }
  if (action === 'delete-dictionary') { state.modal = { type: 'confirm-delete', dictionary: state.modal.dictionary }; render(); return; }
  if (action === 'delete-confirm') {
    await removeDictionary(state.modal.dictionary.id);
    state.modal = null;
    state.view = 'study';
    state.activeCard = null;
    await reload({ choose: true });
    return;
  }
  if (action === 'import-confirm') {
    const modal = state.modal;
    const name = document.querySelector('#dictionary-name').value.trim();
    if (!name) { showToast('Введите название словаря'); return; }
    const replaceConflicts = Boolean(document.querySelector('#replace-conflicts')?.checked);
    await applyDictionaryImport({ dictionaryId: modal.dictionaryId, name, rows: modal.analysis.rows, replaceComposition: Boolean(modal.dictionaryId && modal.analysis.canRemoveMissing), replaceConflicts });
    state.modal = null;
    state.view = 'study';
    state.activeCard = null;
    await reload({ choose: true });
    return;
  }
  if (action === 'stats') { state.view = 'stats'; state.modal = { dictionaryId: null }; render(); return; }
  if (action === 'export') {
    const snapshot = await loadSnapshot();
    const blob = new Blob([JSON.stringify(makeBackup(snapshot), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `english-trainer-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('Резервная копия сохранена');
    return;
  }
  if (action === 'restore') { document.querySelector('#restore-file')?.click(); return; }
  if (action === 'restore-confirm') {
    await replaceSnapshot(state.modal.snapshot);
    state.modal = null;
    state.view = 'study';
    state.activeCard = null;
    await reload({ choose: true });
    return;
  }
  if (action === 'rate') {
    if (!state.activeCard || state.busy) return;
    state.busy = true;
    render();
    await recordRating(state.activeCard.id, target.dataset.correct === 'true');
    await reload({ choose: true });
    state.busy = false;
    render();
  }
}

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  handleAction(button.dataset.action, button).catch((error) => {
    state.busy = false;
    state.modal = null;
    showToast(error.message || 'Не удалось выполнить действие');
  });
});

document.body.addEventListener('change', async (event) => {
  if (event.target.id === 'excel-file') {
    const file = event.target.files?.[0];
    const dictionaryId = event.target.dataset.dictionaryId || null;
    event.target.dataset.dictionaryId = '';
    event.target.value = '';
    if (file) await startImport(file, dictionaryId);
  }
  if (event.target.id === 'stats-dictionary') {
    state.modal = { dictionaryId: event.target.value === 'all' ? null : event.target.value };
    render();
  }
  if (event.target.id === 'restore-file') {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const backup = validateBackup(JSON.parse(await file.text()));
      state.modal = { type: 'confirm-restore', snapshot: backup };
    } catch (error) {
      state.modal = { type: 'import', error: error.message || 'Резервная копия повреждена' };
    }
    render();
  }
});

document.body.insertAdjacentHTML('beforeend', '<input id="excel-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>');

async function start() {
  try {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
    }
    await refreshSnapshot();
    render();
    await selectCard(true);
  } catch (error) {
    app.innerHTML = `<section class="empty-state"><p class="eyebrow">ЛОКАЛЬНОЕ ХРАНИЛИЩЕ</p><h1>Не удалось открыть приложение</h1><p class="empty-copy">${escapeHtml(error.message)}</p></section>`;
  }
}

start();