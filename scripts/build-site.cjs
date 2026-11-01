// A failed check exits before any deployable directory is created.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.rmSync(output, { recursive: true, force: true });
const result = spawnSync(process.execPath, [path.join(__dirname, 'check-site.cjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error || result.status !== 0) {
  if (result.error) console.error(result.error.message);
  process.exit(result.status || 1);
}

const browserScripts = new Set(['script.js', 'analytics.js', 'estimate.js', 'color-chart.js']);
const publicFiles = fs.readdirSync(root).filter(name => /\.(?:html|css)$/.test(name) || browserScripts.has(name));
publicFiles.push('robots.txt', 'sitemap.xml');
// New browser code must be added explicitly, so server utilities cannot become public.
for (const filename of publicFiles.filter(name => name.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, filename), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const script = match[1].split('?')[0].replace(/^\//, '');
    if (!browserScripts.has(script)) {
      fs.writeSync(2, `${filename}: browser script ${script} is not in the public build allowlist.\n`);
      process.exit(1);
    }
  }
}
fs.mkdirSync(output, { recursive: true });
for (const filename of publicFiles) fs.copyFileSync(path.join(root, filename), path.join(output, filename));
fs.cpSync(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
console.log(`Built dist with ${publicFiles.length} public files and assets. API/server/test/config files are excluded.`);
