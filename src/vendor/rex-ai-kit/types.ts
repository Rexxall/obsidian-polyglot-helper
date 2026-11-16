// Generated from rex-ai-kit 0.2.0. Do not edit here.
/** The four wire formats every provider speaks one of. */
export type Protocol = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'cli';

/** Where a provider sits in the picker. */
export type ProviderGroup = 'official' | 'more' | 'local' | 'custom';

/** Providers that expose an account balance endpoint we know how to read. */
export type BalanceKind = 'deepseek' | 'openrouter' | 'siliconflow' | 'kimi';

/** What a plugin uses a model for; drives which recommendation shows first. */
export type Scene = 'cheap' | 'balanced' | 'strong';

export interface ModelPick {
	id: string;
	scene: Scene;
	/** Short reason shown under the name, e.g. "fast, reads images". */
	note?: string | undefined;
}

export interface Provider {
	id: string;
	/** English name; `names` holds the Chinese and Japanese ones where they differ. */
	name: string;
	names?: { zh?: string | undefined; ja?: string };
	group: ProviderGroup;
	protocol: Protocol;
	/** Base URL without a trailing slash, e.g. https://api.openai.com/v1 */
	baseUrl: string;
	/** Shared Keychain name, e.g. openai-api-key. Empty for providers without a key. */
	secretName: string;
	needsKey: boolean;
	/** Path appended to baseUrl to list models; null when the provider has no such endpoint. */
	modelsPath: string | null;
	/** Hand-kept models for providers with no list endpoint, and the first rows of every picker. */
	picks: ModelPick[];
	balance?: BalanceKind | undefined;
	/** Page where the user creates a key or tops up. */
	consoleUrl?: string | undefined;
	/** Usage or billing page, linked when the balance cannot be read with a normal key. */
	usageUrl?: string | undefined;
	/** The provider sends CORS headers, so streaming over fetch works inside Obsidian. */
	cors?: boolean | undefined;
	/** One line the settings page shows under the provider, e.g. a privacy note. */
	hint?: string | undefined;
	/** Runs a program on this computer; only offered on desktop and only when the plugin opts in. */
	localAgent?: 'claude' | 'codex' | undefined;
}

export type ContentPart =
	| { type: 'text'; text: string }
	| { type: 'image'; mime: string; data: string /* base64, no data: prefix */ };

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string | ContentPart[];
}

export interface CompleteOptions {
	model: string;
	messages: ChatMessage[];
	system?: string | undefined;
	maxTokens?: number | undefined;
	temperature?: number | undefined;
	/** Ask for a JSON object back (OpenAI json mode, Gemini responseMimeType). Ignored where unsupported. */
	json?: boolean | undefined;
	signal?: AbortSignal | undefined;
	/** When set and the provider allows CORS, the reply streams and this gets each new piece. */
	onText?: ((delta: string) => void) | undefined;
	/** Give up after this many milliseconds with an AiError of kind 'timeout'. */
	timeoutMs?: number | undefined;
}

export interface Usage {
	inputTokens?: number | undefined;
	outputTokens?: number | undefined;
	/** Input tokens served from the provider's prompt cache, when reported. */
	cachedTokens?: number | undefined;
}

export interface CompleteResult {
	text: string;
	usage?: Usage | undefined;
	/** Why the model stopped, normalised: 'stop' | 'length' | 'filter' | other raw value. */
	stop?: string | undefined;
}

/** Minimal HTTP contract so tests and Obsidian's requestUrl can both drive the kit. */
export interface HttpRequest {
	url: string;
	method: 'GET' | 'POST';
	headers: Record<string, string>;
	body?: string | undefined;
	signal?: AbortSignal | undefined;
}

export interface HttpResponse {
	status: number;
	text: string;
	json: unknown;
}

export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

/**
 * Streams the response body as text chunks. Used for CORS-friendly providers, or for every
 * provider when `anyOrigin` is set (a transport outside the renderer, such as nodeStream()).
 */
export type StreamTransport = ((req: HttpRequest) => Promise<{ status: number; chunks: AsyncIterable<string>; text?: () => Promise<string> }>) & {
	anyOrigin?: boolean | undefined;
};

export interface ModelInfo {
	id: string;
	/** Human name when the API gives one. */
	label?: string | undefined;
	/** Unix seconds, for "newest first". */
	created?: number | undefined;
	/** Model takes image input, when the API says so. */
	vision?: boolean | undefined;
}

export type KeyStatus = 'ok' | 'missing' | 'invalid' | 'error';

export interface KeyCheck {
	status: KeyStatus;
	/** Short message for the settings row, e.g. "HTTP 429" or the provider's error text. */
	detail?: string | undefined;
	models?: ModelInfo[] | undefined;
}

export interface Balance {
	/** Formatted for display, e.g. "¥12.30" or "$4.10 left of $10". */
	text: string;
	amount?: number | undefined;
	currency?: string | undefined;
}

/** What a plugin stores for one AI slot. Never contains the key itself. */
export interface AiSlot {
	provider: string;
	model: string;
	/** Keychain name holding the key; defaults to the provider's shared name. */
	secretName?: string | undefined;
	/** Only for custom / local providers, or to point at a proxy. */
	baseUrl?: string | undefined;
}

export type AiErrorKind = 'no-key' | 'auth' | 'quota' | 'rate' | 'model' | 'timeout' | 'network' | 'bad-response' | 'server' | 'aborted';

export class AiError extends Error {
	constructor(
		message: string,
		readonly kind: AiErrorKind,
		readonly status?: number,
		/** The provider's own words, keys removed. */
		readonly detail?: string,
		/** Provider name, for messages built from the kind. */
		readonly provider?: string,
	) {
		super(message);
		this.name = 'AiError';
	}
}
