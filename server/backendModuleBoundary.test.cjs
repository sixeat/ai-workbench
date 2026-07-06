const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SERVER_ROOT = __dirname;

function cjsFiles(relativeDir) {
  const dir = path.join(SERVER_ROOT, relativeDir);
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return cjsFiles(path.join(relativeDir, entry.name));
      }
      return entry.isFile() && entry.name.endsWith('.cjs') ? [fullPath] : [];
    });
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function relativeName(filePath) {
  return path.relative(SERVER_ROOT, filePath).replace(/\\/g, '/');
}

function assertFilesDoNotMatch(files, pattern, message) {
  const offenders = files
    .filter((filePath) => pattern.test(read(filePath)))
    .map(relativeName);

  assert.deepEqual(offenders, [], message);
}

test('route modules do not import repositories or db directly', () => {
  assertFilesDoNotMatch(
    cjsFiles('routes'),
    /require\(['"](?:\.\.\/repositories|\.\.\/db\.cjs)/,
    'routes should call services instead of repositories/db directly'
  );
});

test('service modules do not import routes or db directly', () => {
  assertFilesDoNotMatch(
    cjsFiles('services'),
    /require\(['"](?:\.\.\/routes|\.\.\/db\.cjs)/,
    'services should stay below routes and access data through repositories'
  );
});

test('repository modules do not depend on routes, services, or workers', () => {
  assertFilesDoNotMatch(
    cjsFiles('repositories'),
    /require\(['"](?:\.\.\/routes|\.\.\/services|\.\.\/workers)/,
    'repositories should only expose data access and must not depend on upper layers'
  );
});

test('app composition modules do not import db directly', () => {
  const appModules = [
    'app.cjs',
    'assetServiceApp.cjs',
    'authServiceApp.cjs',
    'modelServiceApp.cjs',
    'workerServiceApp.cjs',
    'workflowServiceApp.cjs',
  ].map((fileName) => path.join(SERVER_ROOT, fileName));

  assertFilesDoNotMatch(
    appModules,
    /require\(['"]\.\/db\.cjs['"]\)/,
    'app composition should use repositories/defaults/dataPaths instead of importing db directly'
  );
});

test('worker modules do not import routes, repositories, or db directly', () => {
  assertFilesDoNotMatch(
    cjsFiles('workers'),
    /require\(['"](?:\.\.\/routes|\.\.\/repositories|\.\.\/db\.cjs)/,
    'workers should consume queues through services instead of routes/repositories/db directly'
  );
});
