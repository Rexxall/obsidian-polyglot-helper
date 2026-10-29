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

const { mergeVocabEntry } = load('src/vocab-merge.ts');
const { collectCards } = load('src/vocab-export.ts');

test('adding a word twice keeps the edited meaning and accumulates context', () => {
  const existing = {
    word: 'postpone',
    translation: '推迟（我改过）',
    notes: '收自 [[Meeting notes]] · 2026-10-01',
    examples: ['They postponed the vote.'],
    tags: ['查词'],
  };
  const merged = mergeVocabEntry(existing, {
    translation: '延期',
    notes: '收自 [[Reading list]] · 2026-10-29',
    examples: ['The committee decided to postpone the vote until the figures are reliable.', 'they postponed the vote. '],
    tags: ['查词小卡'],
  });
  assert.equal(merged.translation, '推迟（我改过）');
  assert.deepEqual(JSON.parse(JSON.stringify(merged.examples)), [
    'The committee decided to postpone the vote until the figures are reliable.',
    'They postponed the vote.',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.tags)), ['查词', '查词小卡']);
  assert.equal(merged.notes, '收自 [[Meeting notes]] · 2026-10-01\n收自 [[Reading list]] · 2026-10-29');

  const again = mergeVocabEntry(merged, { translation: '', notes: '收自 [[Reading list]] · 2026-10-30', examples: [] });
  assert.equal(again.notes.split('\n').length, 2, 'the same source on another day is not added twice');

  const blank = mergeVocabEntry({ translation: '', notes: '' }, { translation: '延期' });
  assert.equal(blank.translation, '延期');
});

test('exported cards carry the original sentence and where it came from', () => {
  const cards = collectCards(
    {
      postpone: {
        word: 'postpone', translation: '推迟', phonetics: '/pəʊstˈpəʊn/', partOfSpeech: '动词',
        examples: ['They postponed the vote.'], notes: '收自 [[Meeting notes]] · 2026-10-01',
        createdAt: 0, reviewCount: 0, difficulty: 2, reviewHistory: [], nextReview: 0, tags: [],
      },
    },
    {},
  );
  assert.equal(cards[0].front, 'postpone');
  assert.match(cards[0].back, /推迟 · “They postponed the vote\.”（收自 \[\[Meeting notes\]\]）$/);
});
