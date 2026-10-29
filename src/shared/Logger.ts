/**
 * Logger — 可开关的命名空间日志系统
 *
 * 功能:
 *   - 多级别: DEBUG, INFO, WARN, ERROR, SILENT
 *   - 命名空间隔离（每个插件独立日志级别）
 *   - 控制台输出（带格式化和颜色）
 *   - 可选文件日志（写入 vault）
 *   - 运行时动态调整级别
 *   - 生产/开发模式
 *
 * 用法:
 *   const logger = new Logger(app.vault, 'my-plugin', { level: LogLevel.DEBUG });
 *   logger.info('Plugin loaded');
 *   logger.debug('Settings:', settings);
 *   logger.error('Something went wrong', error);
 */

/**
 * 日志级别（按严重程度递增）
 */
export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	SILENT = 4,
}

/**
 * 日志条目
 */
export interface LogEntry {
	timestamp: string;
	level: string;
	namespace: string;
	message: string;
	details?: string;
}

/**
 * Logger 配置
 */
export interface LoggerOptions {
	/** 最低输出级别，默认 INFO */
	level?: LogLevel;
	/** 命名空间标识 */
	namespace: string;
	/** 是否输出到控制台，默认 true */
	console?: boolean;
	/** 是否输出到文件，默认 false */
	file?: boolean;
	/** 日志文件路径（相对于 vault），默认 `.obsidian/logs/<namespace>.log` */
	filePath?: string;
	/** 文件日志最大行数，超过后自动轮转，默认 10000 */
	maxFileLines?: number;
	/** 是否在消息中包含时间戳，默认 true */
	timestamp?: boolean;
	/** 是否在消息中包含命名空间，默认 true */
	showNamespace?: boolean;
}

/**
 * 全局 Logger 注册表
 * 允许跨插件管理日志级别
 */
class LoggerRegistry {
	private static loggers = new Map<string, Logger>();
	private static globalLevel: LogLevel | null = null;

	static register(namespace: string, logger: Logger): void {
		this.loggers.set(namespace, logger);
	}

	static unregister(namespace: string): void {
		this.loggers.delete(namespace);
	}

	static setGlobalLevel(level: LogLevel): void {
		this.globalLevel = level;
		for (const logger of this.loggers.values()) {
			logger.setLevel(level);
		}
	}

	static getGlobalLevel(): LogLevel | null {
		return this.globalLevel;
	}

	static getLogger(namespace: string): Logger | undefined {
		return this.loggers.get(namespace);
	}

	static getAllNamespaces(): string[] {
		return Array.from(this.loggers.keys());
	}
}

export { LoggerRegistry };

/** Vault 适配器接口（与 CacheManager 共用同一接口） */
export interface LogVaultAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	append(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

export class Logger {
	private options: Required<LoggerOptions>;
	private vaultAdapter?: LogVaultAdapter;
	private logBuffer: string[] = [];
	private isMobile: boolean;
	private flushTimer: number | null = null;
	private fileWritePending = false;

	constructor(vaultAdapter?: LogVaultAdapter, options?: LoggerOptions);
	constructor(vaultAdapter?: LogVaultAdapter, namespaceOrOptions?: string | LoggerOptions) {
		this.vaultAdapter = vaultAdapter;
		this.isMobile = typeof window !== 'undefined' && 'ontouchstart' in window;

		// 支持两种构造函数形式
		let opts: LoggerOptions;
		if (typeof namespaceOrOptions === 'string') {
			opts = { namespace: namespaceOrOptions };
		} else if (namespaceOrOptions) {
			opts = namespaceOrOptions;
		} else {
			opts = { namespace: 'default' };
		}

		this.options = {
			namespace: opts.namespace,
			level: opts.level ?? LogLevel.INFO,
			console: opts.console ?? true,
			file: opts.file ?? false,
			filePath: opts.filePath ?? `.obsidian/logs/${opts.namespace}.log`,
			maxFileLines: opts.maxFileLines ?? 10000,
			timestamp: opts.timestamp ?? true,
			showNamespace: opts.showNamespace ?? true,
		};

		LoggerRegistry.register(this.options.namespace, this);

		// 启动定期刷新
		if (this.options.file && vaultAdapter) {
			this.startFlushTimer();
		}
	}

	/**
	 * DEBUG 级别日志
	 */
	debug(message: string, details?: unknown): void {
		this.log(LogLevel.DEBUG, message, details);
	}

	/**
	 * INFO 级别日志
	 */
	info(message: string, details?: unknown): void {
		this.log(LogLevel.INFO, message, details);
	}

	/**
	 * WARN 级别日志
	 */
	warn(message: string, details?: unknown): void {
		this.log(LogLevel.WARN, message, details);
	}

	/**
	 * ERROR 级别日志
	 */
	error(message: string, details?: unknown): void {
		this.log(LogLevel.ERROR, message, details);
	}

	/**
	 * 设置日志级别
	 */
	setLevel(level: LogLevel): void {
		this.options.level = level;
	}

	/**
	 * 获取当前日志级别
	 */
	getLevel(): LogLevel {
		return this.options.level;
	}

	/**
	 * 启用/禁用控制台输出
	 */
	setConsoleOutput(enabled: boolean): void {
		this.options.console = enabled;
	}

	/**
	 * 启用/禁用文件输出
	 */
	setFileOutput(enabled: boolean): void {
		this.options.file = enabled;
		if (enabled) {
			this.startFlushTimer();
		} else {
			this.stopFlushTimer();
		}
	}

	/**
	 * 获取日志文件路径
	 */
	getLogFilePath(): string {
		return this.options.filePath;
	}

	/**
	 * 销毁 Logger，清理资源
	 */
	destroy(): void {
		this.stopFlushTimer();
		this.flushSync();
		LoggerRegistry.unregister(this.options.namespace);
	}

	// ── 私有方法 ──

	private log(level: LogLevel, message: string, details?: unknown): void {
		if (level < this.options.level) return;

		const levelName = LogLevel[level] || 'UNKNOWN';
		const formatted = this.formatMessage(levelName, message, details);

		// 控制台输出
		if (this.options.console) {
			this.writeToConsole(level, formatted, details);
		}

		// 文件输出
		if (this.options.file && this.vaultAdapter) {
			this.bufferForFile(formatted);
		}
	}

	private formatMessage(level: string, message: string, details?: unknown): string {
		const parts: string[] = [];

		if (this.options.timestamp) {
			parts.push(new Date().toISOString());
		}

		parts.push(`[${level.toUpperCase()}]`);

		if (this.options.showNamespace) {
			parts.push(`[${this.options.namespace}]`);
		}

		parts.push(redactText(message));

		if (details !== undefined && details !== null) {
			if (details instanceof Error) {
				parts.push(`\n  Error: ${redactText(details.message)}`);
				if (details.stack) {
					parts.push(`\n  Stack: ${details.stack}`);
				}
			} else if (typeof details === 'object') {
				try {
					parts.push(`\n  ${JSON.stringify(details, redactField, 2)}`);
				} catch {
					parts.push('\n  [对象无法序列化]');
				}
			} else if (typeof details === 'string') {
				parts.push(` ${redactText(details)}`);
			} else if (typeof details === 'number' || typeof details === 'boolean') {
				parts.push(` ${details}`);
			}
		}

		return parts.join(' ');
	}

	private writeToConsole(level: LogLevel, formatted: string, details?: unknown): void {
		switch (level) {
			case LogLevel.DEBUG:
				console.debug(formatted);
				break;
			case LogLevel.INFO:
				console.debug(formatted);
				break;
			case LogLevel.WARN:
				console.warn(formatted);
				break;
			case LogLevel.ERROR:
				console.error(formatted);
				break;
		}
	}

	private bufferForFile(message: string): void {
		this.logBuffer.push(message + '\n');
		// 如果缓冲区太大，立即 flush
		if (this.logBuffer.length >= 50) {
			this.flushSync();
		}
	}

	/**
	 * 同步刷新缓冲区到文件（不等待 I/O）
	 */
	private flushSync(): void {
		if (this.logBuffer.length === 0) return;
		if (!this.vaultAdapter || this.isMobile) {
			// 移动端不支持，清空缓冲区
			this.logBuffer = [];
			return;
		}

		const data = this.logBuffer.join('');
		this.logBuffer = [];

		// 异步写文件
		this.writeToFile(data).catch(() => {
			// 文件写入失败，静默处理
		});
	}

	private async writeToFile(data: string): Promise<void> {
		if (!this.vaultAdapter || this.fileWritePending) return;

		this.fileWritePending = true;
		try {
			// 确保日志目录存在
			const dir = this.options.filePath.substring(0, this.options.filePath.lastIndexOf('/'));
			if (dir) {
				const dirExists = await this.vaultAdapter.exists(dir);
				if (!dirExists) {
					await this.vaultAdapter.mkdir(dir);
				}
			}

			// 检查是否需要轮转
			const exists = await this.vaultAdapter.exists(this.options.filePath);
			if (exists) {
				const content = await this.vaultAdapter.read(this.options.filePath);
				const lines = content.split('\n').length;
				if (lines > this.options.maxFileLines) {
					// 保留最后 20% 的行
					const keepLines = content.split('\n').slice(-Math.floor(this.options.maxFileLines * 0.2));
					await this.vaultAdapter.write(
						this.options.filePath,
						`--- Log rotated at ${new Date().toISOString()} ---\n` + keepLines.join('\n') + '\n' + data
					);
					return;
				}
			}

			// 追加到文件
			await this.vaultAdapter.append(this.options.filePath, data);
		} catch {
			// 静默处理文件写入错误
		} finally {
			this.fileWritePending = false;
		}
	}

	private startFlushTimer(): void {
		if (this.flushTimer) return;
		// 每 5 秒刷新一次缓冲区
		this.flushTimer = window.setInterval(() => this.flushSync(), 5000);
	}

	private stopFlushTimer(): void {
		if (this.flushTimer) {
			window.clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
		// 最后刷新一次
		this.flushSync();
	}
}

// Logs can be written to a file in the vault and shared for support: never include keys, and
// keep only the length of what the user looked up or the AI answered.
const SECRET_FIELD = /key|token|secret|authorization|password|cookie/i;
const TEXT_FIELD = /^(text|original|translation|query|content|input|prompt|response|body|result|markdown|sentence|colloquial)$/i;

export function redactField(this: unknown, field: string, value: unknown): unknown {
	if (field && SECRET_FIELD.test(field)) return value ? '[hidden]' : value;
	if (field && TEXT_FIELD.test(field) && typeof value === 'string') return `[${value.length} chars]`;
	return value;
}

export function redactText(text: string): string {
	return text
		.replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '$1-[hidden]')
		.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[hidden]');
}
