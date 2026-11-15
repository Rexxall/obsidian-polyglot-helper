import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import esbuild from 'esbuild';

const code = esbuild.buildSync({ entryPoints: [path.join(import.meta.dirname, 'src/apis/jisho.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}), console });
const { fullReading } = module.exports;

// The two nodes fullReading reads, as Jisho renders them.
const block = (furigana, text) => ({
  querySelectorAll: () => furigana.map((t) => ({ textContent: t })),
  querySelector: () => ({ textContent: ` ${text} ` }),
});

test('kana the word writes out are added to the furigana', () => {
  assert.equal(fullReading(block(['にお', ''], '匂い')), 'におい');
  assert.equal(fullReading(block(['と', '', 'あつか', ''], '取り扱い')), 'とりあつかい');
  assert.equal(fullReading(block(['', 'ちゃ'], 'お茶')), 'おちゃ');
});

test('a compound reading covers the kanji after it', () => {
  assert.equal(fullReading(block(['きょう', ''], '今日')), 'きょう');
  assert.equal(fullReading(block(['ぞう', 'しょ'], '蔵書')), 'ぞうしょ');
});

test('spans that do not line up fall back to the furigana alone', () => {
  assert.equal(fullReading(block(['にお'], '匂い')), 'にお');
});
