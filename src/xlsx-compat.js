import JSZip from 'jszip';
import { SaxesParser } from 'saxes';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

const escapeText = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (value) => escapeText(value).replace(/"/g, '&quot;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');

function normalizeXml(xml, fileName) {
  const parser = new SaxesParser({ xmlns: true });
  const output = [];
  const stack = [];
  let changed = false;
  parser.on('doctype', () => { throw new Error('Unsupported workbook XML declaration'); });
  parser.on('opentag', (node) => {
    const supported = node.uri === MAIN_NS || node.uri === RELS_NS;
    const name = supported ? node.local : node.name;
    if (name !== node.name) changed = true;
    const attributes = new Map(Object.values(node.attributes).map((attribute) => [attribute.name, attribute.value]));
    let defaultNamespace = attributes.get('xmlns') ?? stack.at(-1)?.defaultNamespace ?? '';
    // Preserve namespace boundaries, including foreign elements nested inside cells.
    if (!name.includes(':') && defaultNamespace !== node.uri) {
      attributes.set('xmlns', node.uri);
      defaultNamespace = node.uri;
    }
    if (node.uri === RELS_NS && node.local === 'Relationship' && fileName.startsWith('xl/worksheets/_rels/')
      && attributes.get('TargetMode') !== 'External' && attributes.get('Type')?.endsWith('/table')) {
      const target = attributes.get('Target');
      if (target) {
        const worksheet = fileName.replace('/_rels/', '/').replace(/\.rels$/, '');
        const resolved = new URL(target, `https://workbook.invalid/${worksheet}`);
        // ExcelJS indexes table parts by this relative path, even for absolute OOXML targets.
        if (resolved.origin === 'https://workbook.invalid' && /^\/xl\/tables\/[^/]+\.xml$/.test(resolved.pathname)) {
          const relative = `../tables/${resolved.pathname.slice('/xl/tables/'.length)}`;
          if (relative !== target) {
            attributes.set('Target', relative);
            changed = true;
          }
        }
      }
    }
    output.push(`<${name}${[...attributes].map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('')}>`);
    stack.push({ name, defaultNamespace });
  });
  parser.on('closetag', () => output.push(`</${stack.pop().name}>`));
  parser.on('text', (text) => output.push(escapeText(text)));
  parser.on('cdata', (text) => output.push(escapeText(text)));
  parser.on('comment', (text) => output.push(`<!--${text}-->`));
  parser.on('processinginstruction', ({ target, body }) => output.push(`<?${target} ${body}?>`));
  parser.write(xml).close();
  return changed ? output.join('') : xml;
}

// Retry only after a normal ExcelJS load fails. All conversion is in memory.
export async function normalizeExcelFile(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  if (!zip.file('xl/workbook.xml')) throw new Error('Missing workbook');
  let changed = false;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.startsWith('xl/') || !/\.(xml|rels)$/.test(entry.name)) continue;
    const xml = await entry.async('string');
    const normalized = normalizeXml(xml, entry.name);
    if (normalized !== xml) {
      zip.file(entry.name, normalized);
      changed = true;
    }
  }
  return changed ? zip.generateAsync({ type: 'arraybuffer' }) : bytes;
}
