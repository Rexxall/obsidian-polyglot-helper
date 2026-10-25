/**
 * EncryptedSettings — 安全的 API Key 存储
 *
 * 使用 Web Crypto API (SubtleCrypto) 对敏感设置值进行 AES-GCM 加密。
 * 加密后的数据以 base64 存储在 Obsidian 的 data.json 中。
 *
 * 用法:
 *   const secure = new EncryptedSettings(plugin, 'my-secret-passphrase');
 *   await secure.set('geminiApiKey', 'AIza...');
 *   const key = await secure.get('geminiApiKey'); // 'AIza...'
 *
 * 安全说明:
 *   - 密钥通过 PBKDF2 从 passphrase 派生 (100,000 次迭代)
 *   - 每次加密使用随机 IV (12 bytes)
 *   - 加密数据格式: base64(iv + ciphertext)
 *   - 不依赖 Node.js，完全使用浏览器 Web Crypto API
 */

const ALGORITHM = 'AES-GCM' as const;
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for GCM
const PBKDF2_ITERATIONS = 100_000;
const SALT_PREFIX = 'obsidian-utils-encrypted-settings-v1';

/**
 * 加密设置存储的配置选项
 */
export interface EncryptedSettingsOptions {
	/** 用于密钥派生的密码短语。如果不提供，使用默认值（安全性较低） */
	passphrase?: string;
	/** 存储加密值的命名空间，同一插件不同实例间隔离 */
	namespace?: string;
}

/**
 * 加密设置管理器
 */
export class EncryptedSettings {
	private passphrase: string;
	private namespace: string;
	private encoder = new TextEncoder();
	private decoder = new TextDecoder();

	constructor(options: EncryptedSettingsOptions = {}) {
		this.passphrase = options.passphrase || 'obsidian-default-passphrase-change-me';
		this.namespace = options.namespace || 'default';
	}

	/**
	 * 加密一个值
	 * @param plaintext 要加密的明文
	 * @returns base64 编码的加密数据，格式为 iv + ciphertext
	 */
	async encrypt(plaintext: string): Promise<string> {
		try {
			const key = await this.deriveKey();
			const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
			const data = this.encoder.encode(plaintext);

			const ciphertext = await crypto.subtle.encrypt(
				{ name: ALGORITHM, iv },
				key,
				data
			);

			// 组合 IV + ciphertext
			const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
			combined.set(iv, 0);
			combined.set(new Uint8Array(ciphertext), IV_LENGTH);

			return this.arrayBufferToBase64(combined.buffer);
		} catch (error) {
			console.error('[EncryptedSettings] Encryption failed:', error);
			throw new Error(`加密失败: ${(error as Error).message}`);
		}
	}

	/**
	 * 解密一个值
	 * @param encryptedData base64 编码的加密数据
	 * @returns 解密后的明文
	 */
	async decrypt(encryptedData: string): Promise<string> {
		try {
			const key = await this.deriveKey();
			const combined = this.base64ToArrayBuffer(encryptedData);

			// 分离 IV 和 ciphertext
			const iv = combined.slice(0, IV_LENGTH);
			const ciphertext = combined.slice(IV_LENGTH);

			const plaintext = await crypto.subtle.decrypt(
				{ name: ALGORITHM, iv: new Uint8Array(iv) },
				key,
				new Uint8Array(ciphertext)
			);

			return this.decoder.decode(plaintext);
		} catch (error) {
			console.error('[EncryptedSettings] Decryption failed:', error);
			throw new Error(`解密失败: 密码短语不正确或数据已损坏`);
		}
	}

	/**
	 * 安全地设置一个敏感值（加密后存储）
	 * @param storage 存储对象（通常是 plugin.settings 的子集）
	 * @param key 设置键名
	 * @param value 明文值
	 */
	async set<T extends Record<string, any>>(
		storage: T,
		key: keyof T & string,
		value: string
	): Promise<void> {
		if (!value) {
			// 空值直接存储，不加密
			storage[key] = value as any;
			return;
		}
		const encrypted = await this.encrypt(value);
		const marker = this.wrapWithMarker(encrypted);
		storage[key] = marker as any;
	}

	/**
	 * 安全地获取一个敏感值（自动解密）
	 * @param storage 存储对象
	 * @param key 设置键名
	 * @returns 解密后的明文值
	 */
	async get<T extends Record<string, any>>(
		storage: T,
		key: keyof T & string
	): Promise<string> {
		const value = storage[key];
		if (!value || typeof value !== 'string') {
			return '';
		}

		// 检查是否是加密过的值（有标记前缀）
		if (this.isEncryptedValue(value)) {
			const encrypted = this.unwrapMarker(value);
			return await this.decrypt(encrypted);
		}

		// 是旧格式的明文值，返回原值
		return value;
	}

	/**
	 * 批量加密存储对象中所有标记为敏感的值
	 * 用于从旧版本（明文存储）迁移到加密存储
	 */
	async migrateSettings<T extends Record<string, any>>(
		storage: T,
		sensitiveKeys: (keyof T & string)[]
	): Promise<T> {
		const migrated = { ...storage };
		for (const key of sensitiveKeys) {
			const value = migrated[key];
			if (value && typeof value === 'string' && !this.isEncryptedValue(value)) {
				const encrypted = await this.encrypt(value);
				migrated[key] = this.wrapWithMarker(encrypted) as any;
			}
		}
		return migrated;
	}

	/**
	 * 检查设置值是否是加密值
	 */
	isEncryptedValue(value: string): boolean {
		return typeof value === 'string' && value.startsWith('__ENC__:');
	}

	/**
	 * 加密一个明文值并包装为标记格式
	 * 用于无法使用 set() 的场景（如数组中的加密值）
	 */
	async encryptValue(plaintext: string): Promise<string> {
		if (!plaintext) return plaintext;
		const encrypted = await this.encrypt(plaintext);
		return this.wrapWithMarker(encrypted);
	}

	/**
	 * 解密一个标记过的加密值（自动识别并去除 __ENC__ 前缀）
	 * 用于无法使用 get() 的场景（如数组中的加密值）
	 */
	async decryptValue(markedValue: string): Promise<string> {
		if (!this.isEncryptedValue(markedValue)) return markedValue;
		const encrypted = this.unwrapMarker(markedValue);
		return await this.decrypt(encrypted);
	}

	// ── 私有方法 ──

	private wrapWithMarker(encrypted: string): string {
		return `__ENC__:${this.namespace}:${encrypted}`;
	}

	private unwrapMarker(value: string): string {
		// 格式: __ENC__:namespace:base64data
		const parts = value.split(':');
		if (parts.length >= 3) {
			return parts.slice(2).join(':'); // 处理 base64 中可能包含的冒号
		}
		return parts[parts.length - 1] || '';
	}

	private async deriveKey(): Promise<CryptoKey> {
		const salt = this.encoder.encode(`${SALT_PREFIX}:${this.namespace}`);
		const keyMaterial = await crypto.subtle.importKey(
			'raw',
			this.encoder.encode(this.passphrase),
			'PBKDF2',
			false,
			['deriveKey']
		);

		return crypto.subtle.deriveKey(
			{
				name: 'PBKDF2',
				salt,
				iterations: PBKDF2_ITERATIONS,
				hash: 'SHA-256',
			},
			keyMaterial,
			{ name: ALGORITHM, length: KEY_LENGTH },
			false,
			['encrypt', 'decrypt']
		);
	}

	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]!);
		}
		return btoa(binary);
	}

	private base64ToArrayBuffer(base64: string): Uint8Array {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}
}

/**
 * 设置输入框类型的辅助类型
 * 用于 PluginSettingTab 中标记敏感字段
 */
export type SensitiveField = {
	type: 'password';
	value: string;
};
