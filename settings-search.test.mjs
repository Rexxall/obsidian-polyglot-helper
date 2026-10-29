import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import esbuild from 'esbuild';

const { SETTINGS_SEARCH_TERMS } = (() => {
  const code = esbuild.buildSync({ entryPoints: [path.join(import.meta.dirname, 'src/settings-search.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports });
  return module.exports;
})();

test('every tab and setting name on the settings page is searchable', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'src/settings.ts'), 'utf8');
  const page = source.slice(source.indexOf('export class PolyglotSettingTab'));
  const names = [
    ...page.matchAll(/\.setName\(\s*'([^'$]+)'\s*\)/g),
    ...page.matchAll(/\.setName\(\s*"([^"$]+)"\s*\)/g),
    ...page.matchAll(/\{ id: '\w+', name: '([^']+)'/g),
  ].map((match) => match[1]);
  const missing = names.filter((name) => !SETTINGS_SEARCH_TERMS.includes(name));
  assert.equal(missing.join(' | '), '', 'add these to src/settings-search.ts');
});
