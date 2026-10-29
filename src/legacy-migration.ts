/**
 * 1.6.0 起插件 id 从 obsidian-polyglot-helper 改为 polyglot-helper（社区目录不允许 id 含 obsidian）。
 * Obsidian 按 id 给插件分目录，新目录第一次启动时没有 data.json；这里把旧版的设置和词库读出来。
 * 旧版手动安装时文件夹名不一定等于 id（例如 obsidian-polyglot-helper-release），
 * 所以先看默认文件夹，再按各文件夹 manifest.json 里的 id 找。只读不删：旧目录留给用户确认后自己删除。
 */
export const LEGACY_PLUGIN_ID = 'obsidian-polyglot-helper';

interface ReadOnlyAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	list?(path: string): Promise<{ files: string[]; folders: string[] }>;
}

export interface LegacyPluginData {
	/** 旧版所在文件夹（库内路径） */
	dir: string;
	data: Record<string, unknown>;
}

async function readJsonObject(adapter: ReadOnlyAdapter, file: string): Promise<Record<string, unknown> | null> {
	try {
		if (!(await adapter.exists(file))) return null;
		const parsed: unknown = JSON.parse(await adapter.read(file));
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/** 找到旧版插件所在的文件夹：默认名优先，其次是 manifest id 等于旧 id 的文件夹。 */
export async function findLegacyPluginDirs(adapter: ReadOnlyAdapter, configDir: string): Promise<string[]> {
	const pluginsDir = `${configDir}/plugins`;
	const dirs = [`${pluginsDir}/${LEGACY_PLUGIN_ID}`];
	if (adapter.list) {
		try {
			const { folders } = await adapter.list(pluginsDir);
			for (const folder of [...folders].sort()) {
				if (dirs.includes(folder)) continue;
				const manifest = await readJsonObject(adapter, `${folder}/manifest.json`);
				if (manifest?.id === LEGACY_PLUGIN_ID) dirs.push(folder);
			}
		} catch {
			// 列不出目录时只看默认文件夹
		}
	}
	return dirs;
}

export async function readLegacyPluginData(
	adapter: ReadOnlyAdapter,
	configDir: string,
	currentDir: string | undefined,
): Promise<LegacyPluginData | null> {
	if (!currentDir) return null;
	for (const dir of await findLegacyPluginDirs(adapter, configDir)) {
		if (dir === currentDir) continue;
		const data = await readJsonObject(adapter, `${dir}/data.json`);
		if (data) return { dir, data };
	}
	return null;
}
