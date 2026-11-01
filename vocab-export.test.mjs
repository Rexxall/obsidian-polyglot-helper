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

test('re-exporting keeps Spaced Repetition schedules, by stable id or by the old front text', () => {
  const cards = collectCards(english, japanese);
  const first = toFlashcardNote(cards);
  assert.match(first, /^#flashcards\/polyglot\n/);
  // An export from before 1.9.0: no id comment, schedule matched by the front.
  const old = '猫::ねこ · 猫：：cat <!--SR:!2026-11-02,3,250-->\n';
  assert.match(toFlashcardNote(cards, old), /猫::ねこ · 猫：：cat <!--pg:ja-k1--> <!--SR:!2026-11-02,3,250-->/);
  // A newer export: matched by id even after the meaning was edited.
  const reviewed = first.replace('<!--pg:ja-k1-->', '<!--pg:ja-k1--> <!--SR:!2026-11-05,6,270-->');
  const edited = collectCards(english, { k1: { ...japanese.k1, translation: 'cat' } });
  assert.match(toFlashcardNote(edited, reviewed), /猫::ねこ · cat <!--pg:ja-k1--> <!--SR:!2026-11-05,6,270-->/);
  assert.match(toFlashcardNote(cards, reviewed), /serendipity::\/ˌserənˈdɪpəti\/ n\. · 意外发现 美好事物 <!--pg:en-serendipity-->\n/);
});

const sensed = {
  culture: { id: 'pg-a', word: 'culture', translation: '文化', examples: ['Japanese culture values silence.'], notes: '收自 [[Essay draft]] · 2026-10-30', createdAt: 1, reviewCount: 0, difficulty: 2, reviewHistory: [] },
  'culture#2': { id: 'pg-b', word: 'culture', translation: '培养物', examples: ['The culture grew overnight.'], notes: '收自 [[Lab notes]] · 2026-11-01', createdAt: 2, reviewCount: 0, difficulty: 2, reviewHistory: [] },
};

test('a word saved with two meanings gives two cards, each cued by its own sentence and linked to its note', () => {
  const cards = collectCards(sensed, {});
  assert.deepEqual([...cards.map((c) => c.id)].sort(), ['pg-a', 'pg-b']);
  const lab = cards.find((c) => c.id === 'pg-b');
  assert.equal(lab.front, 'culture · “The culture grew overnight.”');
  assert.equal(lab.back, '培养物');
  assert.equal(lab.source, 'Lab notes');
  const note = toFlashcardNote(cards);
  assert.match(note, /culture · “The culture grew overnight\.”::培养物 · \[\[Lab notes\]\] <!--pg:pg-b-->/);
});

test('Anki text uses the stable id as GUID and links back to the note', () => {
  const text = toAnkiText(collectCards(sensed, {}), 'My Vault');
  const lines = text.trim().split('\n');
  assert.deepEqual(lines.slice(0, 4), ['#separator:tab', '#html:true', '#guid column:1', '#tags column:4']);
  const row = lines.find((line) => line.startsWith('pg-b\t')).split('\t');
  assert.equal(row.length, 4);
  assert.equal(row[1], 'culture · “The culture grew overnight.”');
  assert.equal(row[2], '培养物 · <a href="obsidian://open?vault=My%20Vault&amp;file=Lab%20notes">Lab notes</a>');
  assert.equal(row[3], 'english');
  // Re-exporting gives the same rows, so Anki updates instead of adding.
  assert.equal(toAnkiText(collectCards(sensed, {}), 'My Vault'), text);
});

test('Anki text escapes HTML from the word list', () => {
  const text = toAnkiText(collectCards({ a: { id: 'pg-x', word: '<b>', translation: 'x & y', createdAt: 1, reviewCount: 0, difficulty: 2, reviewHistory: [] } }, {}));
  assert.ok(text.includes('pg-x\t&lt;b&gt;\tx &amp; y\tenglish'));
});
