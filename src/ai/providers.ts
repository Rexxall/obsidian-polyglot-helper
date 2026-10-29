/**
 * AI service presets, the "test connection" request and plain-language error classes.
 * Everything here is free of Obsidian imports so it can be tested in Node; the request function
 * takes the transport as a parameter.
 */
import { tr } from '../shared/i18n';

export type ProviderId =
	| 'deepseek'
	| 'qwen'
	| 'siliconflow'
	| 'kimi'
	| 'zhipu'
	| 'openrouter'
	| 'openai'
	| 'custom';

export interface ProviderPreset {
	id: ProviderId;
	label: string;
	/** Full chat-completions URL, the form the rest of the plugin uses. */
	endpoint: string;
	model: string;
	keyUrl: string;
}

// Endpoints and model names checked against each provider's own documentation on 2026-10-29.
export const PROVIDERS: ProviderPreset[] = [
	{
		id: 'deepseek',
		label: 'DeepSeek',
		endpoint: 'https://api.deepseek.com/chat/completions',
		model: 'deepseek-flash',
		keyUrl: 'https://platform.deepseek.com/api_keys',
	},
	{
		id: 'qwen',
		label: 'Qwen (通义千问)',
		endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
		model: 'qwen-plus',
		keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
	},
	{
		id: 'siliconflow',
		label: 'SiliconFlow (硅基流动)',
		endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
		model: 'deepseek-ai/DeepSeek-V4.1-Flash',
		keyUrl: 'https://cloud.siliconflow.cn/account/ak',
	},
	{
		id: 'kimi',
		label: 'Kimi',
		endpoint: 'https://api.moonshot.cn/v1/chat/completions',
		model: 'kimi-k3',
		keyUrl: 'https://platform.kimi.com/console/api-keys',
	},
	{
		id: 'zhipu',
		label: 'Zhipu GLM (智谱)',
		endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
		model: 'glm-5.3',
		keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		endpoint: 'https://openrouter.ai/api/v1/chat/completions',
		model: 'google/gemini-2.5-flash',
		keyUrl: 'https://openrouter.ai/keys',
	},
	{
		id: 'openai',
		label: 'OpenAI',
		endpoint: 'https://api.openai.com/v1/chat/completions',
		model: 'gpt-4o-mini',
		keyUrl: 'https://platform.openai.com/api-keys',
	},
	{
		id: 'custom',
		label: 'Custom (OpenAI-compatible)',
		endpoint: '',
		model: '',
		keyUrl: '',
	},
];

export function presetFor(id: string | undefined): ProviderPreset {
	return PROVIDERS.find((preset) => preset.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}

/** Which preset an existing endpoint belongs to; anything unknown is "custom". */
export function inferProvider(endpoint: string): ProviderId {
	let host = '';
	try {
		host = new URL(endpoint).host;
	} catch {
		return 'custom';
	}
	const match = PROVIDERS.find((preset) => preset.endpoint && new URL(preset.endpoint).host === host);
	return match ? match.id : 'custom';
}

/**
 * The plugin stores the full chat-completions URL. Users often paste only the base
 * (`https://api.example.com/v1`); add the path so both forms work.
 */
export function normalizeEndpoint(raw: string): string {
	const trimmed = raw.trim().replace(/\/+$/, '');
	if (!trimmed) return '';
	return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

export type AiErrorKind = 'no-key' | 'auth' | 'quota' | 'model' | 'timeout' | 'network' | 'other';

export interface AiError {
	kind: AiErrorKind;
	/** What happened, in one sentence. */
	message: string;
	/** What to do about it. */
	fix: string;
}

export interface FailureInput {
	status?: number;
	body?: string;
	error?: unknown;
	hasKey: boolean;
	model?: string;
}

const TEXT: Record<Exclude<AiErrorKind, 'other'>, () => [string, string]> = {
	'no-key': () => [
		tr('还没有填密钥。', 'No API key yet.'),
		tr('在这套配置里填上服务商给的 API 密钥。', "Paste the provider's API key into this configuration."),
	],
	auth: () => [
		tr('服务商不认这个密钥（401／403）。', 'The provider rejected this key (401/403).'),
		tr(
			'回服务商控制台重新复制密钥，注意不要多复制空格；也检查服务商和接口地址是否选对。',
			'Copy the key again from the provider console without extra spaces, and check that provider and endpoint match.',
		),
	],
	quota: () => [
		tr('账户余额或额度不足。', 'The account has no balance or quota left.'),
		tr(
			'到服务商控制台充值或领取额度。硅基流动余额为 0 时连免费模型也会拒绝。',
			'Top up or claim credits in the provider console. SiliconFlow refuses even its free models at a zero balance.',
		),
	],
	model: () => [
		tr('服务商找不到这个模型名。', 'The provider does not know this model name.'),
		tr(
			'按服务商文档核对模型名，或点服务商下拉恢复默认模型。',
			"Check the model name against the provider's documentation, or pick the provider again to restore its default model.",
		),
	],
	timeout: () => [
		tr('等了很久没有回应。', 'No answer in time.'),
		tr('检查网络或代理；服务商繁忙时稍后再试。', 'Check your network or proxy, or try again later if the provider is busy.'),
	],
	network: () => [
		tr('连不上接口地址。', 'Could not reach the endpoint.'),
		tr('检查接口地址是否写对、网络和代理是否正常。', 'Check the endpoint address, your network and any proxy.'),
	],
};

function errorText(error: unknown): string {
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error) {
		const message: unknown = Reflect.get(error, 'message');
		return typeof message === 'string' ? message : '';
	}
	return '';
}

export function classifyAiFailure(input: FailureInput): AiError {
	const make = (kind: Exclude<AiErrorKind, 'other'>): AiError => {
		const [message, fix] = TEXT[kind]();
		return { kind, message, fix };
	};
	if (!input.hasKey) return make('no-key');
	const body = (input.body ?? '').slice(0, 2000);
	const detail = `${body} ${errorText(input.error)}`;
	const status = input.status ?? 0;
	if (status === 401 || status === 403 || /invalid[^.]{0,30}(api[ _-]?key|token)|unauthori[sz]ed|authentication/i.test(detail)) {
		return make('auth');
	}
	if (status === 402 || /insufficient|balance|quota|余额|arrears|exceeded your current/i.test(detail)) {
		return make('quota');
	}
	if (
		status === 404 ||
		/model[^.]{0,40}(not exist|not found|does not exist|invalid|unsupported)|no such model|模型不存在/i.test(detail)
	) {
		return make('model');
	}
	if (/timed? ?out|timeout|ETIMEDOUT/i.test(detail)) return make('timeout');
	if (!status && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|net::|Failed to fetch|network/i.test(detail)) {
		return make('network');
	}
	if (status === 429) {
		return {
			kind: 'other',
			message: tr('请求太频繁（429）。', 'Too many requests (429).'),
			fix: tr('稍等片刻再试，或换一个额度更高的套餐。', 'Wait a moment and try again, or use a plan with a higher limit.'),
		};
	}
	return {
		kind: 'other',
		message: status ? tr(`服务商返回 HTTP ${status}。`, `The provider answered HTTP ${status}.`) : tr('请求失败。', 'The request failed.'),
		fix: tr('打开调试模式，看日志里的原始错误。', 'Turn on debug mode and read the original error in the log.'),
	};
}

export interface ConnectionConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
}

export interface TransportResponse {
	status: number;
	text: string;
}

export type Transport = (request: {
	url: string;
	method: 'POST';
	headers: Record<string, string>;
	body: string;
}) => Promise<TransportResponse>;

export type TestResult = { ok: true; ms: number; reply: string } | ({ ok: false; ms: number } & AiError);

/**
 * One very short chat request (a few tokens each way). It costs well under one fen at any of the
 * preset providers, which the settings page says before the user presses the button.
 */
export async function testConnection(
	config: ConnectionConfig,
	transport: Transport,
	timeoutMs = 20000,
): Promise<TestResult> {
	const started = Date.now();
	if (!config.apiKey.trim()) return { ok: false, ms: 0, ...classifyAiFailure({ hasKey: false }) };
	if (!config.baseUrl.trim() || !config.model.trim()) {
		return {
			ok: false,
			ms: 0,
			kind: 'other',
			message: tr('接口地址或模型名是空的。', 'The endpoint or model name is empty.'),
			fix: tr('在服务商下拉里选一个服务商，会自动填好这两项。', 'Pick a provider in the list; it fills in both.'),
		};
	}
	let timer: number | undefined;
	try {
		const timeout = new Promise<never>((_, reject) => {
			timer = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
		});
		const response = await Promise.race([
			transport({
				url: config.baseUrl,
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey.trim()}` },
				body: JSON.stringify({
					model: config.model,
					messages: [{ role: 'user', content: 'Reply with OK.' }],
					max_tokens: 5,
					temperature: 0,
				}),
			}),
			timeout,
		]);
		const ms = Date.now() - started;
		if (response.status >= 200 && response.status < 300) {
			let reply = '';
			try {
				const parsed = JSON.parse(response.text) as { choices?: { message?: { content?: unknown } }[] };
				const content = parsed.choices?.[0]?.message?.content;
				reply = typeof content === 'string' ? content.trim().slice(0, 40) : '';
			} catch {
				// a 2xx without JSON still proves the key and model were accepted
			}
			return { ok: true, ms, reply };
		}
		return { ok: false, ms, ...classifyAiFailure({ status: response.status, body: response.text, hasKey: true }) };
	} catch (error) {
		return { ok: false, ms: Date.now() - started, ...classifyAiFailure({ error, hasKey: true }) };
	} finally {
		if (timer !== undefined) window.clearTimeout(timer);
	}
}
