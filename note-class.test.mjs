import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import esbuild from 'esbuild';

function load(entry) {
  const code = esbuild.buildSync({ entryPoints: [path.join(import.meta.dirname, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({ Notice: class {}, TFile: class {} }), console });
  return module.exports;
}
const { withNoteClass } = load('src/utils.ts');

test('the note class joins existing cssclasses once and replaces the old cssclass key', () => {
  const fm = { cssclasses: ['wide'] };
  withNoteClass(fm, 'ih-clip');
  withNoteClass(fm, 'ih-clip');
  assert.deepEqual([...fm.cssclasses], ['wide', 'ih-clip']);
  const legacy = { cssclass: 'wide dense' };
  withNoteClass(legacy, 'ih-clip');
  assert.deepEqual([...legacy.cssclasses], ['wide', 'dense', 'ih-clip']);
  assert.equal('cssclass' in legacy, false);
  const none = {};
  withNoteClass(none, '');
  withNoteClass(none, 'two words');
  assert.equal('cssclasses' in none, false);
});

test('the public build adds no note class until the user sets one', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(path.join(import.meta.dirname, 'src/main.ts'), 'utf8');
  assert.match(source, /\n\tnoteCssClass: '',/);
});
