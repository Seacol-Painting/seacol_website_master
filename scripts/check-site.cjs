// Shared offline gate: GitHub Actions and Vercel execute the same checks.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    console.error(`Could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
function filesIn(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(filename) : [filename];
  });
}

const settings = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (settings.buildCommand !== 'npm run build' || settings.outputDirectory !== 'dist' ||
    packageJson.scripts?.build !== 'node scripts/build-site.cjs') {
  console.error('Vercel must run npm run build, using scripts/build-site.cjs, and publish only dist.');
  process.exit(1);
}

run('python3', ['scripts/check_site.py']);
run('python3', ['tests/security-policy.py']);
run('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v']);

const sourceFiles = [
  ...fs.readdirSync(root).filter(name => /\.(?:c?js|mjs)$/.test(name)).map(name => path.join(root, name)),
  ...filesIn(path.join(root, 'api')),
  ...filesIn(path.join(root, 'server')),
].filter(name => /\.(?:c?js|mjs)$/.test(name));
for (const filename of sourceFiles) run(process.execPath, ['--check', filename]);
run(process.execPath, ['tests/interaction-regressions.cjs']);

const nodeTests = filesIn(path.join(root, 'tests')).filter(name => /\.test\.(?:c?js|mjs)$/.test(name));
const apiHandlers = filesIn(path.join(root, 'api')).filter(name => /\.(?:js|mjs|ts)$/.test(name));
const apiTests = nodeTests.filter(name =>
  /^(?:api|backend|estimate|events)[-.]/.test(path.basename(name)) &&
  !/(?:frontend|browser)/i.test(path.basename(name))
);
if (apiHandlers.length && !apiTests.length) {
  console.error('API handlers exist, but no API tests were found (use api.test.mjs, backend.test.mjs, estimate.test.mjs or events.test.mjs).');
  process.exit(1);
}
if (nodeTests.length) run(process.execPath, ['--test', ...nodeTests]);
console.log('PASS: deployment gate completed; static pages, interactions and available API tests passed.');
