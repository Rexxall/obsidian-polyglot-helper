const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const esbuild = require('esbuild');

function load(entry) {
  const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}), console });
  return module.exports;
}

const files = (entries) => ({
  async exists(p) { return p in entries; },
  async read(p) { return entries[p]; },
});

const { readLegacyPluginData } = load('src/legacy-migration.ts');
const legacyFile = '.obsidian/plugins/obsidian-polyglot-helper/data.json';

test('settings and vocabulary from the old plugin folder are picked up under the new id', async () => {
  const saved = { vocabItems: { neko: { word: '猫' } }, outputDestination: 'sidebar' };
  const data = await readLegacyPluginData(files({ [legacyFile]: JSON.stringify(saved) }), '.obsidian', '.obsidian/plugins/polyglot-helper');
  assert.equal(JSON.stringify(data), JSON.stringify(saved));
});

test('a custom config folder is respected', async () => {
  const data = await readLegacyPluginData(files({ '.config/plugins/obsidian-polyglot-helper/data.json': '{"a":1}' }), '.config', '.config/plugins/polyglot-helper');
  assert.equal(data.a, 1);
});

test('nothing is imported when running from the old folder, without old data, or from a broken file', async () => {
  const entries = { [legacyFile]: '{"a":1}' };
  assert.equal(await readLegacyPluginData(files(entries), '.obsidian', '.obsidian/plugins/obsidian-polyglot-helper'), null);
  assert.equal(await readLegacyPluginData(files({}), '.obsidian', '.obsidian/plugins/polyglot-helper'), null);
  assert.equal(await readLegacyPluginData(files({ [legacyFile]: '{broken' }), '.obsidian', '.obsidian/plugins/polyglot-helper'), null);
  assert.equal(await readLegacyPluginData(files({ [legacyFile]: '[1,2]' }), '.obsidian', '.obsidian/plugins/polyglot-helper'), null);
});

test('the sentence around a word is found without regex lookbehind (older iOS)', () => {
  const { sentenceAround } = load('src/lookup-popover.ts');
  assert.equal(sentenceAround('I like tea. The cat sleeps! Is it?', 'cat'), 'The cat sleeps!');
  assert.equal(sentenceAround('猫が好きです。犬も好き。', '犬'), '犬も好き。');
  assert.equal(sentenceAround('no punctuation here', 'here'), 'no punctuation here');
});
