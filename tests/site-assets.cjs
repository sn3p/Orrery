const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function assertCurrentSite(site) {
  for (const retired of ['next', 'bundle.js', 'main.css', 'data/catalog.json']) {
    assert(!fs.existsSync(path.join(site, retired)), 'Retired public payload removed: ' + retired);
  }
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  assert.match(html, /<title>Orrery<\/title>/);
  for (const [, asset] of html.matchAll(/(?:src|href)="(assets\/[^"?#]+)"/g)) {
    assert(fs.existsSync(path.join(site, asset)), 'Current HTML dependency exists: ' + asset);
  }
  assert.match(html, /assets\/main\.[a-f0-9]+\.js/);
  assert(fs.existsSync(path.join(site, 'fonts/OFL.txt')), 'Font license stays in the deployed site');
};
