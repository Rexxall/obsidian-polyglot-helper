import { App, Notice, TFile } from 'obsidian';
import { PolyglotHelperSettings, HistoryItem } from './types';
import { Logger } from './shared/Logger';
import { MarkdownView } from 'obsidian';

import { errorMessage } from './shared/errors';
export function sleep(ms: number) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

export function getSanitizedTitle(text: string): string {
    // Take the first 50 chars, remove characters invalid for filenames
    return text.substring(0, 50).replace(/[\\/:?*<>"|#^[\]]/g, '').trim() || 'Untitled';
}

export function getAudioUrl(word: string): string {
    const encodedWord = encodeURIComponent(word);
    return `https://dict.youdao.com/dictvoice?audio=${encodedWord}&type=2`;
}

export function getImageUrl(word: string): string {
    const encodedWord = encodeURIComponent(word.toLowerCase());
    // Using Youdao dictionary image search as the primary source
    return `https://dict.youdao.com/search?q=${encodedWord}&keyfrom=new-fanyi.smartResult`;
}

// 简易假名转罗马音（仅支持平假名/片假名，汉字将保留原样）
export function kanaToRomaji(input: string): string {
    // 清理非日文，保留空格与假名/汉字
    let text = input.replace(/[^\u3040-\u30FF\u4E00-\u9FFF\s]/g, ' ').trim();
    if (!/[\u3040-\u30FF\u4E00-\u9FFF]/.test(text)) return input; // 不是日文则原样返回

    const hira = ['あ','い','う','え','お','か','き','く','け','こ','さ','し','す','せ','そ','た','ち','つ','て','と','な','に','ぬ','ね','の','は','ひ','ふ','へ','ほ','ま','み','む','め','も','や','ゆ','よ','ら','り','る','れ','ろ','わ','を','ん','が','ぎ','ぐ','げ','ご','ざ','じ','ず','ぜ','ぞ','だ','ぢ','づ','で','ど','ば','び','ぶ','べ','ぼ','ぱ','ぴ','ぷ','ぺ','ぽ','きゃ','きゅ','きょ','しゃ','しゅ','しょ','ちゃ','ちゅ','ちょ','にゃ','にゅ','にょ','ひゃ','ひゅ','ひょ','みゃ','みゅ','みょ','りゃ','りゅ','りょ','ぎゃ','ぎゅ','ぎょ','じゃ','じゅ','じょ','びゃ','びゅ','びょ','ぴゃ','ぴゅ','ぴょ','っ'];
    const roma = ['a','i','u','e','o','ka','ki','ku','ke','ko','sa','shi','su','se','so','ta','chi','tsu','te','to','na','ni','nu','ne','no','ha','hi','fu','he','ho','ma','mi','mu','me','mo','ya','yu','yo','ra','ri','ru','re','ro','wa','o','n','ga','gi','gu','ge','go','za','ji','zu','ze','zo','da','ji','zu','de','do','ba','bi','bu','be','bo','pa','pi','pu','pe','po','kya','kyu','kyo','sha','shu','sho','cha','chu','cho','nya','nyu','nyo','hya','hyu','hyo','mya','myu','myo','rya','ryu','ryo','gya','gyu','gyo','ja','ju','jo','bya','byu','byo','pya','pyu','pyo',''];
    hira.map(ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));

    // 先处理拗音与促音等组合
    const combos = ['きゃ','きゅ','きょ','しゃ','しゅ','しょ','ちゃ','ちゅ','ちょ','にゃ','にゅ','にょ','ひゃ','ひゅ','ひょ','みゃ','みゅ','みょ','りゃ','りゅ','りょ','ぎゃ','ぎゅ','ぎょ','じゃ','じゅ','じょ','びゃ','びゅ','びょ','ぴゃ','ぴゅ','ぴょ'];
    const comboRoma = ['kya','kyu','kyo','sha','shu','sho','cha','chu','cho','nya','nyu','nyo','hya','hyu','hyo','mya','myu','myo','rya','ryu','ryo','gya','gyu','gyo','ja','ju','jo','bya','byu','byo','pya','pyu','pyo'];
    const kataCombos = combos.map(s => s.split('').map(c => String.fromCharCode(c.charCodeAt(0)+0x60)).join(''));
    // 处理组合（拗音）
    combos.forEach((c, idx) => {
        text = text.replaceAll(c, ` ${comboRoma[idx]} `);
    });
    kataCombos.forEach((c, idx) => {
        text = text.replaceAll(c, ` ${comboRoma[idx]} `);
    });

    // 处理促音っ/ッ，简单规则：重复后一个音的首辅音
    text = text.replace(/[っッ]([か-ぢつ-ぽカ-ヂツ-ポさ-ぞサ-ゾた-どタ-ドは-ぽハ-ポま-もマ-モやユヨら-ろラ-ロきシちニひミりギジヂビピキシチニヒミリ])/g, (_m: string, p1: string) => {
        const ch = String(p1);
        // 转为平假名对应罗马音首字母
        let base = ch;
        if (/[ァ-ン]/.test(ch)) base = String.fromCharCode(ch.charCodeAt(0) - 0x60);
        const idx = hira.indexOf(base);
        if (idx >= 0) return (roma[idx][0] || '') + base; // 临时占位，后续再整体转
        return 't' + ch; // fallback
    });

    // 单字符转换
    // 先片假名到平假名
    text = text.replace(/[ァ-ン]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

    // 替换平假名表
    hira.forEach((h, i) => {
        const r = roma[i];
        if (h) text = text.replaceAll(h, r);
    });

    // 清理多余空格
    return text.replace(/\s+/g, ' ').trim();
}

export function extractRootWord(phrase: string): string {
    const particles = new Set([
        'about', 'across', 'after', 'against', 'along', 'around', 'at', 'away',
        'back', 'by', 'down', 'for', 'from', 'in', 'into', 'of', 'off', 'on',
        'onto', 'out', 'over', 'through', 'to', 'together', 'up', 'with'
    ]);

    const words = phrase.toLowerCase().trim().split(/\s+/);
    if (words.length <= 1) {
        return phrase;
    }

    let lastNonParticleIndex = -1;
    for (let i = words.length - 1; i >= 0; i--) {
        if (!particles.has(words[i])) {
            lastNonParticleIndex = i;
            break;
        }
    }
    
    // If all words are particles (highly unlikely), return the original phrase
    if (lastNonParticleIndex === -1) {
        return phrase;
    }

    return words.slice(0, lastNonParticleIndex + 1).join(' ');
}

export const ENGLISH_STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', "aren't", 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
    'can', "can't", 'cannot', 'could', "couldn't",
    'did', "didn't", 'do', 'does', "doesn't", 'doing', 'don', "don't", 'down', 'during',
    'each',
    'few', 'for', 'from', 'further',
    'had', "hadn't", 'has', "hasn't", 'have', "haven't", 'having', 'he', "he'd", "he'll", "he's", 'her', 'here', "here's", 'hers', 'herself', 'him', 'himself', 'his', 'how', "how's",
    'i', "i'd", "i'll", "i'm", "i've", 'if', 'in', 'into', 'is', "isn't", 'it', "it's", 'its', 'itself',
    "let's",
    'me', 'more', 'most', "mustn't", 'my', 'myself',
    'no', 'nor', 'not',
    'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
    'same', 'shan', "shan't", 'she', "she'd", "she'll", "she's", 'should', "shouldn't", 'so', 'some', 'such',
    'than', 'that', "that's", 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', "there's", 'these', 'they', "they'd", "they'll", "they're", "they've", 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up',
    'very',
    'was', "wasn't", 'we', "we'd", "we'll", "we're", "we've", 'were', "weren't", 'what', "what's", 'when', "when's", 'where', "where's", 'which', 'while', 'who', "who's", 'whom', 'why', "why's", 'with', 'won', "won't", 'would', "wouldn't",
    'you', "you'd", "you'll", "you're", "you've", 'your', 'yours', 'yourself', 'yourselves'
]);

async function createNewFileWithResult(
    app: App,
    folderPath: string,
    fileName: string,
    result: string,
    logger: Logger
) {
    const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;

    if (folderPath && !await app.vault.adapter.exists(folderPath)) {
        try {
            await app.vault.createFolder(folderPath);
        } catch (e) {
            new Notice(`创建目录失败: ${folderPath}`);
            logger.error(`Failed to create folder: ${folderPath}`, e);
            return;
        }
    }

    try {
        const existingFile = app.vault.getAbstractFileByPath(fullPath);
        if (existingFile) {
            await app.vault.append(existingFile as TFile, `\n\n---\n${result}`);
            new Notice(`结果已追加到现有文件: ${fullPath}`);
        } else {
            const newFile = await app.vault.create(fullPath, result);
            new Notice(`结果已保存到新文件: ${newFile.path}`);
        }
    } catch (e) {
        new Notice(`创建或写入文件失败: ${errorMessage(e)}`);
        logger.error(`Failed to create/write file: ${fullPath}`, e);
    }
}

export async function addQueryToHistory(
    settings: PolyglotHelperSettings,
    saveSettings: () => Promise<void>,
    item: HistoryItem,
    outputLocation?: {
        destination: 'replace' | 'appendCurrent' | 'newFile' | 'sidebar' | 'fixedFile';
        filePath?: string;
        fileName?: string;
        heading?: string; // 保存标题中的词语部分，用于精确定位
    }
) {
    if (!item || !item.query) return;

    // Add timestamp if it doesn't exist
    if (!item.timestamp) {
        item.timestamp = Date.now();
    }

    // Add output location information if provided
    if (outputLocation) {
        item.outputLocation = outputLocation;
    }

    // Remove duplicates by creating a new array without the new query, then add it to the front
    const newHistory = settings.queryHistory.filter(h => 
        h.query.toLowerCase() !== item.query.toLowerCase() || h.type !== item.type
    );
    newHistory.unshift(item);

    // Trim the history to the last 50 entries
    settings.queryHistory = newHistory.slice(0, 50);

    await saveSettings();
}


// 新的分别输出处理函数
export async function handleSpecificOutput(
    app: App,
    outputSettings: { outputDestination: string; newFileLocation: string; fixedOutputFile: string },
    logger: Logger,
    query: string,
    result: string,
    filePath: string,
    selection?: { from: { line: number, ch: number }, to: { line: number, ch: number } }
) {
    let destination = outputSettings.outputDestination;
    const finalResult = result + '\n\n\n';

    if (destination === 'sidebar') {
        app.workspace.trigger('polyglot-query-success', finalResult);
        new Notice("结果已在 Polyglot Helper 侧边栏显示。");
        return;
    }

    // 对于新文件和固定文件模式，不需要当前文件路径
    if (!filePath && (destination === 'replace' || destination === 'appendCurrent')) {
        app.workspace.trigger('polyglot-query-success', finalResult);
        new Notice("当前没有打开的文件，结果已在 Polyglot Helper 侧边栏显示。\n💡 提示：请打开一个文件，或在设置中更改输出位置。");
        return;
    }

    try {
        switch (destination) {
            case 'replace':
                if (selection) {
                    const file = app.vault.getAbstractFileByPath(filePath);
                    if (file instanceof TFile) {
                        const content = await app.vault.read(file);
                        const lines = content.split('\n');

                        // 替换选中的内容
                        const beforeSelection = lines.slice(0, selection.from.line).join('\n') +
                                              (selection.from.line < lines.length ? '\n' + lines[selection.from.line].substring(0, selection.from.ch) : '');
                        const afterSelection = (selection.to.line < lines.length ? lines[selection.to.line].substring(selection.to.ch) : '') +
                                             (selection.to.line + 1 < lines.length ? '\n' + lines.slice(selection.to.line + 1).join('\n') : '');

                        const newContent = beforeSelection + result + afterSelection;
                        await app.vault.modify(file, newContent);
                        new Notice("结果已替换选中内容。");
                    }
                } else {
                    new Notice("没有选中内容可替换。");
                }
                break;

            case 'appendCurrent': {
                const currentFile = app.vault.getAbstractFileByPath(filePath);
                if (currentFile instanceof TFile) {
                    await app.vault.append(currentFile, finalResult);
                    new Notice(`结果已追加到当前文件: ${currentFile.name}`);
                }
                break;
            }

            case 'fixedFile': {
                const fixedFile = app.vault.getAbstractFileByPath(outputSettings.fixedOutputFile);
                if (fixedFile instanceof TFile) {
                    // 文件存在，追加内容
                    const timestamp = new Date().toLocaleString('zh-CN');
                    const content = `\n\n---\n**${timestamp}**\n\n${result}\n\n\n`;
                    await app.vault.append(fixedFile, content);
                    new Notice(`结果已追加到固定文件: ${fixedFile.name}`);
                } else {
                    // 文件不存在，创建文件
                    try {
                        const timestamp = new Date().toLocaleString('zh-CN');
                        const content = `# 学习记录\n\n**${timestamp}**\n\n${result}\n\n\n`;

                        // 确保目录存在
                        const folderPath = outputSettings.fixedOutputFile.substring(0, outputSettings.fixedOutputFile.lastIndexOf('/'));
                        if (folderPath && !await app.vault.adapter.exists(folderPath)) {
                            await app.vault.createFolder(folderPath);
                        }

                        const newFile = await app.vault.create(outputSettings.fixedOutputFile, content);
                        new Notice(`固定文件已创建并保存结果: ${newFile.name}`);
                    } catch (e) {
                        new Notice(`创建固定文件失败: ${errorMessage(e)}`);
                        logger.error(`Failed to create fixed output file: ${outputSettings.fixedOutputFile}`, e);
                    }
                }
                break;
            }

            case 'newFile': {
                const newFileName = `${getSanitizedTitle(query)}.md`;
                await createNewFileWithResult(app, outputSettings.newFileLocation, newFileName, finalResult, logger);
                break;
            }
        }
    } catch (error) {
        logger.error('输出处理失败', error);
        new Notice(`输出失败: ${errorMessage(error)}`);
        // 失败时回退到侧边栏
        app.workspace.trigger('polyglot-query-success', finalResult);
    }
}

// 新的优先级输出处理函数
export async function handlePriorityOutput(
    app: App,
    globalSettings: { outputDestination: string; newFileLocation: string; fixedOutputFile: string },
    languageSettings: { newFileLocation: string; fixedOutputFile: string },
    logger: Logger,
    query: string,
    result: string,
    filePath: string,
    selection?: { from: { line: number, ch: number }, to: { line: number, ch: number } }
): Promise<{
    destination: 'replace' | 'appendCurrent' | 'newFile' | 'sidebar' | 'fixedFile';
    filePath?: string;
    fileName?: string;
    heading?: string; // 保存标题中的词语部分，用于精确定位
}> {
    // 使用全局设置的输出位置作为最高优先级
    let destination = globalSettings.outputDestination;
    const finalResult = result + '\n\n\n';

    if (destination === 'sidebar') {
        app.workspace.trigger('polyglot-query-success', finalResult);
        new Notice("结果已在 Polyglot Helper 侧边栏显示。");
        return { destination: 'sidebar' };
    }

    // 提取“## 原文 …”中的“原文”部分（允许后面跟“ - …”），用于精确定位
    const headingMatch = result.match(/^##\s+(.+?)(?:\s+-\s+.*)?\s*$/m);
    const heading = headingMatch ? headingMatch[1].trim() : undefined;

    // 对于新文件和固定文件模式，不需要当前文件路径
    if (!filePath && (destination === 'replace' || destination === 'appendCurrent')) {
        app.workspace.trigger('polyglot-query-success', finalResult);
        new Notice("当前没有打开的文件，结果已在 Polyglot Helper 侧边栏显示。\n💡 提示：请打开一个文件，或在设置中更改输出位置。");
        return { destination: 'sidebar' };
    }

    // 只有在需要当前文件的模式下才检查文件是否存在
    let file: TFile | null = null;
    if (filePath && (destination === 'replace' || destination === 'appendCurrent')) {
        file = app.vault.getAbstractFileByPath(filePath) as TFile;
        if (!file || !(file instanceof TFile)) {
            new Notice(`错误：找不到原始文件 ${filePath}。`);
            logger.error(`handlePriorityOutput failed: Could not find original file at path ${filePath}`);
            // Fallback to creating a new file in case the original is gone.
            destination = 'newFile';
        }
    }

    if (destination === 'replace' && !selection) {
        new Notice("\"替换\"模式需要有效的选区，但未提供。将追加到文件末尾。");
        destination = 'appendCurrent';
    }

    try {
        switch (destination) {
            case 'replace':
                if (file && selection) {
                    // 读和写放在同一步，查询期间的其他修改不会被整篇覆盖
                    await app.vault.process(file, (content) =>
                        replaceSelectionInText(content, selection, finalResult.trim())
                    );
                    new Notice(`已替换选中内容并保存到 ${file.name}`);
                }
                return { destination: 'replace', filePath: file?.path, heading };

            case 'appendCurrent':
                if (file) {
                    await app.vault.append(file, finalResult);
                    new Notice(`结果已追加到 ${file.name}`);
                }
                return { destination: 'appendCurrent', filePath: file?.path, heading };

            case 'fixedFile': {
                // 对于固定文件，使用语言特定的路径（如果是 newFile 或 fixedFile 模式）
                const fixedFilePath = languageSettings.fixedOutputFile || globalSettings.fixedOutputFile;
                const fixedFile = app.vault.getAbstractFileByPath(fixedFilePath) as TFile;

                if (fixedFile) {
                    const timestamp = new Date().toLocaleString('zh-CN');
                    const content = `\n\n---\n**${timestamp}**\n\n${result}\n\n\n`;
                    await app.vault.append(fixedFile, content);
                    new Notice(`结果已追加到固定文件: ${fixedFile.name}`);
                } else {
                    try {
                        const timestamp = new Date().toLocaleString('zh-CN');
                        const content = `# 学习记录\n\n**${timestamp}**\n\n${result}\n\n\n`;

                        // 确保目录存在
                        const folderPath = fixedFilePath.substring(0, fixedFilePath.lastIndexOf('/'));
                        if (folderPath && !await app.vault.adapter.exists(folderPath)) {
                            await app.vault.createFolder(folderPath);
                        }

                        const newFile = await app.vault.create(fixedFilePath, content);
                        new Notice(`固定文件已创建并保存结果: ${newFile.name}`);
                    } catch (e) {
                        new Notice(`创建固定文件失败: ${errorMessage(e)}`);
                        logger.error(`Failed to create fixed output file: ${fixedFilePath}`, e);
                    }
                }
                return { destination: 'fixedFile', filePath: fixedFilePath, heading };
            }

            case 'newFile': {
                // 对于新文件，使用语言特定的路径（如果是 newFile 或 fixedFile 模式）
                const newFileLocation = languageSettings.newFileLocation || globalSettings.newFileLocation;
                const newFileName = `${getSanitizedTitle(query)}.md`;
                const fullPath = newFileLocation ? `${newFileLocation}${newFileName}` : newFileName;
                await createNewFileWithResult(app, newFileLocation, newFileName, finalResult, logger);
                return { destination: 'newFile', fileName: newFileName, filePath: fullPath, heading };
            }
        }
    } catch (error) {
        logger.error('优先级输出处理失败', error);
        new Notice(`输出失败: ${errorMessage(error)}`);
        // 失败时回退到侧边栏
        app.workspace.trigger('polyglot-query-success', finalResult);
        return { destination: 'sidebar' };
    }
    
    // 默认返回值（理论上不会到达这里）
    return { destination: 'sidebar' };
}

export async function handleOutput(
    app: App,
    settings: PolyglotHelperSettings,
    logger: Logger,
    query: string,
    result: string,
    filePath: string,
    selection?: { from: { line: number, ch: number }, to: { line: number, ch: number } }
) {
    let destination = settings.outputDestination;
    const finalResult = result + '\n\n\n';

    if (destination === 'sidebar') {
        app.workspace.trigger('polyglot-query-success', finalResult);
        new Notice("结果已在 Polyglot Helper 侧边栏显示。");
        return;
    }

    // 对于新文件和固定文件模式，不需要当前文件路径
    if (!filePath && (destination === 'replace' || destination === 'appendCurrent')) {
        app.workspace.trigger('polyglot-query-success', finalResult);
        new Notice("当前没有打开的文件，结果已在 Polyglot Helper 侧边栏显示。\n💡 提示：请打开一个文件，或在设置中更改输出位置。");
        return;
    }

    // 只有在需要当前文件的模式下才检查文件是否存在
    let file: TFile | null = null;
    if (filePath && (destination === 'replace' || destination === 'appendCurrent')) {
        file = app.vault.getAbstractFileByPath(filePath) as TFile;
        if (!file || !(file instanceof TFile)) {
            new Notice(`错误：找不到原始文件 ${filePath}。`);
            logger.error(`handleOutput failed: Could not find original file at path ${filePath}`);
            // Fallback to creating a new file in case the original is gone.
            destination = 'newFile';
        }
    }

    if (destination === 'replace' && !selection) {
        new Notice("\"替换\"模式需要有效的选区，但未提供。将追加到文件末尾。");
        destination = 'appendCurrent';
    }

    switch(destination) {
        case 'replace':
            if (file instanceof TFile) {
                // 首先尝试在Markdown视图中替换
                const markdownLeaf = app.workspace.getLeavesOfType('markdown').find(
                    (leaf) => (leaf.view as MarkdownView).file?.path === filePath
                );

                if (markdownLeaf && selection) {
                    const view = markdownLeaf.view as MarkdownView;
                    view.editor.replaceRange(finalResult, selection.from, selection.to);
                    new Notice(`结果已在文件 ${file.name} 中替换。`);
                } else {
                    // 如果不是Markdown文件或没有选区，直接追加到文件
                    new Notice(`结果已追加到文件 ${file.name}。`);
                    await app.vault.append(file, `\n\n---\n${finalResult}`);
                }
            }
            break;

        case 'appendCurrent':
            if (file instanceof TFile) {
                await app.vault.append(file, `\n\n---\n${finalResult}`);
                new Notice(`结果已追加到文件: ${file.name}`);
            }
            break;

        case 'fixedFile': {
            if (!settings.fixedOutputFile) {
                new Notice("错误：未设置固定输出文件路径。请在设置中配置。");
                logger.error("Fixed output file path not configured");
                return;
            }

            const fixedFile = app.vault.getAbstractFileByPath(settings.fixedOutputFile);
            if (fixedFile instanceof TFile) {
                // 文件存在，追加内容
                const timestamp = new Date().toLocaleString('zh-CN');
                const content = `\n\n---\n**${timestamp}**\n**查询:** ${query}\n\n${result}\n\n\n`;
                await app.vault.append(fixedFile, content);
                new Notice(`结果已追加到固定文件: ${fixedFile.name}`);
            } else {
                // 文件不存在，创建文件
                try {
                    const timestamp = new Date().toLocaleString('zh-CN');
                    const content = `# 翻译记录\n\n**${timestamp}**\n**查询:** ${query}\n\n${result}\n\n\n`;

                    // 确保目录存在
                    const folderPath = settings.fixedOutputFile.substring(0, settings.fixedOutputFile.lastIndexOf('/'));
                    if (folderPath && !await app.vault.adapter.exists(folderPath)) {
                        await app.vault.createFolder(folderPath);
                    }

                    const newFile = await app.vault.create(settings.fixedOutputFile, content);
                    new Notice(`固定文件已创建并保存结果: ${newFile.name}`);
                } catch (e) {
                    new Notice(`创建固定文件失败: ${errorMessage(e)}`);
                    logger.error(`Failed to create fixed output file: ${settings.fixedOutputFile}`, e);
                }
            }
            break;
        }

        case 'newFile': {
            const newFileName = `${getSanitizedTitle(query)}.md`;
            await createNewFileWithResult(app, settings.newFileLocation, newFileName, finalResult, logger);
            break;
        }
    }
}

// clearCache函数已移除，现在在main.ts中直接实现

/**
 * Replace the text between two editor positions. The tail after the selection comes from
 * the selection's last line, so multi-line selections no longer lose or duplicate text.
 */
export function replaceSelectionInText(
    content: string,
    selection: { from: { line: number; ch: number }; to: { line: number; ch: number } },
    replacement: string
): string {
    const lines = content.split('\n');
    const before = (lines[selection.from.line] ?? '').substring(0, selection.from.ch);
    const after = (lines[selection.to.line] ?? '').substring(selection.to.ch);
    return [
        ...lines.slice(0, selection.from.line),
        before + replacement + after,
        ...lines.slice(selection.to.line + 1)
    ].join('\n');
}
