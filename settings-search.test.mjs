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
  // Names are written as tr('中文', 'English'); both languages must be searchable.
  const names = [
    ...page.matchAll(/\.setName\(\s*'([^'$]+)'\s*\)/g),
    ...page.matchAll(/\.setName\(\s*"([^"$]+)"\s*\)/g),
  ].map((match) => match[1]);
  for (const match of page.matchAll(/(?:\.setName\(\s*|\{ id: '\w+', name: )tr\(\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3\s*\)/gs)) {
    if (!match[2].includes('${')) names.push(match[2], match[4]);
  }
  assert.ok(names.length > 100, 'the pattern still finds the setting names');
  const missing = names.filter((name) => !SETTINGS_SEARCH_TERMS.includes(name));
  assert.equal(missing.join(' | '), '', 'add these to src/settings-search.ts');
});
