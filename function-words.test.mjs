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
const { WordMatcher } = load('src/word-matcher.ts');
const { isFunctionWord, autoAddEnglishWord } = load('src/function-words.ts');

const en = (word, translation) => ({ word, translation, createdAt: 1, reviewCount: 0, difficulty: 2, reviewHistory: [] });
const hits = (m, text) => [...m.match(text)].map((x) => text.slice(x.from, x.to));

test('function words in the word list are not underlined; ordinary words still are', () => {
  const m = new WordMatcher({ a: en('the', '幻影'), b: en('of', '的'), c: en('Is', '是'), d: en('queue', '队列') }, {});
  assert.equal(m.size, 1);
  assert.deepEqual(hits(m, 'The queue of the thing is long; the queues grow.'), ['queue', 'queues']);
  // "the" used to match "thing" through the -e stem.
  assert.deepEqual(hits(m, 'nothing there'), []);
});

test('auto-add skips function words and keeps ordinary words', () => {
  assert.equal(autoAddEnglishWord('the'), '');
  assert.equal(autoAddEnglishWord('  The quick fox'), '');
  assert.equal(autoAddEnglishWord('Because'), '');
  assert.equal(autoAddEnglishWord('Serendipity'), 'serendipity');
  assert.equal(autoAddEnglishWord('queue up'), 'queue');
  assert.equal(isFunctionWord('theory'), false);
  assert.equal(isFunctionWord('Their'), true);
});
