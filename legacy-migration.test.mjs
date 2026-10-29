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

const files = (entries) => ({
  async exists(p) { return p in entries; },
  async read(p) { return entries[p]; },
  async list(dir) {
    const folders = new Set();
    for (const p of Object.keys(entries)) {
      if (!p.startsWith(dir + '/')) continue;
      const rest = p.slice(dir.length + 1);
      if (rest.includes('/')) folders.add(dir + '/' + rest.split('/')[0]);
    }
    return { files: [], folders: [...folders] };
  },
});

const { readLegacyPluginData } = load('src/legacy-migration.ts');
const legacyFile = '.obsidian/plugins/obsidian-polyglot-helper/data.json';

// 1.3.0 的数据形状（脱敏：词、释义、时间都是假的，没有密钥）
const v130 = {
  outputDestination: 'sidebar',
  apiConfigs: [{ name: 'A', apiKey: '', baseUrl: 'https://example.invalid/v1/chat/completions', model: 'm', enabled: true }],
  japaneseVocabItems: {
    '猫_ねこ': { originalText: '猫', japaneseText: 'ねこ', reading: 'ねこ', translation: 'cat', notes: '', examples: [], tags: [], createdAt: 1, reviewCount: 3, difficulty: 1, reviewHistory: [{ timestamp: 2, performance: 4 }], nextReview: 1893456000000 },
  },
  englishVocabItems: {
    tea: { word: 'tea', translation: '茶', phonetics: '/tiː/', partOfSpeech: 'n.', definitions: ['a drink'], notes: '', examples: [], tags: [], createdAt: 1, reviewCount: 0, difficulty: 2, reviewHistory: [], nextReview: 1 },
  },
  queryHistory: [{ query: 'tea', type: 'english', sections: {}, timestamp: 3 }],
};

test('settings and vocabulary from the old plugin folder are picked up under the new id', async () => {
  const found = await readLegacyPluginData(files({ [legacyFile]: JSON.stringify(v130) }), '.obsidian', '.obsidian/plugins/polyglot-helper');
  assert.equal(found.dir, '.obsidian/plugins/obsidian-polyglot-helper');
  assert.equal(JSON.stringify(found.data), JSON.stringify(v130));
  assert.equal(found.data.japaneseVocabItems['猫_ねこ'].nextReview, 1893456000000);
  assert.equal(found.data.japaneseVocabItems['猫_ねこ'].reviewHistory.length, 1);
});

test('a manually installed old version in a differently named folder is found by its manifest id', async () => {
  const dir = '.obsidian_mac/plugins/obsidian-polyglot-helper-release';
  const found = await readLegacyPluginData(
    files({
      [`${dir}/manifest.json`]: JSON.stringify({ id: 'obsidian-polyglot-helper', version: '1.3.0' }),
      [`${dir}/data.json`]: JSON.stringify(v130),
      '.obsidian_mac/plugins/other/manifest.json': JSON.stringify({ id: 'other' }),
      '.obsidian_mac/plugins/other/data.json': '{"x":1}',
    }),
    '.obsidian_mac',
    '.obsidian_mac/plugins/polyglot-helper',
  );
  assert.equal(found.dir, dir);
  assert.equal(Object.keys(found.data.englishVocabItems).join(), 'tea');
});

test('a custom config folder is respected', async () => {
  const found = await readLegacyPluginData(files({ '.config/plugins/obsidian-polyglot-helper/data.json': '{"a":1}' }), '.config', '.config/plugins/polyglot-helper');
  assert.equal(found.data.a, 1);
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
