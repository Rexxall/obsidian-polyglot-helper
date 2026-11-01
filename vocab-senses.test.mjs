import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import esbuild from 'esbuild';

function load(entry) {
  const code = esbuild.buildSync({ entryPoints: [path.join(import.meta.dirname, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
  const module = { exports: {} };
  const obsidian = { Notice: class {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => obsidian, console, Date }, {});
  return module.exports;
}

const { ensureIds, stableId, senseKeys, nextSenseKey, keyOf, baseKey } = load('src/vocab-senses.ts');
const { LearningTracker } = load('src/learning-tracker.ts');

// Anonymized from the shape of a real word list: English keys are lowercase words, Japanese keys
// are "original_japanese", entries from before 1.9.0 have no id, notes carry "收自 [[note]] · date".
function fixture() {
  return {
    english: {
      alpha: { word: 'alpha', translation: '甲', notes: '收自 [[Note A]] · 2026-10-20', examples: ['Alpha is first.'], createdAt: 1761000000000, reviewCount: 3, difficulty: 1, reviewHistory: [{ timestamp: 1, performance: 4 }], nextReview: 1762000000000 },
      'beta gamma': { word: 'beta gamma', translation: '乙丙', createdAt: 1761000000001, reviewCount: 0, difficulty: 2, reviewHistory: [] },
    },
    japanese: {
      '例_例': { originalText: '例', japaneseText: '例', reading: 'れい', translation: 'example', createdAt: 1761000000002, reviewCount: 1, difficulty: 2, reviewHistory: [] },
    },
  };
}

test('migration gives every old entry an id, the same on every device, and keeps everything else', () => {
  const a = fixture();
  const b = fixture();
  assert.equal(ensureIds(a.english, 'en') + ensureIds(a.japanese, 'ja'), 3);
  ensureIds(b.english, 'en');
  ensureIds(b.japanese, 'ja');
  assert.deepEqual(a, b);
  assert.match(a.english.alpha.id, /^pg-[0-9a-z]{14}$/);
  assert.equal(a.english.alpha.id, stableId('en', 'alpha', 1761000000000));
  assert.notEqual(a.english.alpha.id, a.english['beta gamma'].id);
  assert.equal(a.english.alpha.reviewCount, 3);
  assert.equal(a.english.alpha.nextReview, 1762000000000);
  // Running it again changes nothing.
  assert.equal(ensureIds(a.english, 'en'), 0);
});

test('sense keys: the first meaning keeps the word key, later ones get #2, #3', () => {
  const store = { run: {}, 'run#2': {}, 'run#10': {}, runner: {}, 'run#3': {} };
  assert.deepEqual([...senseKeys(store, 'run')], ['run', 'run#2', 'run#3', 'run#10']);
  assert.equal(nextSenseKey(store, 'run'), 'run#4');
  assert.equal(nextSenseKey(store, 'walk'), 'walk');
  assert.equal(baseKey('例_例#2'), '例_例');
});

function tracker(data) {
  const settings = { enableLearningTracker: true, englishVocabItems: data.english, japaneseVocabItems: data.japanese, learningStats: { totalWords: 3 }, dailyRecords: [] };
  const t = Object.create(LearningTracker.prototype);
  t.settings = settings;
  t.saveSettings = async () => {};
  t.updateDailyStats = () => {};
  return t;
}

test('a new meaning is its own entry with its own review state; reviewing it leaves the first meaning alone', async () => {
  const data = fixture();
  ensureIds(data.english, 'en');
  const t = tracker(data);
  await t.addEnglishVocabularyItem('alpha', '首领', '', '', [], '收自 [[Note B]] · 2026-11-02', ['The alpha led the pack.'], [], 'new');
  const second = data.english['alpha#2'];
  assert.equal(second.translation, '首领');
  assert.equal(second.reviewCount, 0);
  assert.match(second.id, /^pg-/);
  assert.notEqual(second.id, data.english.alpha.id);
  assert.ok(t.hasOtherSenses(second));

  await t.recordEnglishReview(second, 5);
  assert.equal(second.reviewCount, 1);
  assert.equal(data.english.alpha.reviewCount, 3);

  // Adding to an existing meaning merges the sentence and keeps the user's meaning.
  await t.addEnglishVocabularyItem('alpha', '另一个说法', '', '', [], '', ['Alpha again.'], [], 'alpha#2');
  assert.equal(data.english['alpha#2'].translation, '首领');
  assert.deepEqual([...data.english['alpha#2'].examples], ['Alpha again.', 'The alpha led the pack.']);
  assert.equal(Object.keys(data.english).length, 3);

  // Removing the second meaning keeps the first.
  await t.removeEnglishVocabularyItem(data.english['alpha#2']);
  assert.ok(data.english.alpha);
  assert.ok(!data.english['alpha#2']);
  assert.equal(t.hasOtherSenses(data.english.alpha), false);
});

test('entries are found by id when the object was copied', () => {
  const data = fixture();
  ensureIds(data.japanese, 'ja');
  const copy = { ...data.japanese['例_例'] };
  assert.equal(keyOf(data.japanese, copy), '例_例');
});
