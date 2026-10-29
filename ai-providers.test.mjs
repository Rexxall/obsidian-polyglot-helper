import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import esbuild from 'esbuild';

function load(entry) {
  const code = esbuild.buildSync({ entryPoints: [path.join(import.meta.dirname, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
  const module = { exports: {} };
  const window = { setTimeout, clearTimeout };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}), console, window, URL, Date, JSON, Promise });
  return module.exports;
}

const ai = load('src/ai/providers.ts');
const i18n = load('src/shared/i18n.ts');
const KEY = 'fixture-key-0000';

test('presets cover the domestic providers and DeepSeek is first', () => {
  const ids = ai.PROVIDERS.map((p) => p.id);
  assert.equal(ids[0], 'deepseek');
  for (const id of ['qwen', 'siliconflow', 'kimi', 'zhipu', 'custom']) assert.ok(ids.includes(id), id);
  for (const preset of ai.PROVIDERS.filter((p) => p.id !== 'custom')) {
    assert.match(preset.endpoint, /^https:\/\/.+\/chat\/completions$/, preset.id);
    assert.ok(preset.model, preset.id);
  }
});

test('existing endpoints map back to their provider; unknown hosts are custom', () => {
  assert.equal(ai.inferProvider('https://api.deepseek.com/chat/completions'), 'deepseek');
  assert.equal(ai.inferProvider('https://api.siliconflow.cn/v1/chat/completions'), 'siliconflow');
  assert.equal(ai.inferProvider('https://my-proxy.example/v1/chat/completions'), 'custom');
  assert.equal(ai.inferProvider('not a url'), 'custom');
});

test('a base URL gets the chat-completions path', () => {
  assert.equal(ai.normalizeEndpoint('https://api.example.com/v1/'), 'https://api.example.com/v1/chat/completions');
  assert.equal(ai.normalizeEndpoint('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/chat/completions');
  assert.equal(ai.normalizeEndpoint('  '), '');
});

test('failures are sorted into the five plain-language classes', () => {
  const kind = (input) => ai.classifyAiFailure({ hasKey: true, ...input }).kind;
  assert.equal(ai.classifyAiFailure({ hasKey: false }).kind, 'no-key');
  assert.equal(kind({ status: 401, body: '{"error":"Authentication Fails"}' }), 'auth');
  assert.equal(kind({ status: 402, body: '{"error":{"message":"Insufficient Balance"}}' }), 'quota');
  assert.equal(kind({ status: 403, body: 'Sorry, your account balance is insufficient' }), 'auth');
  assert.equal(kind({ status: 400, body: '{"error":{"message":"Model Not Exist"}}' }), 'model');
  assert.equal(kind({ status: 404 }), 'model');
  assert.equal(kind({ error: new Error('timeout') }), 'timeout');
  assert.equal(kind({ error: new Error('net::ERR_NAME_NOT_RESOLVED') }), 'network');
  assert.equal(kind({ status: 429 }), 'other');
});

test('test connection sends one tiny request and reports success or a classified failure', async () => {
  const sent = [];
  const ok = await ai.testConnection(
    { apiKey: KEY, baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash' },
    async (request) => {
      sent.push(request);
      return { status: 200, text: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) };
    },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.reply, 'OK');
  const body = JSON.parse(sent[0].body);
  assert.equal(body.max_tokens, 5);
  assert.equal(sent[0].headers.Authorization, `Bearer ${KEY}`);

  const denied = await ai.testConnection(
    { apiKey: KEY, baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash' },
    async () => ({ status: 401, text: '{"error":"invalid api key"}' }),
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.kind, 'auth');

  const noKey = await ai.testConnection({ apiKey: ' ', baseUrl: 'x', model: 'y' }, async () => assert.fail('must not send'));
  assert.equal(noKey.kind, 'no-key');

  const slow = await ai.testConnection(
    { apiKey: KEY, baseUrl: 'https://x.example/chat/completions', model: 'm' },
    () => new Promise(() => {}),
    30,
  );
  assert.equal(slow.kind, 'timeout');
});

test('interface language follows Obsidian: Chinese for zh, English otherwise', () => {
  assert.equal(i18n.tr('中', 'en'), '中');
  i18n.setInterfaceLanguage('en');
  assert.equal(i18n.tr('中', 'en'), 'en');
  i18n.setInterfaceLanguage('zh-TW');
  assert.equal(i18n.tr('中', 'en'), '中');
  i18n.setInterfaceLanguage('fr');
  assert.equal(i18n.tr('中', 'en'), 'en');
});

test('log details never carry keys or the looked-up text', () => {
  const logger = load('src/shared/Logger.ts');
  const json = JSON.stringify({ apiKey: 'sk-abcdefghijk', text: 'secret sentence', status: 401 }, logger.redactField);
  assert.doesNotMatch(json, /abcdefghijk|secret sentence/);
  assert.match(json, /"status":401/);
  assert.equal(logger.redactText('failed with Bearer abcdefghijklmnop and sk-12345678901'), 'failed with Bearer [hidden] and sk-[hidden]');
});
