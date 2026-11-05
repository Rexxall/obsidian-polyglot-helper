import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import esbuild from 'esbuild';

function load(entry) {
  const code = esbuild.buildSync({ entryPoints: [path.join(import.meta.dirname, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}), console, Error });
  return module.exports;
}
const { syncToAnki, ankiConnectInvoke, NOTE_TYPE } = load('src/anki-connect.ts');

/** A small in-memory AnkiConnect: just the actions the sync uses. */
function fakeAnki() {
  const state = { models: [], decks: new Set(), notes: new Map(), next: 1, calls: [] };
  const handle = (action, params) => {
    state.calls.push(action);
    switch (action) {
      case 'version': return 6;
      case 'modelNames': return state.models.map((m) => m.modelName);
      case 'createModel': state.models.push(params); return {};
      case 'createDeck': state.decks.add(params.deck); return 1;
      case 'findNotes': return [...state.notes.keys()];
      case 'notesInfo': return params.notes.map((id) => ({ noteId: id, fields: Object.fromEntries(Object.entries(state.notes.get(id).fields).map(([k, v]) => [k, { value: v }])) }));
      case 'addNotes': return params.notes.map((n) => { const id = state.next++; state.notes.set(id, { ...n, fields: { ...n.fields } }); return id; });
      case 'updateNoteFields': Object.assign(state.notes.get(params.note.id).fields, params.note.fields); return null;
      case 'multi': return params.actions.map((a) => ({ result: handle(a.action, a.params), error: null }));
      default: throw new Error('unsupported action ' + action);
    }
  };
  const post = async (body) => {
    const { action, version, params } = JSON.parse(body);
    assert.equal(version, 6);
    try { return { result: handle(action, params), error: null }; } catch (e) { return { result: null, error: e.message }; }
  };
  return { state, invoke: ankiConnectInvoke(post) };
}

const card = (id, front, back, source = '') => ({ id, front, back, source, tags: ['japanese', 'reading list'] });

test('first send creates the note type, the deck and every card', async () => {
  const { state, invoke } = fakeAnki();
  const result = await syncToAnki(invoke, [card('ja-k1', '猫', 'ねこ · cat', '駅前に新しい図書館'), card('en-a', 'a < b', 'x & y')], 'Polyglot', 'Demo Vault');
  assert.deepEqual({ ...result }, { added: 2, updated: 0, unchanged: 0 });
  assert.equal(state.models[0].modelName, NOTE_TYPE);
  assert.ok(state.decks.has('Polyglot'));
  const neko = [...state.notes.values()].find((n) => n.fields.PolyglotId === 'ja-k1');
  assert.equal(neko.deckName, 'Polyglot');
  assert.deepEqual([...neko.tags], ['polyglot', 'japanese', 'reading_list']);
  assert.match(neko.fields.Source, /obsidian:\/\/open\?vault=Demo%20Vault&amp;file=/);
  assert.equal([...state.notes.values()].find((n) => n.fields.PolyglotId === 'en-a').fields.Front, 'a &lt; b');
});

test('sending again updates changed cards by id, adds new ones and leaves the rest', async () => {
  const { state, invoke } = fakeAnki();
  await syncToAnki(invoke, [card('ja-k1', '猫', 'ねこ · cat'), card('ja-k2', '犬', 'いぬ · dog')], 'Polyglot', '');
  const result = await syncToAnki(invoke, [card('ja-k1', '猫', 'ねこ · cat, kitty'), card('ja-k2', '犬', 'いぬ · dog'), card('ja-k3', '鳥', 'とり · bird')], 'Polyglot', '');
  assert.deepEqual({ ...result }, { added: 1, updated: 1, unchanged: 1 });
  assert.equal(state.notes.size, 3);
  assert.equal([...state.notes.values()].find((n) => n.fields.PolyglotId === 'ja-k1').fields.Back, 'ねこ · cat, kitty');
  assert.equal(state.models.length, 1, 'the note type is created once');
});

test('an AnkiConnect error is thrown with its message', async () => {
  const invoke = ankiConnectInvoke(async () => ({ result: null, error: 'collection is not available' }));
  await assert.rejects(syncToAnki(invoke, [card('x', 'a', 'b')], 'Polyglot', ''), /collection is not available/);
  const notAnki = ankiConnectInvoke(async () => '<html>Error 501</html>');
  await assert.rejects(syncToAnki(notAnki, [card('x', 'a', 'b')], 'Polyglot', ''), /Not an AnkiConnect reply/);
});
