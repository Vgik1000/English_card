import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { analyzeImport, parseExcelFile } from './importer.js';
import { cardKey } from './domain.js';
import { getImportErrorMessage, ImportFileError } from './import-errors.js';

async function asFile(workbook) {
  const data = await workbook.xlsx.writeBuffer();
  return { arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
}

test('xlsx parsing trims text, accepts normalized headers and reports malformed rows', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Words');
  sheet.addRow([' english ', 'RUSSIAN', 'Transcription', 'Past Simple', 'Past Participle', 'Example EN', 'Example RU']);
  sheet.addRow(['  bring   me ', ' приносить ', '/brɪŋ/', 'brought', 'brought', 'She brought tea.', 'Она принесла чай.']);
  sheet.addRow(['valid', '', '', '', '', '', '']);
  sheet.addRow(['verb', 'глагол', '', 'went', '', '', '']);
  const rows = await parseExcelFile(await asFile(workbook));
  assert.equal(rows[0].english, 'bring me');
  assert.equal(rows[0].russian, 'приносить');
  assert.deepEqual(rows[1].errors, ['не заполнено Russian']);
  assert.deepEqual(rows[2].warnings, ['заполнена только одна форма глагола']);
});

test('imports prefixed SpreadsheetML and absolute table links without changing cell text', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Выражения');
  const expected = [
    ['By the way', 'Кстати, между прочим', '', '', '', 'By the way, have you seen my keys?', 'Кстати, ты не видел мои ключи?'],
    ['A & B < C', 'Кавычки "текст"', '', '', '', 'Literal <x:sheet> & xmlns:x="test"', 'Строка 1\nСтрока 2'],
  ];
  sheet.addTable({ name: 'Expressions', ref: 'A1', headerRow: true,
    columns: ['English', 'Russian', 'Transcription', 'Past Simple', 'Past Participle', 'Example EN', 'Example RU'].map((name) => ({ name })),
    rows: expected });
  const originalFile = await asFile(workbook);
  const expectedRows = await parseExcelFile(originalFile);
  const original = await originalFile.arrayBuffer();
  const zip = await JSZip.loadAsync(original);
  // Simulate the same namespace and relationship variants as the reported workbook.
  for (const entry of Object.values(zip.files).filter((entry) => !entry.dir && entry.name.endsWith('.xml') && entry.name.startsWith('xl/'))) {
    const xml = await entry.async('string');
    if (!xml.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) continue;
    zip.file(entry.name, xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns:sheetData="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
      .replace(/(<\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g, '$1sheetData:$2'));
  }
  const relsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
  zip.file(relsPath, (await zip.file(relsPath).async('string')).replace('Target="../tables/table1.xml"', 'Target="/xl/tables/table1.xml"'));
  const bytes = await zip.generateAsync({ type: 'arraybuffer' });
  const before = new Uint8Array(bytes).slice();
  const rows = await parseExcelFile({ name: 'expressions.xlsx', arrayBuffer: async () => bytes });
  assert.deepEqual(rows, expectedRows);
  assert.deepEqual(new Uint8Array(bytes), before, 'Source bytes must not be mutated');
});

test('imports an absolute table relationship even without namespace prefixes', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Words').addTable({ name: 'Words', ref: 'A1', headerRow: true,
    columns: ['English', 'Russian', 'Transcription', 'Past Simple', 'Past Participle', 'Example EN', 'Example RU'].map((name) => ({ name })),
    rows: [['hello', 'привет', '', '', '', '', '']] });
  const file = await asFile(workbook);
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const path = 'xl/worksheets/_rels/sheet1.xml.rels';
  zip.file(path, (await zip.file(path).async('string')).replace('Target="../tables/table1.xml"', 'Target="/xl/tables/table1.xml"'));
  const bytes = await zip.generateAsync({ type: 'arraybuffer' });
  const rows = await parseExcelFile({ arrayBuffer: async () => bytes });
  assert.equal(rows[0].english, 'hello');
});

test('file failures produce actionable messages without library internals', async () => {
  await assert.rejects(parseExcelFile({ name: 'words.xls' }), (error) => error instanceof ImportFileError && /\.xlsx/.test(getImportErrorMessage(error)));
  await assert.rejects(parseExcelFile({ name: 'words.xlsx', arrayBuffer: async () => { throw new Error('Permission denied /private/path'); } }),
    (error) => /скачан на устройство/.test(getImportErrorMessage(error)) && !/private/.test(getImportErrorMessage(error)));
  await assert.rejects(parseExcelFile({ name: 'words.xlsx', arrayBuffer: async () => new TextEncoder().encode('not a workbook') }),
    (error) => /сохраните новую копию/.test(getImportErrorMessage(error)) && !/undefined|sheets|zip/i.test(getImportErrorMessage(error)));
  assert.doesNotMatch(getImportErrorMessage(new TypeError("undefined is not an object (evaluating 'e4.sheets')")), /undefined|sheets|e4/);
});

test('malformed workbook XML fails clearly instead of importing a partial list', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Words');
  const zip = await JSZip.loadAsync(await (await asFile(workbook)).arrayBuffer());
  zip.file('xl/workbook.xml', '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets>');
  const bytes = await zip.generateAsync({ type: 'arraybuffer' });
  await assert.rejects(parseExcelFile({ arrayBuffer: async () => bytes }), ImportFileError);
});

test('missing headers and empty sheets keep specific template instructions', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Words');
  await assert.rejects(parseExcelFile(await asFile(workbook)), /Первый лист Excel пуст/);
  sheet.addRow(['English', 'Russian']);
  sheet.addRow(['word', 'слово']);
  await assert.rejects(parseExcelFile(await asFile(workbook)), (error) => /transcription/i.test(getImportErrorMessage(error)) && /первой строке/.test(getImportErrorMessage(error)));
});

test('import analysis counts duplicate pairs, shared cards and safe replacement', () => {
  const makeRow = (english, russian) => ({ english, russian, key: cardKey(english, russian), errors: [], warnings: [] });
  const rows = [makeRow('light', 'свет'), makeRow('light', 'свет'), makeRow('light', 'лёгкий')];
  const result = analyzeImport(rows, [{ key: cardKey('light', 'свет') }], [{ key: cardKey('old', 'старый') }]);
  assert.equal(result.uniqueCount, 2);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.knownCount, 1);
  assert.equal(result.newCount, 1);
  assert.equal(result.removedCount, 1);
  assert.equal(result.canRemoveMissing, true);
  const invalid = analyzeImport([{ ...makeRow('bad', ''), errors: ['не заполнено Russian'] }], [], [{ key: 'old' }]);
  assert.equal(invalid.canRemoveMissing, false);
});
