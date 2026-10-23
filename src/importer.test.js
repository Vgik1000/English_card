import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { analyzeImport, parseExcelFile } from './importer.js';
import { cardKey } from './domain.js';

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