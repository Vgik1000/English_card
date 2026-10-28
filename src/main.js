import {
  chooseNextCard,
  getStatus,
  getStatsSort,
  toggleStatsSort,
  nextRecentIds,
  sortStatsCards,
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
  replaceSnapshot,
  saveRecent,
  saveSettings,
} from './db.js';
import { analyzeImport, parseExcelFile } from './importer.js';
import { getImportErrorMessage } from './import-errors.js';
import { makeBackup, validateBackup } from './backup.js';
import { registerOffline } from './offline.js';
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
  statsSort: [],
  offlineMessage: '',
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

function renderIcon(name) {
  const paths = {
    settings: '<path d="m9 3-.5 2.2-1.7 1-2.1-.7-2 3.5 1.6 1.5v2L2.7 14l2 3.5 2.1-.7 1.7 1L9 20h4l.5-2.2 1.7-1 2.1.7 2-3.5-1.6-1.5v-2L19.3 9l-2-3.5-2.1.7-1.7-1L13 3Z" transform="translate(1 0.5)"/><circle cx="12" cy="12" r="3"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    chart: '<path d="M5 20v-6M12 20V9M19 20V4"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
    upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="M19 12H5m7-7-7 7 7 7"/>',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;
}

function renderCardFace() {
  if (!state.activeCard) return '';
  const card = state.activeCard;
  if (state.face === 'front') {
    const showEnglish = state.showEnglish;
    return `<button class="flashcard face-front" data-action="flip" aria-label="Показать перевод"><span class="front-content"><span class="card-word">${escapeHtml(showEnglish ? card.english : card.russian)}</span><span class="card-hint">Нажмите, чтобы открыть ответ</span></span></button>`;
  }
  const hasVerbForms = Boolean(card.pastSimple && card.pastParticiple);
  const heading = hasVerbForms ? [card.english, card.pastSimple, card.pastParticiple].join(' — ') : card.english;
  const examples = card.exampleEn || card.exampleRu ? `<span class="card-examples">${card.exampleEn ? `<span class="example">${escapeHtml(card.exampleEn)}</span>` : ''}${card.exampleRu ? `<span class="example example-ru">${escapeHtml(card.exampleRu)}</span>` : ''}</span>` : '';
  return `<button class="flashcard face-back" data-action="flip" aria-label="Скрыть ответ"><span class="answer-content"><span class="answer-english${hasVerbForms ? ' answer-verb' : ''}">${escapeHtml(heading)}</span>${card.transcription ? `<span class="transcription">${escapeHtml(card.transcription)}</span>` : ''}<span class="answer-russian">${escapeHtml(card.russian)}</span>${examples}</span></button>`;
}

function renderOfflineStatus() {
  return `<p class="privacy-note" data-offline-status ${state.offlineMessage ? '' : 'hidden'}>${escapeHtml(state.offlineMessage)}</p>`;
}

function renderStudy() {
  const dictionary = activeDictionary();
  const cardCount = dictionaryCards().length;
  if (!dictionary) return `<section class="empty-state"><div class="empty-mark">Aa</div><p class="eyebrow">ВАША ЛИЧНАЯ ЛЕКСИКА</p><h1>Слова запоминаются<br>в своём ритме.</h1><p class="empty-copy">Добавьте словарь Excel, чтобы начать повторение.</p><button class="button button-primary" data-action="add-dictionary">＋ Добавить словарь из Excel</button><button class="button button-secondary" data-action="restore">Восстановить из резервной копии</button><p class="privacy-note">Слова и прогресс остаются на этом устройстве.</p>${renderOfflineStatus()}</section>`;
  return `<section class="study-shell"><header class="topbar"><a class="brand" href="#" data-action="home" aria-label="Лексика — карточки"><span class="brand-mark" aria-hidden="true">l.</span></a><div class="dictionary-heading"><strong title="${escapeHtml(dictionary.name)}">${escapeHtml(dictionary.name)}</strong><span class="dictionary-count">${cardCount} ${pluralCards(cardCount)}</span></div><button class="icon-button settings-trigger" data-action="settings" aria-label="Настройки" title="Настройки">${renderIcon('settings')}</button></header><div class="study-body"><div class="study-meta"><span>${labels.direction[state.settings.direction]} <span class="meta-divider">·</span> ${labels.priority[state.settings.priority]}</span></div>${state.activeCard ? `<div class="card-stage">${renderCardFace()}</div><div class="rating-actions"><button class="button button-dont" data-action="rate" data-correct="false" ${state.busy ? 'disabled' : ''}>${renderIcon('close')} Не знаю</button><button class="button button-know" data-action="rate" data-correct="true" ${state.busy ? 'disabled' : ''}>${renderIcon('check')} Знаю</button></div>` : `<div class="empty-dictionary"><p>В этом словаре пока нет карточек.</p><button class="button button-primary" data-action="settings">Открыть настройки</button></div>`}</div></section>`;
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
  const dictionaryList = dictionaries.length ? `<div class="dictionary-list">${dictionaries.map((dictionary) => {
    const count = state.snapshot.dictionaryCards.filter((link) => link.dictionaryId === dictionary.id).length;
    const selected = dictionary.id === state.settings.activeDictionaryId;
    return `<div class="dictionary-row ${selected ? 'is-active' : ''}">
      <button class="dictionary-select" data-action="select-dictionary" data-id="${escapeHtml(dictionary.id)}" aria-pressed="${selected}">
        <span class="dictionary-radio" aria-hidden="true"></span>
        <span class="dictionary-info"><strong>${escapeHtml(dictionary.name)}</strong><small>${count} ${pluralCards(count)}</small></span>
      </button>
      <button class="row-menu" data-action="dictionary-menu" data-id="${escapeHtml(dictionary.id)}" aria-label="Действия со словарём ${escapeHtml(dictionary.name)}">${renderIcon('more')}</button>
    </div>`;
  }).join('')}</div>` : '<p class="muted">Словарей пока нет</p>';
  return `<div class="overlay" data-action="close-settings">
    <section class="settings-panel" role="dialog" aria-modal="true" aria-label="Настройки">
      <header class="panel-header"><h2>Настройки</h2><button class="icon-button" data-action="close-settings" aria-label="Закрыть">${renderIcon('close')}</button></header>
      <section class="settings-section">
        <div class="section-title"><h3>Словари</h3></div>
        ${dictionaryList}
        <div class="dictionary-tools">
          <button class="text-button add-dictionary-button" data-action="add-dictionary"><span class="add-icon">${renderIcon('plus')}</span>Добавить из Excel</button>
          ${activeDictionary() ? '<button class="text-button" data-action="update-dictionary">Обновить из Excel</button>' : ''}
        </div>
      </section>
      <section class="settings-section">
        <div class="section-title"><h3>Направление</h3></div>
        <div class="segmented">${[['en', 'English'], ['ru', 'Русский'], ['mixed', 'Смешанное']].map(([value, text]) => `<button data-action="setting" data-key="direction" data-value="${value}" aria-pressed="${state.settings.direction === value}" class="${state.settings.direction === value ? 'selected' : ''}">${text}</button>`).join('')}</div>
        <p class="control-help">Выберите язык лицевой стороны</p>
      </section>
      <section class="settings-section">
        <div class="section-title"><h3>Порядок слов</h3></div>
        <div class="option-list">${[['random', 'Вперемешку', 'Все слова с одинаковой частотой'], ['new', 'Сначала новые', 'Новые слова появляются чаще'], ['hard', 'Сначала сложные', 'Чаще повторяются слова с ошибками']].map(([value, title, subtitle]) => `<button class="option-row ${state.settings.priority === value ? 'selected' : ''}" data-action="setting" data-key="priority" data-value="${value}" aria-pressed="${state.settings.priority === value}"><span class="option-radio" aria-hidden="true"></span><span><strong>${title}</strong><small>${subtitle}</small></span></button>`).join('')}</div>
      </section>
      <section class="settings-section settings-last">
        <div class="section-title"><h3>Данные</h3></div>
        <div class="data-actions">${[['stats', 'chart', 'Статистика'], ['export', 'download', 'Сохранить резервную копию'], ['restore', 'upload', 'Восстановить данные']].map(([action, icon, text]) => `<button class="data-action" data-action="${action}"><span class="data-icon">${renderIcon(icon)}</span><span class="data-label">${text}</span><span class="data-chevron">${renderIcon('chevron')}</span></button>`).join('')}
        </div>
        ${renderOfflineStatus()}
        <p class="control-help">Настройки сохраняются автоматически.</p>
        <p class="settings-help">Оценка сохраняется только после нажатия «Знаю» или «Не знаю». Переворот карточки не влияет на статистику.</p>
        <p class="data-warning">Данные хранятся только на этом устройстве. Очистка браузера или смена телефона может удалить их без резервной копии.</p>
      </section>
    </section>
  </div>`;
}

function renderStats() {
  const allCards = state.snapshot.cards.filter((card) => state.snapshot.dictionaryCards.some((link) => link.cardId === card.id));
  const dictionaries = state.snapshot.dictionaries;
  const progress = progressMap();
  const currentDictionary = dictionaries.find((item) => item.id === state.modal?.dictionaryId) ?? null;
  const cards = currentDictionary ? dictionaryCards(currentDictionary.id) : allCards;
  const summary = summarizeCards(cards, progress);
  const title = currentDictionary ? currentDictionary.name : 'Все словари';
  const sorting = getStatsSort(state.statsSort);
  const sortedCards = sortStatsCards(cards, progress, sorting);
  const sortHeader = (key, label) => {
    const index = sorting.findIndex((criterion) => criterion.key === key);
    const active = index >= 0;
    const ascending = active && sorting[index].direction === 'asc';
    const nextDirection = active && !ascending ? 'возрастанию' : 'убыванию';
    const description = active ? `Приоритет ${index + 1}, по ${ascending ? 'возрастанию' : 'убыванию'}. ` : '';
    return `<th scope="col"${index === 0 ? ` aria-sort="${ascending ? 'ascending' : 'descending'}"` : ''}><button class="table-sort-button ${active ? 'is-sorted' : ''}" data-action="stats-sort" data-key="${key}" title="${description}Нажмите для сортировки по ${nextDirection}" aria-label="${label}. ${description}Сортировать по ${nextDirection}"><span>${label}</span><span aria-hidden="true">${active ? (ascending ? '↑' : '↓') : '↕'}</span>${active && sorting.length > 1 ? `<span class="sort-priority" aria-hidden="true">${index + 1}</span>` : ''}</button></th>`;
  };
  const rows = sortedCards.map((card) => {
    const item = progress.get(card.id);
    const attempts = item?.attemptsCount ?? 0;
    const percent = attempts ? `${Math.round(item.correctCount / attempts * 100)}%` : '—';
    const status = getStatus(item);
    return `<tr><td class="word-cell"><strong>${escapeHtml(card.english)}</strong><small>${escapeHtml(card.russian)}</small></td><td class="numeric-cell">${percent}</td><td class="numeric-cell">${attempts}</td><td><span class="status status-${status}">${labels.status[status]}</span></td></tr>`;
  }).join('');
  return `<div class="overlay stats-overlay"><section class="settings-panel stats-panel" role="dialog" aria-modal="true" aria-label="Статистика">
    <header class="panel-header"><button class="back-button" data-action="settings" aria-label="Назад к настройкам">${renderIcon('back')}</button><h2>Статистика</h2></header>
    <div class="stats-picker"><label for="stats-dictionary">Показывать</label><select id="stats-dictionary"><option value="all" ${!currentDictionary ? 'selected' : ''}>Все словари</option>${dictionaries.map((dictionary) => `<option value="${escapeHtml(dictionary.id)}" ${dictionary.id === currentDictionary?.id ? 'selected' : ''}>${escapeHtml(dictionary.name)}</option>`).join('')}</select></div>
    <div class="stats-heading"><h3>${escapeHtml(title)}</h3><span>${summary.total ? `${Math.round(summary.learned / summary.total * 100)}% выучено` : 'Пока нет слов'}</span></div>
    <div class="stats-summary"><div><strong>${summary.total}</strong><span>Всего</span></div><div><strong>${summary.learned}</strong><span>Выучено</span></div><div><strong>${summary.learning}</strong><span>Изучается</span></div><div><strong>${summary.notStarted}</strong><span>Не начато</span></div></div>
    <div class="stats-table-toolbar"><button class="stats-sort-reset" data-action="stats-sort-reset" title="Показы: от большего к меньшему">Сбросить порядок</button></div>
    <div class="word-table-wrap" tabindex="0" role="region" aria-label="Таблица статистики слов"><table class="word-table" aria-label="Статистика слов">
      <colgroup><col class="word-column"><col class="correct-column"><col class="attempts-column"><col class="status-column"></colgroup>
      <thead><tr><th scope="col">Слово</th>${sortHeader('correct', '% верных')}${sortHeader('attempts', 'Показы')}<th scope="col">Статус</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="stats-empty">В этом списке пока нет слов.</td></tr>'}</tbody>
    </table></div>
  </section></div>`;
}

function refreshStatsView(focusSelector) {
  const scrollTop = app.querySelector('.stats-panel')?.scrollTop ?? 0;
  const scrollLeft = app.querySelector('.word-table-wrap')?.scrollLeft ?? 0;
  render();
  const panel = app.querySelector('.stats-panel');
  const table = app.querySelector('.word-table-wrap');
  if (panel) panel.scrollTop = scrollTop;
  if (table) table.scrollLeft = scrollLeft;
  app.querySelector(focusSelector)?.focus({ preventScroll: true });
}

function renderModal() {
  const modal = state.modal;
  if (!modal) return '';
  if (modal.type === 'dictionary-menu') return `<div class="overlay modal-overlay" data-action="close-modal"><section class="confirm-dialog" role="dialog" aria-modal="true"><button class="icon-button modal-close" data-action="close-modal" aria-label="Закрыть">${renderIcon('close')}</button><p class="eyebrow">СЛОВАРЬ</p><h2>${escapeHtml(modal.dictionary.name)}</h2><button class="data-action" data-action="rename-dictionary">Переименовать</button><button class="data-action" data-action="update-specific">Обновить из Excel</button><button class="data-action destructive" data-action="delete-dictionary">Удалить словарь</button></section></div>`;
  if (modal.type === 'rename') return `<div class="overlay modal-overlay" data-action="close-modal"><section class="confirm-dialog" role="dialog" aria-modal="true"><p class="eyebrow">ИЗМЕНИТЬ НАЗВАНИЕ</p><h2>Название словаря</h2><input id="rename-input" class="text-input" value="${escapeHtml(modal.dictionary.name)}" maxlength="80"><div class="dialog-actions"><button class="button button-secondary" data-action="close-modal">Отмена</button><button class="button button-primary" data-action="rename-confirm">Сохранить</button></div></section></div>`;
  if (modal.type === 'import') return renderImportModal(modal);
  if (modal.type === 'confirm-delete') return `<div class="overlay modal-overlay"><section class="confirm-dialog" role="dialog" aria-modal="true"><p class="eyebrow">УДАЛЕНИЕ СЛОВАРЯ</p><h2>Удалить «${escapeHtml(modal.dictionary.name)}»?</h2><p class="muted">Карточки, которые используются в других словарях, останутся на месте.</p><div class="dialog-actions"><button class="button button-secondary" data-action="close-modal">Отмена</button><button class="button button-danger" data-action="delete-confirm">Удалить словарь</button></div></section></div>`;
  if (modal.type === 'restore-loading') return `<div class="overlay modal-overlay"><section class="confirm-dialog" role="dialog" aria-modal="true"><p role="status">Проверяю резервную копию…</p></section></div>`;
  if (modal.type === 'restore-error') return `<div class="overlay modal-overlay"><section class="confirm-dialog" role="dialog" aria-modal="true"><p class="eyebrow">РЕЗЕРВНАЯ КОПИЯ</p><h2>Не удалось восстановить данные</h2><p class="error-message" role="alert">${escapeHtml(modal.error)}</p><p class="muted">Текущие данные не изменены.</p><div class="dialog-actions"><button class="button button-secondary" data-action="close-modal">Закрыть</button><button class="button button-primary" data-action="restore">Выбрать другой файл</button></div></section></div>`;
  if (modal.type === 'confirm-restore') return `<div class="overlay modal-overlay"><section class="confirm-dialog" role="dialog" aria-modal="true" aria-busy="${state.busy}"><p class="eyebrow">ВОССТАНОВЛЕНИЕ ДАННЫХ</p><h2>Заменить текущие данные?</h2><p class="muted">В копии: словарей — ${modal.snapshot.dictionaries.length}, карточек — ${modal.snapshot.cards.length}.</p><p class="muted">Все локальные словари, настройки и прогресс будут заменены резервной копией.</p><div class="dialog-actions"><button class="button button-secondary" data-action="close-modal" ${state.busy ? 'disabled' : ''}>Отмена</button><button class="button button-primary" data-action="restore-confirm" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Восстанавливаю…' : 'Заменить данные'}</button></div></section></div>`;
  return '';
}

function renderImportModal(modal) {
  if (modal.loading) return `<div class="overlay modal-overlay"><section class="confirm-dialog"><p class="eyebrow">ЧТЕНИЕ EXCEL</p><h2>Проверяю таблицу…</h2></section></div>`;
  const result = modal.analysis;
  if (modal.error) return `<div class="overlay modal-overlay"><section class="confirm-dialog" role="dialog" aria-modal="true"><p class="eyebrow">НЕ УДАЛОСЬ ПРОЧИТАТЬ ФАЙЛ</p><h2>Проверьте файл Excel</h2><p class="error-message">${escapeHtml(modal.error)}</p><button class="button button-primary" data-action="close-modal">Понятно</button></section></div>`;
  return `<div class="overlay modal-overlay import-overlay"><section class="confirm-dialog import-dialog" role="dialog" aria-modal="true"><header class="panel-header"><div><p class="eyebrow">ПРЕДПРОСМОТР ФАЙЛА</p><h2>${modal.dictionaryId ? 'Обновить словарь' : 'Новый словарь'}</h2></div><button class="icon-button" data-action="close-modal" aria-label="Закрыть">${renderIcon('close')}</button></header><label class="field-label" for="dictionary-name">Название словаря</label><input id="dictionary-name" class="text-input" maxlength="80" value="${escapeHtml(modal.name)}"><div class="import-counts"><div><strong>${result.uniqueCount}</strong><span>уникальных пар</span></div><div><strong>${result.duplicateCount}</strong><span>дублей в файле</span></div><div><strong>${result.knownCount}</strong><span>уже известных</span></div><div><strong>${result.newCount}</strong><span>новых карточек</span></div>${modal.dictionaryId ? `<div><strong>${result.canRemoveMissing ? result.removedCount : '—'}</strong><span>будут удалены</span></div>` : ''}</div>${result.errors.length ? `<div class="import-notice error-notice"><strong>Ошибки: ${result.errors.length}</strong>${result.errors.map((row) => `<p>Строка ${row.rowNumber}: ${escapeHtml(row.errors.join(', '))}</p>`).join('')}</div>` : ''}${result.warnings.length ? `<div class="import-notice warning-notice"><strong>Предупреждения: ${result.warnings.length}</strong>${result.warnings.map((item) => `<p>Строка ${item.rowNumber}: ${escapeHtml(item.message)}</p>`).join('')}</div>` : ''}${result.conflicts.length ? `<div class="import-notice warning-notice"><strong>Заполненные дополнительные поля отличаются</strong><p>${result.conflicts.map((item) => `${escapeHtml(item.english)} — ${escapeHtml(item.russian)}`).join('<br>')}</p><label class="check-row"><input id="replace-conflicts" type="checkbox"> Заменить отличающиеся заполненные поля</label></div>` : ''}${modal.dictionaryId && result.removedCount && !result.canRemoveMissing ? '<p class="error-message">Из-за ошибок строк отсутствующие карточки не будут удалены.</p>' : ''}<div class="import-preview"><div class="preview-head"><span>СОСТАВ СПИСКА</span><span>${result.rowCount} строк · ${result.uniqueCount} уникальных пар</span></div>${result.rows.map((row) => `<div class="preview-row"><span><strong>${escapeHtml(row.english)}</strong><small>${escapeHtml(row.russian)}</small></span>${row.warnings.length ? '<span class="warning-dot" title="Неполные формы глагола">!</span>' : ''}</div>`).join('')}${result.errors.map((row) => `<div class="preview-row invalid-row"><span><strong>Строка ${row.rowNumber} · не импортируется</strong><small>${escapeHtml(row.errors.join(', '))}</small></span></div>`).join('')}</div><div class="dialog-actions"><button class="button button-secondary" data-action="close-modal">Отмена</button><button class="button button-primary" data-action="import-confirm" ${!result.uniqueCount ? 'disabled' : ''}>${modal.dictionaryId ? 'Подтвердить обновление' : 'Добавить словарь'}</button></div></section></div>`;
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
    state.modal = { type: 'import', error: getImportErrorMessage(error) };
  }
  render();
}

async function handleAction(action, target) {
  if (state.busy && (action !== 'close-modal' || ['confirm-restore', 'restore-loading'].includes(state.modal?.type))) return;
  if (action === 'flip') { state.face = state.face === 'front' ? 'back' : 'front'; render(); return; }
  if (action === 'settings') { state.view = 'settings'; state.modal = null; render(); return; }
  if (action === 'close-settings') { state.view = 'study'; render(); return; }
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
  if (action === 'stats') { state.view = 'stats'; state.modal = { dictionaryId: null }; state.statsSort = []; render(); return; }
  if (action === 'stats-sort') {
    const key = target.dataset.key;
    if (!['correct', 'attempts'].includes(key)) return;
    state.statsSort = toggleStatsSort(state.statsSort, key);
    refreshStatsView(`.table-sort-button[data-key="${key}"]`);
    return;
  }
  if (action === 'stats-sort-reset') {
    state.statsSort = [];
    refreshStatsView('.stats-sort-reset');
    return;
  }
  if (action === 'export') {
    const snapshot = await loadSnapshot();
    const blob = new Blob([JSON.stringify(makeBackup(snapshot), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `english-trainer-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    showToast('Резервная копия готова к скачиванию');
    return;
  }
  if (action === 'restore') { document.querySelector('#restore-file')?.click(); return; }
  if (action === 'restore-confirm') {
    if (state.modal?.type !== 'confirm-restore') return;
    const snapshot = state.modal.snapshot;
    state.busy = true;
    render();
    try {
      await replaceSnapshot(snapshot);
    } catch (error) {
      state.busy = false;
      state.modal = { type: 'restore-error', error: error.message || 'Не удалось записать данные. Проверьте свободное место на устройстве.' };
      render();
      return;
    }
    state.modal = null;
    state.view = 'study';
    state.activeCard = null;
    state.settings = { direction: 'mixed', priority: 'random', activeTrainerId: 'flashcards' };
    try {
      await reload({ choose: true });
    } finally {
      state.busy = false;
      render();
    }
    showToast('Данные восстановлены');
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
  // Закрываем по фону только при нажатии на сам фон, а не внутри панели.
  if (button.classList.contains('overlay') && event.target !== button) return;
  handleAction(button.dataset.action, button).catch((error) => {
    state.busy = false;
    state.modal = null;
    showToast(error.message || 'Не удалось выполнить действие');
  });
});

document.body.addEventListener('change', async (event) => {
  if (state.busy) return;
  if (event.target.id === 'excel-file') {
    const file = event.target.files?.[0];
    const dictionaryId = event.target.dataset.dictionaryId || null;
    event.target.dataset.dictionaryId = '';
    event.target.value = '';
    if (file) await startImport(file, dictionaryId);
  }
  if (event.target.id === 'stats-dictionary') {
    state.modal = { dictionaryId: event.target.value === 'all' ? null : event.target.value };
    refreshStatsView('#stats-dictionary');
  }
  if (event.target.id === 'restore-file') {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    state.busy = true;
    state.modal = { type: 'restore-loading' };
    render();
    try {
      const backup = validateBackup(JSON.parse(await file.text()));
      state.modal = { type: 'confirm-restore', snapshot: backup };
    } catch (error) {
      state.modal = { type: 'restore-error', error: error instanceof SyntaxError ? 'Файл не является корректной резервной копией JSON.' : error.message || 'Резервная копия повреждена' };
    } finally {
      state.busy = false;
    }
    render();
  }
});

document.body.insertAdjacentHTML('beforeend', '<input id="restore-file" type="file" accept="application/json,.json" hidden><input id="excel-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>');

async function start() {
  try {
    await refreshSnapshot();
    render();
    await selectCard(true);
    if (import.meta.env.PROD) {
      void registerOffline(import.meta.env.BASE_URL, (message) => {
        state.offlineMessage = message;
        // Update the status without rebuilding an open dialog or losing input.
        document.querySelectorAll('[data-offline-status]').forEach((element) => {
          element.textContent = message;
          element.hidden = false;
        });
      });
    }
  } catch (error) {
    app.innerHTML = `<section class="empty-state"><p class="eyebrow">ЛОКАЛЬНОЕ ХРАНИЛИЩЕ</p><h1>Не удалось открыть приложение</h1><p class="empty-copy">${escapeHtml(error.message)}</p></section>`;
  }
}

start();
