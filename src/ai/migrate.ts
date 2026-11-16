/**
 * AI settings before 1.12: each configuration held a full chat-completions URL, a model and a key
 * name; a second set of single fields (englishLlm…, openaiLlm…, llmProvider, ollama…) was the old
 * fallback. All become rex-ai-kit slots. Free of Obsidian imports so it can be tested in Node.
 */
import { defaultModel, getProvider, migrateKey, resolveProvider, slotFromEndpoint, type AiSlot, type KeyStore } from '../vendor/rex-ai-kit/index';
import type { ApiConfig } from '../types';

/** What a new install starts with: OpenAI's small model, cheap and good at short translations. */
export function defaultConfigs(): ApiConfig[] {
	return [{ name: 'OpenAI', enabled: true, ai: { provider: 'openai', model: 'gpt-6-luna' } }];
}

interface OldConfig {
	name?: string;
	provider?: string;
	baseUrl?: string;
	model?: string;
	enabled?: boolean;
	apiKeySecret?: string;
	ai?: AiSlot;
}

const LEGACY_FIELDS = ['englishLlmBaseUrl', 'englishModelName', 'llmProvider', 'openaiLlmBaseUrl', 'ollamaUrl', 'ollamaModel', 'modelName', 'textGenApiKey'] as const;
const BROKEN_OPENROUTER = 'https://api.openrouter.ai/';

/** The plugin stored ".../v1/chat/completions"; the kit wants the base. */
function base(url: string | undefined): string {
	return (url ?? '').trim().replace(BROKEN_OPENROUTER, 'https://openrouter.ai/').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

function slotOf(old: { url?: string; provider?: string; model?: string; secretName?: string }): AiSlot {
	const slot = slotFromEndpoint({ url: base(old.url), provider: old.provider, model: old.model, secretName: old.secretName });
	if (!slot.model) {
		const p = getProvider(slot.provider);
		if (p) slot.model = defaultModel(p, 'cheap');
	}
	return slot;
}

function read(store: Pick<KeyStore, 'getSecret'>, name: string | undefined): string {
	if (!name) return '';
	try {
		return store.getSecret(name)?.trim() ?? '';
	} catch {
		return '';
	}
}

function uniqueName(configs: ApiConfig[], wanted: string): string {
	let name = wanted;
	for (let i = 2; configs.some((c) => c.name === name); i++) name = `${wanted} ${i}`;
	return name;
}

/**
 * Brings the AI part of the settings to the kit's shape, in place. Run after plain keys have moved to
 * the Keychain (secrets.ts). Returns true when anything changed and the settings should be saved.
 */
export function migrateAiSettings(settings: object, store: Required<Pick<KeyStore, 'getSecret' | 'setSecret'>>): boolean {
	const s = settings as Record<string, unknown> & { apiConfigs?: OldConfig[]; apiSelectors?: Record<string, string>; keySecrets?: Record<string, string | undefined> };
	let changed = false;
	const configs: ApiConfig[] = [];
	for (const old of Array.isArray(s.apiConfigs) ? s.apiConfigs : []) {
		if (old.ai && typeof old.ai.provider === 'string') {
			configs.push({ name: old.name || 'AI', enabled: old.enabled !== false, ai: { ...old.ai } });
			continue;
		}
		changed = true;
		configs.push({ name: old.name || uniqueName(configs, 'AI'), enabled: old.enabled !== false, ai: slotOf({ url: old.baseUrl, provider: old.provider, model: old.model, secretName: old.apiKeySecret }) });
	}

	// The old single fields only count when a key was chosen for them; without one they never worked.
	const secrets = s.keySecrets ?? {};
	const legacy: { name: string; url?: unknown; model?: unknown; secret?: string }[] = [];
	if (secrets.englishLlmApiKey) legacy.push({ name: 'English LLM', url: s.englishLlmBaseUrl, model: s.englishModelName, secret: secrets.englishLlmApiKey });
	if (secrets.openaiApiKey) legacy.push({ name: 'OpenAI (Japanese)', url: s.openaiLlmBaseUrl || 'https://api.openai.com/v1', model: s.englishModelName, secret: secrets.openaiApiKey });
	for (const l of legacy) {
		const slot = slotOf({ url: typeof l.url === 'string' ? l.url : '', model: typeof l.model === 'string' ? l.model : '', secretName: l.secret });
		const same = configs.some((c) => c.ai.provider === slot.provider && (c.ai.baseUrl ?? '') === (slot.baseUrl ?? '') && resolveProvider(c.ai).secretName === resolveProvider(slot).secretName);
		if (!same) configs.push({ name: uniqueName(configs, l.name), enabled: true, ai: slot });
	}
	if (s.llmProvider === 'ollama' && typeof s.ollamaModel === 'string' && s.ollamaModel) {
		const url = typeof s.ollamaUrl === 'string' ? s.ollamaUrl : '';
		configs.push({ name: uniqueName(configs, 'Ollama'), enabled: true, ai: slotOf({ url: url || 'http://localhost:11434', provider: 'ollama', model: s.ollamaModel }) });
	}
	if (secrets.englishLlmApiKey !== undefined || secrets.openaiApiKey !== undefined) {
		delete secrets.englishLlmApiKey;
		delete secrets.openaiApiKey;
		changed = true;
	}
	// An early version kept one more key in plain text; nothing reads it now, but it is kept in the Keychain rather than lost.
	if (typeof s.textGenApiKey === 'string' && s.textGenApiKey.trim()) migrateKey(store, 'polyglot-helper-text-gen-api-key', s.textGenApiKey, 'polyglot-helper');
	for (const field of LEGACY_FIELDS) {
		if (field in s) {
			delete s[field];
			changed = true;
		}
	}

	// A saved key name that holds nothing, while the shared name does, gives way to the shared key.
	for (const c of configs) {
		const shared = resolveProvider({ provider: c.ai.provider }).secretName;
		if (c.ai.secretName && shared && !read(store, c.ai.secretName) && read(store, shared)) {
			delete c.ai.secretName;
			changed = true;
		}
	}
	if (configs.length === 0) {
		configs.push(...defaultConfigs());
		changed = true;
	}
	s.apiConfigs = configs;

	// Each feature keeps its configuration by name; a name that no longer exists falls back to the first one on.
	const selectors = (s.apiSelectors ??= {});
	const fallback = (configs.find((c) => c.enabled) ?? configs[0]).name;
	for (const key of ['quickTranslation', 'englishAnalysis', 'japaneseAnalysis']) {
		if (!configs.some((c) => c.name === selectors[key])) {
			selectors[key] = fallback;
			changed = true;
		}
	}
	return changed;
}
