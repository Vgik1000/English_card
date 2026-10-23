import { cardKey, normalizeText } from './domain.js';

const FIELDS = [
  ['english', 'english'],
  ['russian', 'russian'],
  ['transcription', 'transcription'],
  ['past simple', 'pastSimple'],
  ['past participle', 'pastParticiple'],
  ['example en', 'exampleEn'],
  ['example ru', 'exampleRu'],
];

function normalizeHeader(value) {
  return normalizeText(value).toLocaleLowerCase('en');
}

export async function parseExcelFile(file) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const firstSheet = workbook.worksheets[0];
  if (!firstSheet) throw new Error('В файле нет листов с данными');
  const rows = [];
  firstSheet.eachRow({ includeEmpty: true }, (sheetRow) => rows.push({ rowNumber: sheetRow.number, values: sheetRow.values.slice(1) }));
  if (!rows.length) throw new Error('Лист Excel пуст');
  const headers = rows[0].values.map((value) => normalizeHeader(value));
  const indexes = Object.fromEntries(FIELDS.map(([header, field]) => [field, headers.indexOf(header)]));
  const missingHeaders = FIELDS.filter(([, field]) => indexes[field] < 0).map(([header]) => header);
  if (missingHeaders.length) throw new Error(`Не найдены заголовки: ${missingHeaders.join(', ')}`);

  const parsedRows = [];
  const scalarCellText = (value) => {
    if (value == null || typeof value === 'object') return '';
    return normalizeText(value);
  };
  for (let index = 1; index < rows.length; index += 1) {
    const { values: source, rowNumber } = rows[index];
    if (source.every((value) => !scalarCellText(value))) continue;
    const row = { rowNumber, errors: [], warnings: [] };
    for (const [, field] of FIELDS) row[field] = scalarCellText(source[indexes[field]]);
    if (!row.english) row.errors.push('не заполнено English');
    if (!row.russian) row.errors.push('не заполнено Russian');
    if (Boolean(row.pastSimple) !== Boolean(row.pastParticiple)) row.warnings.push('заполнена только одна форма глагола');
    if (row.english && row.russian) row.key = cardKey(row.english, row.russian);
    parsedRows.push(row);
  }
  if (!parsedRows.length) throw new Error('В файле нет строк со словами');
  return parsedRows;
}

export function analyzeImport(rows, existingCards = [], existingDictionaryCards = []) {
  const existingKeys = new Set(existingCards.map((card) => card.key));
  const previousKeys = new Set(existingDictionaryCards.map((card) => card.key));
  const seen = new Set();
  const uniqueRows = [];
  let duplicates = 0;
  let knownCards = 0;
  const conflicts = [];
  for (const row of rows) {
    if (!row.key) continue;
    if (seen.has(row.key)) {
      duplicates += 1;
      continue;
    }
    seen.add(row.key);
    uniqueRows.push(row);
    if (existingKeys.has(row.key)) knownCards += 1;
    const existing = existingCards.find((card) => card.key === row.key);
    if (existing && ['transcription', 'pastSimple', 'pastParticiple', 'exampleEn', 'exampleRu'].some((field) => row[field] && existing[field] && row[field] !== existing[field])) {
      conflicts.push({ english: row.english, russian: row.russian });
    }
  }
  const errors = rows.filter((row) => row.errors.length);
  const warnings = rows.flatMap((row) => row.warnings.map((message) => ({ rowNumber: row.rowNumber, message })));
  const removed = uniqueRows.length === 0 ? 0 : [...previousKeys].filter((key) => !seen.has(key)).length;
  return {
    rows: uniqueRows,
    rowCount: rows.length,
    uniqueCount: uniqueRows.length,
    duplicateCount: duplicates,
    knownCount: knownCards,
    newCount: uniqueRows.filter((row) => !existingKeys.has(row.key)).length,
    removedCount: removed,
    errors,
    warnings,
    conflicts,
    canRemoveMissing: errors.length === 0,
  };
}