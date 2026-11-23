const fs = require('node:fs');
const path = require('node:path');

// download-artifact only warns if a subset of the pinned IDs is missing. Keep
// artifact directories separate and require every planned blob before merging.
const manifest = Object.entries(JSON.parse(process.env.CI_SOURCE_REPORTS));
if (!manifest.length) throw new Error('Missing source report manifest');
const reports = manifest.map(([name, id]) => {
  if (!/^playwright-blob-[a-z0-9-]+$/.test(name) || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Invalid source report identity');
  }
  const directory = path.join('.context/source-reports', name);
  if (!fs.existsSync(directory)) throw new Error(`Missing source report: ${name} (artifact ${id})`);
  const blobs = fs.readdirSync(directory, { withFileTypes: true }).filter(file => file.isFile() && file.name.endsWith('.zip'));
  if (blobs.length !== 1) throw new Error(`Expected one source report blob: ${name} (artifact ${id}), found ${blobs.length}`);
  return { file: path.join(directory, blobs[0].name), id };
});
fs.mkdirSync('.context/playwright-blob', { recursive: true });
for (const { file, id } of reports) {
  fs.copyFileSync(file, path.join('.context/playwright-blob', `source-${id}.zip`));
}
