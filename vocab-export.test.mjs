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

const { collectCards, toFlashcardNote, toAnkiText } = load('src/vocab-export.ts');

const english = {
  serendipity: { word: 'serendipity', translation: '意外发现\n美好事物', phonetics: '/ˌserənˈdɪpəti/', partOfSpeech: 'n.', tags: ['reading list'], createdAt: 1, reviewCount: 0, difficulty: 2, reviewHistory: [] },
};
const japanese = {
  'k1': { originalText: '猫', japaneseText: '猫', reading: 'ねこ', translation: '猫::cat', createdAt: 1, reviewCount: 0, difficulty: 2, reviewHistory: [] },
};

test('cards keep the study word on the front and reading/meaning on the back', () => {
  const cards = collectCards(english, japanese);
  assert.equal(cards.length, 2);
  const neko = cards.find((c) => c.front === '猫');
  assert.equal(neko.back, 'ねこ · 猫：：cat');
  const word = cards.find((c) => c.front === 'serendipity');
  assert.equal(word.back, '/ˌserənˈdɪpəti/ n. · 意外发现 美好事物');
});

test('re-exporting keeps Spaced Repetition schedules and drops nothing else', () => {
  const cards = collectCards(english, japanese);
  const first = toFlashcardNote(cards);
  assert.match(first, /^#flashcards\/polyglot\n/);
  const reviewed = first.replace('猫::ねこ · 猫：：cat', '猫::ねこ · 猫：：cat <!--SR:!2026-11-02,3,250-->');
  const second = toFlashcardNote(cards, reviewed);
  assert.match(second, /猫::ねこ · 猫：：cat <!--SR:!2026-11-02,3,250-->/);
  assert.match(second, /serendipity::\/ˌserənˈdɪpəti\/ n\. · 意外发现 美好事物\n/);
});

test('Anki text has the import header and tab-separated columns with safe tags', () => {
  const text = toAnkiText(collectCards(english, japanese));
  const lines = text.trim().split('\n');
  assert.deepEqual(lines.slice(0, 3), ['#separator:tab', '#html:false', '#tags column:3']);
  assert.ok(lines.includes('serendipity\t/ˌserənˈdɪpəti/ n. · 意外发现 美好事物\tenglish reading_list'));
});
