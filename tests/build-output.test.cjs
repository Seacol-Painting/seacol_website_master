const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fixture(t, checkExitCode = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seacol-build-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'assets', 'api', 'server', 'tests']) fs.mkdirSync(path.join(root, directory));
  fs.copyFileSync(path.join(__dirname, '../scripts/build-site.cjs'), path.join(root, 'scripts/build-site.cjs'));
  fs.writeFileSync(path.join(root, 'scripts/check-site.cjs'), `process.exit(${checkExitCode});`);
  for (const [name, content] of Object.entries({
    'index.html': '<html><script src="script.js?v=1"></script></html>',
    'script.js': '// browser', 'analytics.js': '// analytics', 'estimate.js': '// estimate',
    'styles.css': 'body{color:black}', 'sitemap.xml': '<urlset/>', 'robots.txt': 'Allow: /',
    'assets/image.webp': 'test image', 'api/estimate.js': '// server handler',
    'server/private.js': '// server helper', 'tests/private.test.cjs': '// tests',
    'package.json': '{}', 'vercel.json': '{}', '.env': 'TEST_SECRET=example',
  })) fs.writeFileSync(path.join(root, name), content);
  // The build is an ordinary child process, not another node:test worker.
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return { root, output: path.join(root, 'dist'), run: () => spawnSync(process.execPath, ['scripts/build-site.cjs'], { cwd: root, encoding: 'utf8', env: environment }) };
}

test('a failed deployment check leaves no publishable output', t => {
  const project = fixture(t, 37);
  fs.mkdirSync(project.output);
  fs.writeFileSync(path.join(project.output, 'old.html'), 'stale output');
  assert.equal(project.run().status, 37);
  assert.equal(fs.existsSync(project.output), false);
});

test('a successful build publishes public files without source/configuration', t => {
  const project = fixture(t);
  const result = project.run();
  assert.equal(result.status, 0, result.stderr);
  for (const filename of ['index.html', 'script.js', 'analytics.js', 'estimate.js', 'styles.css', 'sitemap.xml', 'robots.txt', 'assets/image.webp']) {
    assert.equal(fs.existsSync(path.join(project.output, filename)), true, filename);
  }
  for (const filename of ['api', 'server', 'tests', 'scripts', 'package.json', 'vercel.json', '.env']) {
    assert.equal(fs.existsSync(path.join(project.output, filename)), false, filename);
  }
});

test('a newly linked browser script cannot be accidentally omitted from output', t => {
  const project = fixture(t);
  fs.appendFileSync(path.join(project.root, 'index.html'), '<script src="new-browser.js"></script>');
  fs.writeFileSync(path.join(project.root, 'new-browser.js'), '// new browser code');
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /public build allowlist/);
  assert.equal(fs.existsSync(project.output), false);
});
