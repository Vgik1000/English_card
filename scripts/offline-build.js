import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? listFiles(join(directory, entry.name), `${prefix}${entry.name}/`)
    : `${prefix}${entry.name}`));
  return files.flat().filter((file) => file !== 'sw.js' && !file.endsWith('.map')).sort();
}

export async function buildServiceWorker(outDir) {
  const template = await readFile(new URL('../src/service-worker.js', import.meta.url), 'utf8');
  const files = await listFiles(outDir);
  if (!files.includes('index.html')) throw new Error('Cannot prepare offline cache without index.html');
  const contents = await Promise.all(files.map((file) => readFile(join(outDir, file))));
  const hash = createHash('sha256').update(template);
  files.forEach((file, index) => hash.update(file).update('\0').update(contents[index]).update('\0'));
  const version = hash.digest('hex').slice(0, 20);
  const source = template.replace('__PRECACHE_FILES__', JSON.stringify(files)).replace('__BUILD_ID__', version);
  await writeFile(join(outDir, 'sw.js'), source);
  return { files, version };
}

export function offlinePlugin() {
  let outDir;
  return {
    name: 'lexika-offline',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    async closeBundle() { await buildServiceWorker(outDir); },
  };
}
