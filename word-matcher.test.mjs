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

const ja = (japaneseText, reading, translation, extra = {}) => ({ originalText: '', japaneseText, reading, translation, createdAt: 1, reviewCount: 0, difficulty: 2, reviewHistory: [], ...extra });
const en = (word, translation, extra = {}) => ({ word, translation, createdAt: 1, reviewCount: 0, difficulty: 2, reviewHistory: [], ...extra });
const hits = (m, text) => [...m.match(text)].map((x) => text.slice(x.from, x.to));

test('Japanese words match inside running text and in conjugated forms', () => {
  const m = new WordMatcher({}, {
    a: ja('図書館', 'としょかん', '图书馆'),
    b: ja('食べる', 'たべる', '吃'),
    c: ja('書く', 'かく', '写'),
    d: ja('新しい', 'あたらしい', '新的'),
    e: ja('勉強する', 'べんきょうする', '学习'),
    f: ja('予想', 'よそう', '预想'),
  });
  assert.deepEqual(hits(m, '駅前に新しい図書館を建てる'), ['新しい', '図書館']);
  assert.deepEqual(hits(m, '昨日はパンを食べた。手紙を書いて、新しかった'), ['食べた', '書い', '新しか']);
  assert.deepEqual(hits(m, '毎日勉強している。増えると予想している'), ['勉強し', '予想']);
  // A kanji stem followed by another kanji is a different word: 書く does not match 書道.
  assert.deepEqual(hits(m, '書道を習う'), []);
});

test('longest match wins and the hover card gets every saved meaning', () => {
  const m = new WordMatcher({ x: en('culture', '文化'), 'x#2': en('culture', '培养物') }, { a: ja('図書', 'としょ', '图书'), b: ja('図書館', 'としょかん', '图书馆') });
  const [hit] = m.match('新しい図書館');
  assert.equal(hit.words[0].word, '図書館');
  const [c] = m.match('Japanese culture values silence.');
  assert.deepEqual([...c.words].map((w) => w.meaning), ['文化', '培养物']);
});

test('English words match whole words and common inflections only', () => {
  const m = new WordMatcher({ a: en('study', '学习'), b: en('make', '做'), c: en('cat', '猫') }, {});
  assert.deepEqual(hits(m, 'She studies hard; studied, studying. Making, made.'), ['studies', 'studied', 'studying', 'Making']);
  assert.deepEqual(hits(m, 'Cats and a category, concatenate, cat.'), ['Cats', 'cat']);
});

test('mastered words, sentences and short kana are not highlighted', () => {
  const m = new WordMatcher({ a: en('done', '完成', { difficulty: 0 }) }, {
    b: ja('これは本です。', '', '这是书'),
    c: ja('の', 'の', '的'),
    d: ja('いる', 'いる', '在'),
  });
  assert.equal(m.size, 0);
  assert.equal(m.match('done これは本です。の いる').length, 0);
});

test('a long article is matched quickly', () => {
  const japanese = {};
  for (let i = 0; i < 3000; i++) japanese['k' + i] = ja('語' + String.fromCharCode(0x4e00 + i) + '彙', '', 'x');
  const m = new WordMatcher({}, { ...japanese, z: ja('図書館', '', '图书馆') });
  const text = '駅前に新しい図書館を建てると発表した。'.repeat(5000);
  const start = performance.now();
  assert.equal(m.match(text).length, 5000);
  assert.ok(performance.now() - start < 300, 'match took too long');
});
