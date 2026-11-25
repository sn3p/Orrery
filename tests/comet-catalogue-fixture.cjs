// Synthetic membership variants use real series solely to test consumer plumbing.
// They are not scientific provenance for the synthetic ID.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, 'fixtures/comets-v2');
const latest = JSON.parse(fs.readFileSync(path.join(root, 'latest.json')));
const index = JSON.parse(fs.readFileSync(path.join(root, latest.index.url)));
function product(ids, { compact = false } = {}) {
  const files = new Map();
  const reference = (value, prefix) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const url = `${prefix}${sha256}.json`;
    files.set(url, bytes);
    return {url, sha256, bytes:bytes.length};
  };
  const objects = ids.map(id => {
    const original = index.objects.find(e => e.id === id) ?? index.objects[0];
    const entry = structuredClone(original);
    const object = JSON.parse(fs.readFileSync(path.join(root, entry.data.url)));
    if (id !== original.id) {
      entry.id = object.id = id;
      entry.name = `${id}/<b>Literal test comet</b>`;
      for (const source of Object.values(entry.provenance)) {
        source.url = source.url.replace(`DES%3D${original.id}`, `DES%3D${id}`);
        source.target = entry.name;
      }
    }
    if (compact) {
      entry.validation.references = entry.validation.references.filter(row => row[0] === entry.validation.worst_jd);
      for (const source of Object.values(entry.provenance)) source.header = 'Synthetic catalogue paging fixture';
    }
    entry.data = reference(object, 'objects/');
    return entry;
  });
  const descriptor = {comet_contract_version:2,index:reference({comet_contract_version:2,objects},'index-')};
  files.set('latest.json',Buffer.from(JSON.stringify(descriptor)));
  return {files,objects,descriptor};
}
module.exports = { product, index };
