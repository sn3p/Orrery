const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const retained = require('./fixtures/promotion/pr73-hashes.json');

module.exports = function assertPR73Assets(site) {
  for (const [name, hash] of Object.entries(retained)) {
    if (name.endsWith('index.html')) continue;
    const bytes = fs.readFileSync(path.join(site, name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash,
      'PR73 cached page dependency retained: ' + name);
  }
};
