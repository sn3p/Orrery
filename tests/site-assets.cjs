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
  // Pages serves the app under /Orrery/, so icon links stay relative.
  const icons = [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g)]
      .map(([, name, ...values]) => [name.toLowerCase(), values.find(value => value !== undefined)])))
    .filter(attributes => attributes.rel?.split(/\s+/).includes('icon'));
  const sources = { 'image/svg+xml': 'favicon.svg', 'image/png': 'favicon-32.png' };
  assert.deepEqual(icons.map(icon => icon.type).sort(), Object.keys(sources).sort(), 'SVG icon with a PNG fallback');
  for (const icon of icons) {
    assert.match(icon.href, /^assets\/[^/]+$/, 'Icon link is relative: ' + icon.href);
    assert.deepEqual(fs.readFileSync(path.join(site, icon.href)),
      fs.readFileSync(path.join(__dirname, '../src/unified', sources[icon.type])), 'Icon ships unchanged: ' + icon.href);
  }
};
