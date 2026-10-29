import { App } from 'obsidian';
import { hashKey, legacyHash } from './crypto';

import { errorMessage } from './shared/errors';
const CACHE_BASE_PATH = '.cache';

/**
 * 生成友好的缓存文件名
 */
function generateFriendlyFileName(originalText: string, key: string, legacy = false): string {
    // 提取原文（去除设置信息）
    const text = originalText.split('-')[0] || originalText;

    // 清理文本，保留中文、日文、英文字符
    const cleanText = text
        .replace(/<[^>]*>/g, '') // 移除HTML标签
        .replace(/[\\/:*?"<>|\s.，。！？、\n\r]+/g, '_') // 替换特殊字符
        .replace(/_{2,}/g, '_') // 合并多个下划线
        .replace(/^_|_$/g, '') // 移除首尾下划线
        .substring(0, 50); // 限制长度

    // 生成短哈希作为唯一标识
    const hash = legacy ? legacyHash(key).substring(0, 8) : hashKey(key);

    // 组合文件名
    const baseName = cleanText || 'cache';
    return `${baseName}_${hash}.json`;
}

async function getCachePath(app: App, pluginDir: string, subfolder: string, key: string, legacy = false): Promise<string> {
    const cacheDir = `${pluginDir}/${CACHE_BASE_PATH}/${subfolder}`;

    // Ensure the cache directory exists
    try {
        await app.vault.adapter.mkdir(cacheDir);
    } catch (e) {
        // Ignore errors if the directory already exists
        if (errorMessage(e) && !errorMessage(e).includes('file already exists')) {
            console.error(`Failed to create cache directory: ${cacheDir}`, e);
        }
    }

    // 使用友好的文件名
    const fileName = generateFriendlyFileName(key, key, legacy);
    return `${cacheDir}/${fileName}`;
}

export async function saveToCache<T>(app: App, pluginDir: string, subfolder: 'english' | 'japanese', key: string, data: T): Promise<void> {
    try {
        const filePath = await getCachePath(app, pluginDir, subfolder, key);
        const jsonData = JSON.stringify(data, null, 2);
        await app.vault.adapter.write(filePath, jsonData);
    } catch (e) {
        console.error(`Failed to save to cache for key "${key}"`, e);
    }
}

export async function getFromCache<T>(app: App, pluginDir: string, subfolder: 'english' | 'japanese', key: string): Promise<T | null> {
    try {
        const filePath = await getCachePath(app, pluginDir, subfolder, key);
        const exists = await app.vault.adapter.exists(filePath);

        if (exists) {
            const content = await app.vault.adapter.read(filePath);
            return JSON.parse(content) as T;
        }
        // Files written by 1.3.x used a shorter hash; move them to the new name on first read.
        const legacyPath = await getCachePath(app, pluginDir, subfolder, key, true);
        if (await app.vault.adapter.exists(legacyPath)) {
            const content = await app.vault.adapter.read(legacyPath);
            const data = JSON.parse(content) as T;
            if (data && JSON.stringify(data).length > 0) {
                await app.vault.adapter.write(filePath, content);
                await app.vault.adapter.remove(legacyPath);
            }
            return data;
        }
        return null;
    } catch (e) {
        console.error(`Failed to read from cache for key "${key}"`, e);
        return null;
    }
}
