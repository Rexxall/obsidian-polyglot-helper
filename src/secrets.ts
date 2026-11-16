/**
 * API keys live in Obsidian's secret storage; the settings keep only each key's name.
 * While the plugin runs, the old fields (config.apiKey, settings.openaiTtsApiKey, …) are getters
 * that read the key from storage when it is used. They are not enumerable, so saveData never
 * writes a key into data.json. Free of Obsidian imports so it can be tested in Node.
 */
import { inferProviderId } from './vendor/rex-ai-kit/index';
import type { PolyglotHelperSettings } from './types';

/** An AI configuration as versions before 1.12 saved it: full endpoint, model and key name. */
interface OldApiConfig {
	name: string;
	provider?: string;
	baseUrl?: string;
	apiKeySecret?: string;
}

const inferProvider = (url: string) => inferProviderId(url);

export interface KeyStore {
	getSecret(id: string): string | null;
	setSecret(id: string, secret: string): void;
}

/** Settings fields that hold a key while the plugin runs; the key's name is in settings.keySecrets. */
export const KEY_FIELDS = [
	'openaiTtsApiKey',
	'youdaoAppSecret',
	'geminiTtsApiKey',
	'mwThesaurusKey',
	'mwMedicalKey',
] as const;
/** Keys of the old single AI settings; moved like the others, then turned into AI configurations (ai/migrate.ts). */
export const LEGACY_KEY_FIELDS = ['englishLlmApiKey', 'openaiApiKey'] as const;
export type KeyField = (typeof KEY_FIELDS)[number] | (typeof LEGACY_KEY_FIELDS)[number];

/** Keys for these providers go under a name other plugins share, such as deepseek-api-key, so one key serves them all. */
const SHARED_PROVIDERS = new Set(['deepseek', 'qwen', 'siliconflow', 'kimi', 'zhipu', 'openrouter', 'openai']);

const slug = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

function sharedName(endpoint: string | undefined): string[] {
	const provider = inferProvider(endpoint || '');
	return SHARED_PROVIDERS.has(provider) ? [`${provider}-api-key`] : [];
}

/** Names to try for one AI configuration's key, the shared one first. */
export function namesForConfig(config: Pick<OldApiConfig, 'name' | 'provider' | 'baseUrl'>): string[] {
	const provider = config.provider && config.provider !== 'custom' ? config.provider : inferProvider(config.baseUrl || '');
	const own = `polyglot-helper-${slug(config.name) || 'ai'}-api-key`;
	return SHARED_PROVIDERS.has(provider) ? [`${provider}-api-key`, own] : [own];
}

/** Names to try for one of the single key fields, the shared one first. */
export function namesForField(field: KeyField, settings: PolyglotHelperSettings): string[] {
	const own = `polyglot-helper-${slug(field.replace(/([a-z])([A-Z])/g, '$1-$2'))}`;
	const old = settings as PolyglotHelperSettings & { englishLlmBaseUrl?: string; openaiLlmBaseUrl?: string };
	switch (field) {
		case 'englishLlmApiKey':
			return [...sharedName(old.englishLlmBaseUrl), own];
		case 'openaiApiKey':
			return [...sharedName(old.openaiLlmBaseUrl || 'https://api.openai.com/v1'), own];
		case 'openaiTtsApiKey':
			return [...sharedName(settings.openaiTtsBaseUrl), own];
		case 'geminiTtsApiKey':
			return ['gemini-api-key', own];
		case 'youdaoAppSecret':
			return ['youdao-app-secret', own];
		case 'mwThesaurusKey':
			return ['merriam-webster-thesaurus-key', own];
		case 'mwMedicalKey':
			return ['merriam-webster-medical-key', own];
	}
}

/** Saves under the first name that is free or already holds this key, so a key another plugin saved is never overwritten. */
export function storeSecret(storage: KeyStore, names: string[], value: string): string {
	const last = names[names.length - 1];
	const candidates = [...names, ...Array.from({ length: 98 }, (_, i) => `${last}-${i + 2}`)];
	const name = candidates.find((candidate) => {
		const existing = storage.getSecret(candidate);
		return !existing || existing === value;
	}) ?? last;
	storage.setSecret(name, value);
	return name;
}

/** A plain field written in the settings, as opposed to one of the getters below. */
function takeWritten(target: object, field: string): string | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(target, field);
	if (!descriptor || !('value' in descriptor)) return undefined;
	delete (target as Record<string, unknown>)[field];
	return typeof descriptor.value === 'string' ? descriptor.value.trim() : '';
}

/**
 * Up to 1.9.x keys were written in the settings. Moves each one into storage and removes it from
 * the settings, including empty ones. Returns whether the settings changed.
 */
export function moveKeysToStorage(settings: PolyglotHelperSettings, storage: KeyStore): boolean {
	let changed = false;
	const names = (settings.keySecrets ??= {});
	for (const field of [...KEY_FIELDS, ...LEGACY_KEY_FIELDS]) {
		const key = takeWritten(settings, field);
		if (key === undefined) continue;
		changed = true;
		if (key && !names[field]) names[field] = storeSecret(storage, namesForField(field, settings), key);
	}
	for (const config of settings.apiConfigs as unknown as OldApiConfig[]) {
		const key = takeWritten(config, 'apiKey');
		if (key === undefined) continue;
		changed = true;
		if (key && !config.apiKeySecret) config.apiKeySecret = storeSecret(storage, namesForConfig(config), key);
	}
	// Cloud sync was never built; its key field had no use.
	if (settings.cloudSync && takeWritten(settings.cloudSync, 'apiKey') !== undefined) changed = true;
	return changed;
}

/** Turns the key fields into getters that read storage. AI configurations read their keys through rex-ai-kit. */
export function bindKeys(settings: PolyglotHelperSettings, storage: KeyStore) {
	const read = (name: string | undefined) => (name && storage.getSecret(name)) || '';
	const define = (target: object, field: string, name: () => string | undefined) =>
		Object.defineProperty(target, field, { get: () => read(name()), enumerable: false, configurable: true });
	for (const field of KEY_FIELDS) define(settings, field, () => settings.keySecrets?.[field]);
}
