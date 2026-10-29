import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import esbuild from 'esbuild';

function load(entry, obsidian) {
  const code = esbuild.buildSync({ entryPoints: [path.join(import.meta.dirname, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => obsidian, console, setTimeout, clearTimeout, window: { setTimeout, clearTimeout }, document: {}, navigator: {} });
  return module.exports;
}

// Any Obsidian class the bundle extends becomes an empty class.
const obsidianStub = (requestUrl) => new Proxy({ requestUrl }, { get: (t, k) => (k in t ? t[k] : class {}) });

test('a hanging LLM request stops after the timeout', async () => {
  const llm = load('src/apis/llm.ts', obsidianStub(() => new Promise(() => {})));
  await assert.rejects(llm.postChatCompletion('https://example.invalid', 'k', {}, 20), /秒未响应/);
});

test('a non-200 reply is returned, not thrown', async () => {
  let seen;
  const llm = load('src/apis/llm.ts', obsidianStub(async (req) => { seen = req; return { status: 401, text: 'unauthorized' }; }));
  const response = await llm.postChatCompletion('https://example.invalid', 'k', { model: 'm' });
  assert.equal(response.status, 401);
  assert.equal(seen.throw, false);
  assert.equal(JSON.parse(seen.body).model, 'm');
});

test('translation returns null when the reply has no choices', async () => {
  const llm = load('src/apis/llm.ts', obsidianStub(async () => ({ status: 200, json: {} })));
  const logger = { error() {} };
  const settings = { englishLlmApiKey: 'k', englishLlmBaseUrl: 'https://example.invalid', englishModelName: 'm' };
  assert.equal(await llm.getChineseTranslationTS('hi', settings, logger), null);
});

test('editing settings never changes the defaults', () => {
  const main = load('src/main.ts', obsidianStub(async () => ({})));
  const first = main.freshDefaultSettings();
  first.apiConfigs[0].apiKey = 'changed';
  first.queryHistory.push('word');
  const second = main.freshDefaultSettings();
  assert.notEqual(second.apiConfigs[0].apiKey, 'changed');
  assert.equal(second.queryHistory.length, 0);
});

test('replacing a multi-line selection keeps the text after it', () => {
  const utils = load('src/utils.ts', obsidianStub(async () => ({})));
  const content = 'line0\nab[start\nmiddle\nend]cd\nline4';
  const result = utils.replaceSelectionInText(content, { from: { line: 1, ch: 2 }, to: { line: 3, ch: 4 } }, 'WORD');
  assert.equal(result, 'line0\nabWORDcd\nline4');
  const single = utils.replaceSelectionInText('hello world', { from: { line: 0, ch: 6 }, to: { line: 0, ch: 11 } }, 'there');
  assert.equal(single, 'hello there');
});
