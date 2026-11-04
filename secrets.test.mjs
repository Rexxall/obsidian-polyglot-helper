import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import esbuild from 'esbuild';

function load(entry) {
  const code = esbuild.buildSync({ entryPoints: [path.join(import.meta.dirname, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}), console, URL });
  return module.exports;
}

const { moveKeysToStorage, bindKeys, namesForConfig } = load('src/secrets.ts');

// A stand-in for Obsidian's secret storage; `taken` holds keys other plugins saved before. All keys are made up.
function storage(taken = {}) {
  const map = new Map(Object.entries(taken));
  return { map, getSecret: (id) => map.get(id) ?? null, setSecret: (id, value) => { if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`bad id ${id}`); map.set(id, value); } };
}

const settings = (extra = {}) => ({
  apiConfigs: [
    { name: 'DeepSeek', provider: 'deepseek', apiKey: 'fake-deepseek', baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', enabled: true },
    { name: 'My proxy', provider: 'custom', apiKey: 'fake-proxy', baseUrl: 'https://proxy.example/v1/chat/completions', model: 'm', enabled: true },
    { name: 'Empty', provider: 'qwen', apiKey: '', baseUrl: '', model: 'q', enabled: false },
  ],
  englishLlmApiKey: '', englishLlmBaseUrl: 'https://openrouter.ai/api/v1/chat/completions',
  openaiTtsApiKey: 'fake-tts', openaiTtsBaseUrl: 'https://api.openai.com/v1',
  youdaoAppKey: 'app-id', youdaoAppSecret: 'fake-youdao', geminiTtsApiKey: '', mwThesaurusKey: '', mwMedicalKey: '',
  cloudSync: { enabled: false, endpoint: '', apiKey: '', autoSync: false, syncInterval: 60, lastSync: 0 },
  ...extra,
});

test('written keys move to shared names and leave nothing in the saved settings', () => {
  const s = settings(), store = storage();
  assert.equal(moveKeysToStorage(s, store), true);
  bindKeys(s, store);
  assert.equal(s.apiConfigs[0].apiKeySecret, 'deepseek-api-key');
  assert.equal(s.apiConfigs[1].apiKeySecret, 'polyglot-helper-my-proxy-api-key');
  assert.equal(s.apiConfigs[2].apiKeySecret, undefined);
  assert.equal(s.keySecrets.openaiTtsApiKey, 'openai-api-key');
  assert.equal(s.keySecrets.youdaoAppSecret, 'youdao-app-secret');
  assert.equal(s.keySecrets.englishLlmApiKey, undefined);
  // Keys still read the same while running…
  assert.equal(s.apiConfigs[0].apiKey, 'fake-deepseek');
  assert.equal(s.openaiTtsApiKey, 'fake-tts');
  assert.equal(s.apiConfigs[2].apiKey, '');
  // …but what saveData writes has none of them; the app ID is not a key and stays.
  const saved = JSON.parse(JSON.stringify(s));
  assert.doesNotMatch(JSON.stringify(saved), /fake-|"apiKey"/);
  for (const field of ['englishLlmApiKey', 'openaiTtsApiKey', 'youdaoAppSecret', 'geminiTtsApiKey', 'mwThesaurusKey', 'mwMedicalKey']) assert.equal(field in saved, false, field);
  assert.equal(saved.youdaoAppKey, 'app-id');
});

test('another plugin\'s key under the shared name is kept; the same key is reused', () => {
  const store = storage({ 'deepseek-api-key': 'someone-elses', 'openai-api-key': 'fake-tts' });
  const s = settings();
  moveKeysToStorage(s, store);
  assert.equal(s.apiConfigs[0].apiKeySecret, 'polyglot-helper-deepseek-api-key');
  assert.equal(store.map.get('deepseek-api-key'), 'someone-elses');
  assert.equal(s.keySecrets.openaiTtsApiKey, 'openai-api-key');
});

test('a second start changes nothing, and a key changed elsewhere is read at once', () => {
  const store = storage(), s = settings();
  moveKeysToStorage(s, store); bindKeys(s, store);
  const reloaded = JSON.parse(JSON.stringify(s));
  assert.equal(moveKeysToStorage(reloaded, store), false);
  bindKeys(reloaded, store);
  store.setSecret('deepseek-api-key', 'fake-new');
  assert.equal(reloaded.apiConfigs[0].apiKey, 'fake-new');
});

test('a configuration added later gets a key getter on the next bind', () => {
  const store = storage({ 'kimi-api-key': 'fake-kimi' }), s = settings();
  moveKeysToStorage(s, store); bindKeys(s, store);
  s.apiConfigs.push({ name: 'Kimi', provider: 'kimi', apiKeySecret: 'kimi-api-key', baseUrl: '', model: 'k', enabled: true });
  bindKeys(s, store);
  assert.equal(s.apiConfigs[3].apiKey, 'fake-kimi');
  assert.doesNotMatch(JSON.stringify(s), /fake-kimi/);
});

test('custom configurations recognise a known provider by address', () => {
  const names = (config) => [...namesForConfig(config)];
  assert.deepEqual(names({ name: 'SF', provider: 'custom', baseUrl: 'https://api.siliconflow.cn/v1/chat/completions' }), ['siliconflow-api-key', 'polyglot-helper-sf-api-key']);
  assert.deepEqual(names({ name: '中文名', provider: 'custom', baseUrl: '' }), ['polyglot-helper-ai-api-key']);
});
