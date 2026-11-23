const fs = require('node:fs');
const path = require('node:path');

// Intercept built app assets directly, at root or the Pages subpath.
async function routeFiles(page, directory) {
  const root = path.resolve(directory);
  await page.route('https://orrery.test/**', route => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/Orrery\//, '/');
    const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return route.fulfill({ status: 404 });
    }
    const contentType = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html',
      '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ path: file, contentType });
  });
}
module.exports = { routeFiles };
