/**
 * 1.6.0 起插件 id 从 obsidian-polyglot-helper 改为 polyglot-helper（社区目录不允许 id 含 obsidian）。
 * Obsidian 按 id 给插件分目录，新目录第一次启动时没有 data.json；这里把旧目录的设置和词库读出来。
 * 只读不删：旧目录留给用户确认后自己删除。
 */
export const LEGACY_PLUGIN_ID = 'obsidian-polyglot-helper';

interface ReadOnlyAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
}

export async function readLegacyPluginData(
	adapter: ReadOnlyAdapter,
	configDir: string,
	currentDir: string | undefined,
): Promise<Record<string, unknown> | null> {
	const legacyDir = `${configDir}/plugins/${LEGACY_PLUGIN_ID}`;
	if (!currentDir || currentDir === legacyDir) return null;
	const legacyFile = `${legacyDir}/data.json`;
	try {
		if (!(await adapter.exists(legacyFile))) return null;
		const parsed: unknown = JSON.parse(await adapter.read(legacyFile));
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}
