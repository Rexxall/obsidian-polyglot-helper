/**
 * The plugin's one door to AI: rex-ai-kit with keys read from Obsidian's Keychain at call time.
 * Created on load without any request; requests start only from a user action.
 */
import { Platform, requestUrl } from 'obsidian';
import { AiClient, AiError, ModelCache, explainError, getProvider, nodeCliRunner, requestUrlTransport, type KeyStore, type Lang, type ModelCacheData } from '../vendor/rex-ai-kit/index';
import { isChinese } from '../shared/i18n';
import { isReasoningModel } from './sampling';
import type { ApiConfig } from '../types';

let client: AiClient | null = null;

export function aiLang(): Lang {
	return isChinese() ? 'zh' : 'en';
}

export function initAi(keys: KeyStore, cache: ModelCacheData | undefined): AiClient {
	client = new AiClient({
		keys,
		transport: requestUrlTransport(requestUrl),
		cache: new ModelCache(cache),
		cli: Platform.isDesktopApp ? nodeCliRunner() : undefined,
		lang: aiLang(),
	});
	return client;
}

export function ai(): AiClient {
	if (!client) throw new AiError('AI is not ready yet', 'no-key');
	return client;
}

/** On, and its key (or program) is there; reading the Keychain is local. */
export function isUsable(config: ApiConfig | null | undefined): config is ApiConfig {
	return !!config && config.enabled && !!client && client.hasKey(config.ai);
}

export function isLocalAgent(config: ApiConfig): boolean {
	return !!getProvider(config.ai.provider)?.localAgent;
}

export interface ChatOptions {
	system?: string;
	user: string;
	/** Left out for models that only take their default (OpenAI reasoning models, Claude 5). */
	temperature?: number;
	json?: boolean;
	maxTokens?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
}

/** One request with a configuration; returns the reply text or throws AiError. */
export async function chat(config: ApiConfig, o: ChatOptions): Promise<string> {
	const reply = await ai().complete(config.ai, {
		system: o.system,
		messages: [{ role: 'user', content: o.user }],
		json: o.json,
		maxTokens: o.maxTokens,
		signal: o.signal,
		...(o.temperature !== undefined && !isReasoningModel(config.ai.model) ? { temperature: o.temperature } : {}),
		// Programs on this computer start up first, so they get longer.
		timeoutMs: o.timeoutMs ?? (isLocalAgent(config) ? 180_000 : 60_000),
	});
	return reply.text;
}

/** Why a request failed and the next step, in the interface language. */
export function describeAiError(error: unknown): string {
	return explainError(error, aiLang());
}

/** Problems the user fixes in settings rather than by retrying. */
export function isSetupError(error: unknown): boolean {
	return error instanceof AiError && (['no-key', 'auth', 'quota', 'model'].includes(error.kind) || error.detail === 'images' || error.detail === 'desktop-only');
}

export { AiError };
