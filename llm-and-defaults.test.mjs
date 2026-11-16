import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import esbuild from 'esbuild';

function load(entry, obsidian) {
  const code = esbuild.buildSync({ entryPoints: [path.join(import.meta.dirname, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => obsidian, console, setTimeout, clearTimeout, window: { setTimeout, clearTimeout }, document: {}, navigator: {}, AbortController, URL });
  return module.exports;
}

// Any Obsidian class the bundle extends becomes an empty class.
const obsidianStub = (requestUrl) => new Proxy({ requestUrl }, { get: (t, k) => (k in t ? t[k] : class {}) });

// Requests go through rex-ai-kit; one bundle so the client and the callers share it.
function withAi(requestUrl, keys = {}) {
  const m = load('ai-entry.test-only.mjs', obsidianStub(requestUrl));
  m.initAi({ getSecret: (n) => keys[n] ?? null }, undefined);
  return m;
}
const logger = { error() {}, info() {} };
const config = (ai) => ({ name: 'X', enabled: true, ai });

test('translation goes to the chosen provider with the key from the Keychain; reasoning models get no temperature', async () => {
  const seen = [];
  const m = withAi(async (req) => { seen.push(req); return { status: 200, text: JSON.stringify({ choices: [{ message: { content: ' 你好 ' } }] }) }; }, { 'openai-api-key': 'fake-o', 'deepseek-api-key': 'fake-d' });
  assert.equal(await m.getChineseTranslationTS('hi', {}, logger, config({ provider: 'openai', model: 'gpt-6-luna' })), '你好');
  assert.equal(seen[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(seen[0].headers.Authorization, 'Bearer fake-o');
  assert.equal('temperature' in JSON.parse(seen[0].body), false);
  await m.getChineseTranslationTS('hi', {}, logger, config({ provider: 'deepseek', model: 'deepseek-flash' }));
  assert.equal(JSON.parse(seen[1].body).temperature, 0);
});

test('without a usable configuration nothing is sent', async () => {
  let calls = 0;
  const m = withAi(async () => { calls++; return { status: 200, text: '{}' }; });
  assert.equal(await m.getChineseTranslationTS('hi', {}, logger, config({ provider: 'openai', model: 'gpt-6-luna' })), null);
  assert.equal(await m.getChineseTranslationTS('hi', {}, logger, null), null);
  assert.equal(calls, 0);
});

test('a failed analysis says which service failed and what to do next', async () => {
  const m = withAi(async () => ({ status: 402, text: JSON.stringify({ error: { message: 'Insufficient Balance' } }) }), { 'deepseek-api-key': 'fake-d' });
  const text = await m.getJapaneseTranslationTS('猫', { japaneseSections: {} }, logger, config({ provider: 'deepseek', model: 'deepseek-flash' }));
  assert.match(text, /^DeepSeek：余额或额度不足。去服务商后台充值，或换一家服务商。/);
});

test('translation returns null when the reply has no text', async () => {
  const m = withAi(async () => ({ status: 200, text: '{}' }), { 'openai-api-key': 'k' });
  assert.equal(await m.getChineseTranslationTS('hi', {}, logger, config({ provider: 'openai', model: 'gpt-6-luna' })), null);
});

test('editing settings never changes the defaults', () => {
  const main = load('src/main.ts', obsidianStub(async () => ({})));
  const first = main.freshDefaultSettings();
  first.apiConfigs[0].model = 'changed';
  first.queryHistory.push('word');
  const second = main.freshDefaultSettings();
  assert.notEqual(second.apiConfigs[0].model, 'changed');
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
