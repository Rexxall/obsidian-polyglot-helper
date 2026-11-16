import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import esbuild from 'esbuild';

function load(entry) {
  const code = esbuild.buildSync({ entryPoints: [path.join(import.meta.dirname, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}), console, URL, Date, JSON, Promise });
  return module.exports;
}

const { migrateAiSettings } = load('src/ai/migrate.ts');
const { moveKeysToStorage } = load('src/secrets.ts');
const { isReasoningModel } = load('src/ai/sampling.ts');
const plain = (v) => JSON.parse(JSON.stringify(v));
function storage(init = {}) {
  const map = new Map(Object.entries(init));
  return { map, getSecret: (id) => map.get(id) ?? null, setSecret: (id, v) => map.set(id, v) };
}

// Same shape as the 1.11.2 settings in daily use; every value made up.
const v1112 = () => ({
  apiConfigs: [
    { name: 'Gemini', baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', enabled: false, provider: 'deepseek', apiKeySecret: 'deepseek-api-key' },
    { name: 'Xmini', baseUrl: 'https://proxy.example/v1/chat/completions', model: 'gpt-5-chat-latest', enabled: true, provider: 'custom' },
    { name: 'Xmm', baseUrl: 'https://proxy.example/v1/chat/completions', model: '', enabled: false, provider: 'custom' },
    { name: 'AI-Studio', baseUrl: 'http://localhost:2048/v1/chat/completions', model: 'gemini-3-pro-preview', enabled: true, provider: 'custom' },
    { name: 'DeepSeek', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', enabled: true, apiKeySecret: 'deepseek-api-key' },
    { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-6.1-sol', enabled: true, provider: 'openai', apiKeySecret: 'openai-api-key' },
  ],
  apiSelectors: { quickTranslation: 'DeepSeek', englishAnalysis: 'OpenAI', japaneseAnalysis: 'OpenAI' },
  englishLlmBaseUrl: 'https://proxy2.example/v1/chat/completions', englishModelName: 'gemini-2.5-pro',
  llmProvider: 'openai', openaiLlmBaseUrl: 'https://proxy2.example/v1/chat/completions', ollamaModel: 'llama3', modelName: 'gemini-2.5-pro',
  textGenApiKey: 'fake-textgen-0000',
  ttsEngine: 'openai', openaiTtsModel: 'gpt-4o-mini-tts', geminiTtsModel: 'gemini-2.5-flash-preview-tts',
  keySecrets: { mwThesaurusKey: 'mw-thesaurus', mwMedicalKey: 'mw-medical' },
});

test('1.11.2 in daily use: every configuration, model, on/off state and feature choice kept; shared keys used', () => {
  const s = v1112(), store = storage({ 'deepseek-api-key': 'd', 'openai-api-key': 'o', 'mw-thesaurus': 't', 'mw-medical': 'm' });
  moveKeysToStorage(s, store);
  assert.equal(migrateAiSettings(s, store), true);
  assert.deepEqual(plain(s.apiConfigs), [
    { name: 'Gemini', enabled: false, ai: { provider: 'deepseek', model: 'deepseek-flash' } },
    { name: 'Xmini', enabled: true, ai: { provider: 'custom', model: 'gpt-5-chat-latest', baseUrl: 'https://proxy.example/v1' } },
    { name: 'Xmm', enabled: false, ai: { provider: 'custom', model: '', baseUrl: 'https://proxy.example/v1' } },
    { name: 'AI-Studio', enabled: true, ai: { provider: 'custom', model: 'gemini-3-pro-preview', baseUrl: 'http://localhost:2048/v1' } },
    { name: 'DeepSeek', enabled: true, ai: { provider: 'deepseek', model: 'deepseek-flash' } },
    { name: 'OpenAI', enabled: true, ai: { provider: 'openai', model: 'gpt-6.1-sol' } },
  ]);
  assert.deepEqual(plain(s.apiSelectors), { quickTranslation: 'DeepSeek', englishAnalysis: 'OpenAI', japaneseAnalysis: 'OpenAI' });
  // TTS and dictionary keys are untouched.
  assert.deepEqual(plain(s.keySecrets), { mwThesaurusKey: 'mw-thesaurus', mwMedicalKey: 'mw-medical' });
  assert.equal(s.openaiTtsModel, 'gpt-4o-mini-tts');
  // Old single fields are gone; the plain key from an early version is kept in the Keychain, not in the settings.
  for (const f of ['englishLlmBaseUrl', 'englishModelName', 'llmProvider', 'openaiLlmBaseUrl', 'ollamaModel', 'modelName', 'textGenApiKey']) assert.equal(f in s, false, f);
  assert.equal(store.map.get('polyglot-helper-text-gen-api-key'), 'fake-textgen-0000');
  assert.doesNotMatch(JSON.stringify(s), /fake-/);
});

test('migrating twice changes nothing', () => {
  const s = v1112(), store = storage({ 'deepseek-api-key': 'd' });
  moveKeysToStorage(s, store); migrateAiSettings(s, store);
  const once = plain(s);
  assert.equal(migrateAiSettings(once, store), false);
  assert.deepEqual(plain(once), plain(s));
});

test('plain keys from 1.9 and earlier, the old single fields with a key, and an own key name', () => {
  const store = storage({ 'polyglot-helper-proxy-api-key': 'p' });
  const s = {
    apiConfigs: [
      { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1/chat/completions', model: 'kimi-k3', enabled: true, apiKey: 'fake-kimi' },
      { name: 'Proxy', provider: 'custom', baseUrl: 'https://api.openrouter.ai/api/v1/chat/completions', model: 'x', enabled: true, apiKeySecret: 'polyglot-helper-proxy-api-key' },
    ],
    apiSelectors: { quickTranslation: 'Gone', englishAnalysis: 'Kimi', japaneseAnalysis: 'Kimi' },
    englishLlmApiKey: 'fake-eng', englishLlmBaseUrl: 'https://openrouter.ai/api/v1/chat/completions', englishModelName: 'google/gemini-2.5-flash',
    llmProvider: 'openai', openaiLlmBaseUrl: '',
  };
  moveKeysToStorage(s, store);
  migrateAiSettings(s, store);
  assert.deepEqual(plain(s.apiConfigs), [
    { name: 'Kimi', enabled: true, ai: { provider: 'kimi', model: 'kimi-k3' } },
    // The OpenRouter host of 1.3.x is repaired on the way, and the address then matches OpenRouter itself.
    { name: 'Proxy', enabled: true, ai: { provider: 'openrouter', model: 'x', secretName: 'polyglot-helper-proxy-api-key' } },
    { name: 'English LLM', enabled: true, ai: { provider: 'openrouter', model: 'google/gemini-2.5-flash' } },
  ]);
  assert.equal(store.map.get('kimi-api-key'), 'fake-kimi');
  assert.equal(store.map.get('openrouter-api-key'), 'fake-eng');
  assert.equal(s.apiSelectors.quickTranslation, 'Kimi', 'a choice naming a missing configuration falls back to the first one on');
  assert.equal('englishLlmApiKey' in (s.keySecrets ?? {}), false);
  assert.doesNotMatch(JSON.stringify(s), /fake-/);
});

test('a saved key name that holds nothing gives way to the shared key; a new install starts on OpenAI gpt-6-luna', () => {
  const store = storage({ 'openai-api-key': 'o' });
  const s = { apiConfigs: [{ name: 'O', provider: 'openai', baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', enabled: true, apiKeySecret: 'polyglot-helper-o-api-key' }], apiSelectors: {} };
  migrateAiSettings(s, store);
  assert.deepEqual(plain(s.apiConfigs[0].ai), { provider: 'openai', model: 'gpt-4o-mini' });
  const fresh = { apiConfigs: [], apiSelectors: {} };
  migrateAiSettings(fresh, storage());
  assert.deepEqual(plain(fresh.apiConfigs), [{ name: 'OpenAI', enabled: true, ai: { provider: 'openai', model: 'gpt-6-luna' } }]);
  assert.deepEqual(plain(fresh.apiSelectors), { quickTranslation: 'OpenAI', englishAnalysis: 'OpenAI', japaneseAnalysis: 'OpenAI' });
});

test('models that only take their default temperature are recognised, Claude 5 included', () => {
  for (const m of ['gpt-6-luna', 'gpt-6.1-sol', 'o4-mini', 'claude-sonnet-5-5', 'anthropic/claude-opus-5-5']) assert.equal(isReasoningModel(m), true, m);
  for (const m of ['deepseek-flash', 'gpt-4o-mini', 'claude-3-5-haiku', 'qwen-plus']) assert.equal(isReasoningModel(m), false, m);
});
