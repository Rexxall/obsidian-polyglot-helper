import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import esbuild from 'esbuild';

function load(entry) {
  const code = esbuild.buildSync({ entryPoints: [path.join(import.meta.dirname, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}), console });
  return module.exports;
}

function memoryAdapter(files = {}) {
  return {
    files,
    async mkdir() {},
    async exists(p) { return p in files; },
    async read(p) { return files[p]; },
    async write(p, d) { files[p] = d; },
    async remove(p) { delete files[p]; },
  };
}

test('hash is stable, 14 hex chars, and separates near-identical keys', () => {
  const { hashKey } = load('src/crypto.ts');
  assert.equal(hashKey('abc'), hashKey('abc'));
  assert.match(hashKey('abc'), /^[0-9a-f]{14}$/);
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(hashKey('The same long sentence prefix for many lookups ' + i));
  assert.equal(seen.size, 20000);
});

test('a cache file written by 1.3.x is found and moved to the new name', async () => {
  const { legacyHash } = load('src/crypto.ts');
  const cache = load('src/cache.ts');
  const key = 'hello-{"mode":"full"}';
  const legacyName = `p/.cache/english/hello_${legacyHash(key).substring(0, 8)}.json`;
  const adapter = memoryAdapter({ [legacyName]: JSON.stringify({ word: 'hello' }) });
  const app = { vault: { adapter } };
  const hit = await cache.getFromCache(app, 'p', 'english', key);
  assert.equal(JSON.stringify(hit), '{"word":"hello"}');
  assert.ok(!(legacyName in adapter.files));
  assert.equal(Object.keys(adapter.files).length, 1);
  assert.equal(JSON.stringify(await cache.getFromCache(app, 'p', 'english', key)), '{"word":"hello"}');
});
