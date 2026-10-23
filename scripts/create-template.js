import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('Слова');
sheet.addRow(['English', 'Russian', 'Transcription', 'Past Simple', 'Past Participle', 'Example EN', 'Example RU']);
sheet.addRow(['bring', 'приносить', '/brɪŋ/', 'brought', 'brought', 'She brought me a cup of tea.', 'Она принесла мне чашку чая.']);
sheet.addRow(['achievement', 'достижение', '/əˈtʃiːvmənt/', '', '', 'This was an important achievement.', 'Это было важное достижение.']);
sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF386C55' } };
sheet.columns = [{ width: 20 }, { width: 24 }, { width: 20 }, { width: 20 }, { width: 22 }, { width: 42 }, { width: 42 }];
await workbook.xlsx.writeFile(new URL('../Шаблон словаря.xlsx', import.meta.url));