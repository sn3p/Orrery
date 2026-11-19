const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'fixtures/comets');
async function routeComets(page) {
  await page.route('https://sn3p.github.io/orrery-data/comets/**', route => {
    const name = new URL(route.request().url()).pathname.split('/comets/')[1];
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({status:404});
    return route.fulfill({path:file,contentType:'application/json'});
  });
}
module.exports = { routeComets };
