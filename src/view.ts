import { ItemView, WorkspaceLeaf, Notice, TextAreaComponent, Editor, MarkdownRenderer, MarkdownView, TextComponent, setIcon, TFile, Menu, normalizePath, sanitizeHTMLToDom } from "obsidian";
import PolyglotHelper from "./main";
import { HistoryItem } from "./types";
import { getFromCache, saveToCache } from './cache';
import { ReviewSession, sourceNote } from './review-session';
import { parseWordCards, WordCard, CardLine } from './word-card';
import { getAudioUrl } from './utils';
import { createObsidianPicker } from './ui/obsidian-picker';

import { fire } from './shared/fire';
import { errorMessage } from './shared/errors';
import { asTFile } from './file-utils';
import { classifyAiFailure } from './ai/providers';
import { tr } from './shared/i18n';
export const POLYGLOT_HELPER_VIEW_TYPE = "polyglot-helper-view";

export class PolyglotHelperView extends ItemView {
    plugin: PolyglotHelper;
    private queryInput: TextAreaComponent;
    /** The input is cleared after a query; keep the word and language for the result's buttons. */
    private lastQuery: { text: string; type: 'english' | 'japanese' } | null = null;
    private actionsContainer: HTMLDivElement;
    private actionsContent: HTMLDivElement;
    private displayContainer: HTMLDivElement;
    private historySearchInput: TextComponent;
    private lastActiveLeaf: MarkdownView | null = null;
    private resizer: HTMLDivElement;
    private processingStartFile: MarkdownView | null = null; // 记录开始处理时的活跃文件
    private lastActiveFile: TFile | null = null; // 记录最后的活动文件
    private activeMode: 'japanese' | 'english' | 'quick_to_japanese' | 'quick_english' = 'quick_to_japanese';
    private modeButtons: { japBtn?: HTMLButtonElement; engBtn?: HTMLButtonElement; quickJpBtn?: HTMLButtonElement } = {};
    private wordSelectionToggle?: HTMLButtonElement;
    private review: ReviewSession | null = null;
    private panes: { look?: HTMLElement; learn?: HTMLElement } = {};
    private tabButtons: { look?: HTMLElement; learn?: HTMLElement } = {};

    constructor(leaf: WorkspaceLeaf, plugin: PolyglotHelper) {
        super(leaf);
        this.plugin = plugin;
    }

    // 统一构建"快捷翻译"Markdown内容（美化且可包含罗马音）
    private buildQuickMarkdown(kind: 'japanese' | 'chinese', original: string, translation: string, romaji?: string): string {
        const useRomaji = kind === 'japanese' && (this.plugin.settings.quickTranslationOptions?.showRomaji ?? false) && !!romaji && romaji.trim().length > 0;
        const header = `### ${original || ''} - ${translation || ''}${useRomaji ? ` （${romaji}）` : ''}`;
        return `${header}\n---\n`;
    }

    private setActiveMode(mode: 'japanese' | 'english' | 'quick_to_japanese' | 'quick_english'): void {
        this.activeMode = mode;
        // 高亮按钮
        const { japBtn, engBtn, quickJpBtn } = this.modeButtons;
        const active = { japanese: japBtn, english: engBtn, quick_to_japanese: quickJpBtn, quick_english: undefined }[mode];
        for (const btn of [japBtn, engBtn, quickJpBtn]) {
            btn?.toggleClass('is-active', btn === active);
            btn?.setAttribute('aria-pressed', String(btn === active));
        }
        
        // 保存当前选择到设置中
        this.plugin.settings.lastSelectedMode = mode;
        void this.plugin.saveSettings();
    }

    private runActiveMode(): void {
        switch (this.activeMode) {
            case 'japanese': void this.handleProcess('japanese'); break;
            case 'english': void this.handleProcess('english'); break;
            case 'quick_to_japanese': void this.handleQuickToJapanese(); break;
            case 'quick_english': void this.handleQuickProcess(); break;
        }
    }

    // 按快速翻译专属输出位置写入内容，返回输出位置信息以便历史记录跳转
    private async outputQuickResult(kind: 'japanese' | 'chinese', original: string, translation: string, romaji?: string): Promise<HistoryItem['outputLocation'] | undefined> {
        // 使用统一的"输出位置"选择，确保和侧边栏选择器一致
        const destination = this.plugin.settings.outputDestination ?? 'sidebar';
        // 生成标题文本（供跳转定位用）
        const includeRomaji = kind === 'japanese' && (this.plugin.settings.quickTranslationOptions?.showRomaji ?? false) && !!romaji && romaji.trim().length > 0;
        const headingText = `${original || ''} - ${translation || ''}${includeRomaji ? ` （${romaji}）` : ''}`;
        if (destination === 'sidebar') return { destination: 'sidebar', heading: headingText };

        // 使用统一美化Markdown
        const content = this.buildQuickMarkdown(kind, original, translation, romaji) + '\n';

        try {
            if (destination === 'fixedFile') {
                const fixedPath = this.plugin.settings.quickTranslationOutputSettings.fixedOutputFile;
                if (!fixedPath) { new Notice(tr('未设置"快捷翻译"固定输出文件', 'No fixed output file is set for quick translation')); return; }
                const file = this.app.vault.getAbstractFileByPath(fixedPath);
                if (file instanceof TFile) {
                    await this.app.vault.append(file, `\n---\n${content}`);
                    new Notice(tr(`已追加到固定文件: ${file.name}`, `Appended to the fixed file: ${file.name}`));
                    return { destination: 'fixedFile', filePath: fixedPath, fileName: file.name, heading: headingText };
                } else {
                    const folderPath = fixedPath.substring(0, fixedPath.lastIndexOf('/'));
                    if (folderPath && !await this.app.vault.adapter.exists(folderPath)) {
                        await this.app.vault.createFolder(folderPath);
                    }
                    await this.app.vault.create(fixedPath, `# 快捷翻译记录\n\n${content}`);
                    new Notice(tr('已创建固定文件并写入内容', 'Created the fixed file and wrote the result'));
                    return { destination: 'fixedFile', filePath: fixedPath, fileName: fixedPath.split('/').pop(), heading: headingText };
                }
            } else if (destination === 'newFile') {
                const base = this.plugin.settings.quickTranslationOutputSettings.newFileLocation || '';
                const safe = original.substring(0, 50).replace(/[\\/:?*<>"|#^[\]]/g, '').trim() || '翻译结果';
                const fileName = `${safe} - 快速翻译.md`;
                const full = base ? `${base}${fileName}` : fileName;
                if (base && !await this.app.vault.adapter.exists(base.replace(/\/$/, ''))) {
                    await this.app.vault.createFolder(base.replace(/\/$/, ''));
                }
                await this.app.vault.create(full, content);
                const file = asTFile(this.app.vault.getAbstractFileByPath(full));
                if (file) await this.app.workspace.getLeaf().openFile(file);
                new Notice(tr(`已创建新文件: ${fileName}`, `Created a new file: ${fileName}`));
                return { destination: 'newFile', filePath: full, fileName, heading: headingText };
            } else if (destination === 'appendCurrent' || destination === 'replace') {
                const targetFile = this.getTargetFile();
                if (!targetFile) { new Notice(tr('未找到当前文件，已跳过文件输出', 'No current file; skipped writing to a file')); return; }
                if (destination === 'appendCurrent') {
                    await this.app.vault.append(targetFile, `\n---\n${content}`);
                    new Notice(tr(`已追加到当前文件: ${targetFile.name}`, `Appended to the current file: ${targetFile.name}`));
                    return { destination: 'appendCurrent', filePath: targetFile.path, fileName: targetFile.name, heading: headingText };
                } else {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    const editor = view?.editor;
                    if (editor && editor.somethingSelected()) {
                        editor.replaceSelection(content);
                        new Notice(tr('已替换选中内容', 'Replaced the selection'));
                        return { destination: 'replace', filePath: targetFile.path, fileName: targetFile.name, heading: headingText };
                    } else {
                        await this.app.vault.append(targetFile, `\n---\n${content}`);
                        new Notice(tr(`未选中文本，已追加到文件: ${targetFile.name}`, `Nothing selected; appended to ${targetFile.name}`));
                        return { destination: 'appendCurrent', filePath: targetFile.path, fileName: targetFile.name, heading: headingText };
                    }
                }
            }
        } catch (e) {
            new Notice(tr(`快速翻译输出失败: ${errorMessage(e)}`, `Could not output the quick translation: ${errorMessage(e)}`));
        }
    }
    getViewType() { return POLYGLOT_HELPER_VIEW_TYPE; }
    getDisplayText() { return tr("语言助手", "Polyglot Helper"); }
    getIcon() { return "book-open"; }

    async onOpen() {
        const root = this.containerEl.children[1] as HTMLElement;
        root.empty();
        root.addClass('polyglot-root', 'polyglot-helper-view-container', 'ap', 'ap-view');

        // --- 顶部：标题、设置、两页切换 ---
        const head = root.createDiv({ cls: 'polyglot-view-head' });
        head.createEl('h3', { text: tr('语言助手', 'Polyglot Helper') });
        const headMenu = head.createEl('button', { cls: 'polyglot-head-more clickable-icon', attr: { 'aria-label': tr('更多', 'More') } });
        setIcon(headMenu, 'more-horizontal');
        headMenu.addEventListener('click', (event) => {
            const menu = new Menu();
            menu.addItem(item => item.setTitle(tr('强制刷新（不用缓存）', 'Refresh (skip the cache)')).setIcon('refresh-cw').setChecked(!!this.plugin.settings.forceRefresh).onClick(async () => {
                this.plugin.settings.forceRefresh = !this.plugin.settings.forceRefresh;
                await this.plugin.saveSettings();
            }));
            menu.addItem(item => item.setTitle(tr('朗读输入框里的文字', 'Read the text box aloud')).setIcon('volume-2').onClick(() => this.handleVoiceSynthesis()));
            menu.addItem(item => item.setTitle(tr('语音选项…', 'Voice options…')).setIcon('audio-lines').onClick(() => this.showSettingsPanel(headMenu)));
            menu.addSeparator();
            menu.addItem(item => item.setTitle(tr('跳到上次输出位置', 'Go to the last output')).setIcon('external-link').onClick(() => this.jumpToLastOutputLocation()));
            menu.addItem(item => item.setTitle(tr('设置', 'Settings')).setIcon('settings').onClick(() => {
                const settings = (this.app as typeof this.app & { setting?: { open(): void; openTabById(id: string): void } }).setting;
                settings?.open();
                settings?.openTabById(this.plugin.manifest.id);
            }));
            menu.showAtMouseEvent(event);
        });
        const tabs = root.createDiv({ cls: 'polyglot-tabs' });
        this.tabButtons.look = tabs.createEl('button', { text: tr('查词', 'Look up') });
        this.tabButtons.learn = tabs.createEl('button', { text: tr('学习', 'Learn') });
        this.tabButtons.look.addEventListener('click', () => this.showPane('look'));
        this.tabButtons.learn.addEventListener('click', () => this.showPane('learn'));

        const container = root.createDiv({ cls: 'polyglot-pane polyglot-pane-look' });
        this.panes.look = container;
        this.panes.learn = root.createDiv({ cls: 'polyglot-pane polyglot-pane-learn' });
        this.review = new ReviewSession(this.plugin, this.panes.learn.createDiv());

        // --- 查词页：输入与操作 / 拖动条 / 结果 ---
        this.actionsContainer = container.createDiv('polyglot-actions-container');
        this.resizer = container.createDiv('polyglot-resizer');
        this.displayContainer = container.createDiv('polyglot-display-container');

        this.app.workspace.onLayoutReady(() => {
            // Set initial height for the actions container
            this.actionsContainer.addClass('polyglot-actions-initial');
        });

        this.setupResizer();

        // --- Populate Actions Container ---
        this.actionsContent = this.actionsContainer.createDiv('polyglot-actions-content');
        this.actionsContent.addClass('polyglot-fill'); // Ensure content fills the container

        // 文本框容器，包含输入框和选词模式开关
        const inputContainer = this.actionsContent.createDiv({ cls: 'polyglot-input-container' });
        
        this.queryInput = new TextAreaComponent(inputContainer)
            .setPlaceholder(tr("在此输入文本...", "Type here..."));
        this.queryInput.inputEl.addClass('polyglot-query-input');

        // 右侧按钮容器
        const rightButtonsContainer = inputContainer.createDiv({ cls: 'polyglot-input-right-buttons' });

        // 结果显示位置：胶囊选择器，放在输入框底栏左侧
        const outputPicker = createObsidianPicker(
            this.app,
            inputContainer.createDiv({ cls: 'polyglot-output-picker' }),
            [
                { value: 'sidebar', label: tr('显示在侧栏', 'Show in the side panel') },
                { value: 'replace', label: tr('替换选文', 'Replace selection') },
                { value: 'appendCurrent', label: tr('追加到当前笔记', 'Append to current note') },
                { value: 'newFile', label: tr('写入新笔记', 'Write to a new note') },
                { value: 'fixedFile', label: tr('写入固定文件', 'Write to a fixed file') },
            ],
            this.plugin.settings.outputDestination ?? 'sidebar',
            async (value) => {
                this.plugin.settings.outputDestination = value;
                // 同一个选择也用于“快速翻译”的输出位置
                this.plugin.settings.quickTranslationOptions = this.plugin.settings.quickTranslationOptions || { showRomaji: false, playAudio: true, outputDestination: 'sidebar' };
                this.plugin.settings.quickTranslationOptions.outputDestination = value;
                await this.plugin.saveSettings();
            },
            tr('结果显示位置', 'Where results go'),
        );
        outputPicker.button.addClass('is-plain');

        // 选词模式开关按钮
        const wordSelectionToggle = rightButtonsContainer.createEl('button', {
            cls: `polyglot-word-selection-toggle ${this.plugin.settings.wordSelectionMode ? 'active' : ''}`,
            title: this.plugin.settings.wordSelectionMode ? tr('选词模式：已开启', 'Word-selection mode: on') : tr('选词模式：已关闭', 'Word-selection mode: off')
        });
        setIcon(wordSelectionToggle, 'mouse-pointer-click');
        wordSelectionToggle.addEventListener('click', fire(async () => {
            this.plugin.settings.wordSelectionMode = !this.plugin.settings.wordSelectionMode;
            wordSelectionToggle.toggleClass('active', this.plugin.settings.wordSelectionMode);
            wordSelectionToggle.setAttribute('title', this.plugin.settings.wordSelectionMode ? tr('选词模式：已开启', 'Word-selection mode: on') : tr('选词模式：已关闭', 'Word-selection mode: off'));
            await this.plugin.saveSettings();
            new Notice(this.plugin.settings.wordSelectionMode ? tr('✅ 选词模式已开启', '✅ Word-selection mode on') : tr('❌ 选词模式已关闭', '❌ Word-selection mode off'));
        }));

        // 确认按钮（执行当前模式）
        const confirmButton = rightButtonsContainer.createEl('button', {
            cls: 'polyglot-confirm-button',
            title: tr('执行当前模式（或按回车）', 'Run the current mode (or press Enter)')
        });
        confirmButton.setText(tr('查询', 'Look up'));
        confirmButton.setAttribute('aria-label', tr('查询当前文本', 'Look up the current text'));
        confirmButton.addEventListener('click', () => {
            this.runActiveMode();
        });

        // 保存按钮引用，以便在设置变化时更新
        this.wordSelectionToggle = wordSelectionToggle;

        // 语种：一个分段控件选查词方式，旁边“…”是当前语种的选项；翻译成中文是单独的一步操作
        const buttonContainer = this.actionsContent.createDiv({ cls: "polyglot-mode-row" });
        const seg = buttonContainer.createDiv({ cls: 'ap-seg polyglot-mode-seg' });
        const japBtn = seg.createEl("button", { text: tr("日语", "Japanese") });
        const engBtn = seg.createEl("button", { text: tr("英语", "English") });
        const quickJpBtn = seg.createEl("button", { text: tr("译日语", "To Japanese") });
        japBtn.addEventListener("click", () => this.setActiveMode('japanese'));
        engBtn.addEventListener("click", () => this.setActiveMode('english'));
        quickJpBtn.addEventListener("click", () => this.setActiveMode('quick_to_japanese'));
        const modeOptions = buttonContainer.createEl("button", { cls: "polyglot-mode-options clickable-icon", attr: { 'aria-label': tr('当前语种的选项', 'Options for the current language') } });
        setIcon(modeOptions, 'sliders-horizontal');
        modeOptions.addEventListener('click', (event) => {
            if (this.activeMode === 'japanese') this.showJapaneseOptionsPanel(event);
            else if (this.activeMode === 'english') this.showEnglishOptionsPanel(event);
            else this.showQuickOptionsPanel(event);
        });
        const quickZhBtn = buttonContainer.createEl("button", { text: tr("翻译成中文", "To Chinese"), cls: "ap-btn is-outline polyglot-to-chinese" });
        quickZhBtn.addEventListener("click", fire(() => this.handleQuickProcess()));

        // 记录按钮引用，便于切换高亮
        this.modeButtons = { japBtn, engBtn, quickJpBtn };

        // 设置初始模式（从设置中读取上次选择）
        // 旧版本把“译中文”也存成模式；现在它是按钮，回到英语
        const lastMode = this.plugin.settings.lastSelectedMode || 'quick_to_japanese';
        const savedMode = lastMode === 'quick_english' ? 'english' : lastMode;
        this.setActiveMode(savedMode);

        // 输入框回车：执行当前模式
        this.queryInput.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.runActiveMode();
            }
        });

        // 初始化时记录当前活动文件
        this.updateLastActiveFile();

        this.renderHistory('');

        // Register event listeners
        this.registerEvent(
            // @ts-ignore
            this.app.workspace.on('polyglot-settings-change', () => {
                this.renderHistory('');
                // 更新选词模式开关状态
                if (this.wordSelectionToggle) {
                    this.wordSelectionToggle.toggleClass('active', this.plugin.settings.wordSelectionMode || false);
                    this.wordSelectionToggle.setAttribute('title', this.plugin.settings.wordSelectionMode ? tr('选词模式：已开启', 'Word-selection mode: on') : tr('选词模式：已关闭', 'Word-selection mode: off'));
                }
            })
        );
        this.registerEvent(
            // @ts-ignore
            this.app.workspace.on('polyglot-query-success', (result: unknown) => { if (typeof result === 'string') void this.renderResult(result); })
        );
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.updateLastActiveFile();
            })
        );

        // Track the last active editor
        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            if (leaf?.view instanceof MarkdownView) {
                this.lastActiveLeaf = leaf.view;
            }
        }));

        // Initialize with the current active leaf
        const currentLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (currentLeaf) {
            this.lastActiveLeaf = currentLeaf;
        }

        // 注册选词模式监听器
        this.setupWordSelectionMode();

        this.showIdleState();
        this.showPane('look');
    }

    /** 切换“查词”“学习”两页；学习页每次打开都重新数到期的词。 */
    showPane(which: 'look' | 'learn') {
        for (const key of ['look', 'learn'] as const) {
            this.panes[key]?.toggleClass('is-active', key === which);
            this.tabButtons[key]?.toggleClass('is-active', key === which);
        }
        if (which === 'learn') this.review?.renderHome();
    }

    async renderResult(result: string, isHistory = false, historyItem?: HistoryItem) {
        this.displayContainer.empty();
        this.displayContainer.addClass('polyglot-results-active');

        const cards = parseWordCards(result);
        if (cards.length) {
            cards.forEach((card, i) => this.renderWordCard(card, result, historyItem, cards.length > 1 && i > 0));
            const last = this.displayContainer.lastElementChild as HTMLElement | null;
            if (last) {
                this.renderVocabFooter(last, cards.length === 1 ? cards[0].headword : '', historyItem);
                // 词典来源始终是卡片最后一行
                const source = last.querySelector('.polyglot-word-source');
                if (source) last.appendChild(source);
            }
            return;
        }

        // 认不出词头的结果（自由文本、旧格式）仍按 Markdown 显示
        const actionBar = this.displayContainer.createDiv({ cls: 'polyglot-results-action-bar' });
        const contentDiv = this.displayContainer.createDiv('polyglot-result-content');
        await MarkdownRenderer.render(this.app, result, contentDiv, '', this);
        this.applyCardLayout(contentDiv);
        this.applyCollapsibleSections(contentDiv);
        this.foldSecondarySections(contentDiv);
        this.applyPOSTagging(contentDiv);
        this.renderVocabFooter(contentDiv, result.match(/^##\s+(.+?)(?:\s+-\s+.*)?\s*$/m)?.[1]?.trim() || '', historyItem);
        this.createEnhancedActionButtons(actionBar, result, contentDiv, historyItem);
    }

    /**
     * 一张词卡：大字词头；音标、发音、收进生词本同一行；词性胶囊；
     * 义项按词性分组，例句译文用次级文字；词典来源一行灰字注在底部。
     */
    private renderWordCard(card: WordCard, result: string, historyItem: HistoryItem | undefined, compact: boolean) {
        const el = this.displayContainer.createDiv({ cls: 'polyglot-word ap-card' });
        if (compact) el.addClass('is-compact');

        const top = el.createDiv({ cls: 'polyglot-word-top' });
        top.createDiv({ cls: 'polyglot-word-head', text: card.headword });
        const more = top.createEl('button', { cls: 'polyglot-word-more clickable-icon', attr: { 'aria-label': tr('更多操作', 'More actions') } });
        setIcon(more, 'more-horizontal');
        more.addEventListener('click', (event) => this.showResultMenu(event, result, historyItem, card));

        const meta = el.createDiv({ cls: 'polyglot-word-meta' });
        if (card.phonetic) meta.createSpan({ cls: 'polyglot-word-phonetic', text: card.phonetic });
        const audio = card.audio || (historyItem?.type !== 'japanese' && /^[A-Za-z][A-Za-z' -]*$/.test(card.headword) ? getAudioUrl(card.headword) : '');
        if (audio) {
            const play = meta.createEl('button', { cls: 'polyglot-word-play', attr: { 'aria-label': tr('发音', 'Pronunciation') } });
            setIcon(play, 'volume-2');
            play.addEventListener('click', () => this.playSource(audio));
        }
        meta.createDiv({ cls: 'polyglot-word-spacer' });
        const saved = this.findVocabItem(card.headword);
        const add = meta.createEl('button', { cls: 'ap-btn is-tinted polyglot-word-add' });
        const setAdded = (done: boolean) => {
            add.empty();
            setIcon(add.createSpan(), done ? 'check' : 'bookmark-plus');
            add.createSpan({ text: done ? tr('已在生词本', 'In word list') : tr('加入生词本', 'Add to word list') });
            add.toggleClass('is-done', done);
        };
        setAdded(!!saved);
        add.addEventListener('click', fire(async () => {
            if (add.hasClass('is-done')) return;
            await this.addToVocabulary(result, historyItem, card);
            setAdded(true);
        }));

        if (card.pos.length || card.gloss) {
            const gloss = el.createDiv({ cls: 'polyglot-word-gloss' });
            for (const pos of card.pos) gloss.createSpan({ cls: 'ap-pill is-accent', text: pos });
            if (card.gloss) this.renderInline(gloss.createSpan(), card.gloss);
        }

        for (const section of card.sections) {
            const block = el.createDiv({ cls: 'polyglot-word-section' });
            let body = block;
            if (section.folded) {
                // 74 号附录的展开行：原生 <details>，键盘和读屏都能用
                const details = block.createEl('details', { cls: 'ap-disclosure polyglot-word-disclosure' });
                details.createEl('summary', { cls: 'ap-row', text: section.title });
                body = details.createDiv({ cls: 'ap-disclosure-body' });
            } else {
                block.createDiv({ cls: 'polyglot-word-section-title', text: section.title });
            }
            const sources = new Set(section.groups.map(group => group.source).filter(Boolean));
            for (const group of section.groups) {
                if (group.source && sources.size > 1) body.createDiv({ cls: 'polyglot-word-group-source', text: group.source });
                if (group.pos) body.createDiv({ cls: 'polyglot-word-group' }).createSpan({ cls: 'ap-pill', text: group.pos });
                const list = body.createDiv({ cls: 'polyglot-word-lines' });
                group.lines.forEach((line, i) => this.renderCardLine(list, line, group.numbered ? i + 1 : 0));
            }
        }

        if (card.sources.length) el.createDiv({ cls: 'polyglot-word-source', text: tr(`来源：${card.sources.join(' · ')}`, `Sources: ${card.sources.join(' · ')}`) });
    }

    private renderCardLine(list: HTMLElement, line: CardLine, index: number) {
        const row = list.createDiv({ cls: 'polyglot-word-line' });
        if (index) row.createSpan({ cls: 'polyglot-word-index', text: String(index) });
        const main = row.createDiv({ cls: 'polyglot-word-line-main' });
        if (line.label) this.renderInline(main.createDiv({ cls: 'polyglot-word-label' }), line.label);
        this.renderInline(main.createDiv({ cls: 'polyglot-word-text' }), line.text);
        if (line.sub) this.renderInline(main.createDiv({ cls: 'polyglot-word-sub' }), line.sub);
        if (line.audio) {
            const play = row.createEl('button', { cls: 'polyglot-word-play is-small', attr: { 'aria-label': tr('朗读这一句', 'Read this sentence') } });
            setIcon(play, 'volume-2');
            const src = line.audio;
            play.addEventListener('click', () => this.playSource(src));
        }
    }

    /** 行内只保留加粗、斜体与 <ruby> 注音。 */
    private renderInline(parent: HTMLElement, text: string) {
        const html = text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[\s(（])_([^_]+)_(?=[\s),.;:，。）]|$)/g, '$1<em>$2</em>')
            .replace(/`([^`]+)`/g, '$1');
        parent.append(sanitizeHTMLToDom(html));
    }

    private playSource(src: string) {
        const url = /^(https?:|app:|data:|blob:)/.test(src) ? src : this.app.vault.adapter.getResourcePath(normalizePath(src));
        new Audio(url).play().catch(() => new Notice(tr('音频播放失败', 'Could not play the audio')));
    }

    private findVocabItem(word: string) {
        const s = this.plugin.settings;
        if (!word) return undefined;
        return s.englishVocabItems[word.toLowerCase()] || s.englishVocabItems[word]
            || Object.values(s.japaneseVocabItems).find(v => v.japaneseText === word || v.originalText === word);
    }

    /** 结果的次要操作都收进“…”菜单。 */
    private showResultMenu(event: MouseEvent, result: string, historyItem?: HistoryItem, card?: WordCard) {
        const menu = new Menu();
        menu.addItem(item => item.setTitle(tr('插入到当前笔记', 'Insert into current note')).setIcon('file-plus-2').onClick(() => this.insertToCurrentNote(result)));
        menu.addItem(item => item.setTitle(tr('复制', 'Copy')).setIcon('copy').onClick(() => this.copyToClipboard(result)));
        menu.addItem(item => item.setTitle(tr('输出到新笔记', 'Output to a new note')).setIcon('file-plus').onClick(() => this.createNewNote(result, historyItem)));
        menu.addItem(item => item.setTitle(tr('输出到固定文件', 'Output to the fixed file')).setIcon('file-text').onClick(() => this.outputToFixedFile(result, historyItem)));
        if (card?.image) {
            const image = card.image;
            menu.addItem(item => item.setTitle(tr('查看图片', 'View image')).setIcon('image').onClick(() => window.open(image)));
        }
        menu.addSeparator();
        menu.addItem(item => item.setTitle(tr('清空结果', 'Clear result')).setIcon('x').onClick(() => this.clearResults()));
        menu.showAtMouseEvent(event);
    }

    // 将内容转换为卡片式布局
    private applyCardLayout(container: HTMLElement) {
        // 不再给callout添加额外的样式，使用Obsidian原生样式

        // 处理定义列表为卡片（仅限非callout内的）
        const definitionLists = container.querySelectorAll('dl, ul');
        definitionLists.forEach(list => {
            if (!list.closest('.callout')) {
                list.addClass('polyglot-card');
            }
        });

        // 美化例句显示（仅限非callout的blockquote）
        const examples = container.querySelectorAll('blockquote:not(.callout)');
        examples.forEach(example => {
            example.addClass('polyglot-example');
        });
    }

    // 添加可折叠区域
    private applyCollapsibleSections(container: HTMLElement) {
        // 查找所有h3标题作为可折叠区域的头部
        const headings = container.querySelectorAll('h3');
        headings.forEach(heading => {
            // 创建可折叠容器
            const collapsible = createDiv();
            collapsible.className = 'polyglot-collapsible';
            heading.parentNode?.insertBefore(collapsible, heading);

            // 创建标题栏
            const header = createDiv();
            header.className = 'polyglot-collapsible-header';
            
            // 移动标题到标题栏
            const title = createEl('h3');
            title.className = 'polyglot-collapsible-title';
            title.textContent = heading.textContent || '';
            header.appendChild(title);
            
            // 添加折叠图标
            const icon = createSpan();
            icon.className = 'polyglot-collapsible-icon';
            icon.textContent = '▼';
            header.appendChild(icon);
            
            collapsible.appendChild(header);
            
            // 创建内容区域
            const content = createDiv();
            content.className = 'polyglot-collapsible-content';
            
            // 收集该标题后面的所有元素，直到下一个同级标题
            let nextEl = heading.nextElementSibling;
            const elementsToMove = [];
            
            while (nextEl && nextEl.tagName !== 'H3') {
                elementsToMove.push(nextEl);
                nextEl = nextEl.nextElementSibling;
            }
            
            // 将元素移动到内容区域
            elementsToMove.forEach(el => {
                content.appendChild(el);
            });
            
            collapsible.appendChild(content);
            
            // 移除原始标题
            heading.remove();
            
            // 添加点击事件
            header.addEventListener('click', () => {
                collapsible.classList.toggle('open');
            });
            
            // 默认全部展开，点标题收起
            collapsible.classList.add('open');
        });
    }

    /** 医学用法、俚语、习语默认收起，点标题展开。 */
    private foldSecondarySections(container: HTMLElement) {
        container.querySelectorAll<HTMLElement>('.callout').forEach(callout => {
            const title = callout.querySelector<HTMLElement>('.callout-title');
            if (!title || !/医学|俚语|习语|Medical|Slang|Idiom/i.test(title.textContent || '')) return;
            callout.addClass('polyglot-folded');
            title.addEventListener('click', () => callout.toggleClass('is-open', !callout.hasClass('is-open')));
        });
    }

    /** 词已在生词本里时，结果底部显示掌握程度、下次复习日和出处。 */
    private renderVocabFooter(container: HTMLElement, heading: string, historyItem?: HistoryItem) {
        const word = (historyItem?.query || heading || '').trim();
        if (!word || !this.plugin.settings.enableLearningTracker) return;
        const item = this.findVocabItem(word);
        if (!item) return;

        const foot = container.createDiv({ cls: 'polyglot-vocab-foot' });
        const source = sourceNote(item.notes);
        if (source) foot.createDiv({ cls: 'polyglot-muted', text: source });
        const row = foot.createDiv({ cls: 'polyglot-vocab-foot-row' });
        row.createSpan({ text: tr('掌握程度', 'Mastery') });
        const level = row.createSpan({ cls: 'polyglot-level' });
        const filled = 4 - Math.min(4, Math.max(0, item.difficulty));
        for (let i = 0; i < 4; i++) level.createEl('i', { cls: i < filled ? 'is-on' : '' });
        const next = item.nextReview && item.nextReview > Date.now()
            ? tr(`下次复习：${new Date(item.nextReview).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}`, `Next review: ${new Date(item.nextReview).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`)
            : tr('今天可以复习', 'Ready to review today');
        row.createSpan({ text: next });
    }

    // 添加词性标签
    private applyPOSTagging(container: HTMLElement) {
        // 查找所有可能包含词性的元素
        const elements = container.querySelectorAll('p, li, dt, dd');
        
        const posPatterns = [
            { regex: /\b(n\.|noun|名词)\b/i, class: 'polyglot-pos-noun', text: tr('名词', 'Noun') },
            { regex: /\b(v\.|verb|动词)\b/i, class: 'polyglot-pos-verb', text: tr('动词', 'Verb') },
            { regex: /\b(adj\.|adjective|形容词)\b/i, class: 'polyglot-pos-adj', text: tr('形容词', 'Adjective') },
            { regex: /\b(adv\.|adverb|副词)\b/i, class: 'polyglot-pos-adv', text: tr('副词', 'Adverb') },
            { regex: /\b(prep\.|preposition|介词)\b/i, class: 'polyglot-pos-other', text: tr('介词', 'Preposition') },
            { regex: /\b(conj\.|conjunction|连词)\b/i, class: 'polyglot-pos-other', text: tr('连词', 'Conjunction') },
            { regex: /\b(pron\.|pronoun|代词)\b/i, class: 'polyglot-pos-other', text: tr('代词', 'Pronoun') },
            { regex: /\b(interj\.|interjection|感叹词)\b/i, class: 'polyglot-pos-other', text: tr('感叹词', 'Interjection') }
        ];
        
        elements.forEach(element => {
            const text = element.textContent || '';
            
            for (const pattern of posPatterns) {
                if (pattern.regex.test(text)) {
                    // 创建词性标签
                    const tag = createSpan();
                    tag.className = `polyglot-pos-tag ${pattern.class}`;
                    tag.textContent = pattern.text;
                    
                    // 如果是列表项或定义术语，插入到开头
                    if (element.tagName === 'LI' || element.tagName === 'DT') {
                        element.insertBefore(tag, element.firstChild);
                        break;
                    }
                }
            }
        });
    }

    renderHistory(searchTerm: string) {
        const existingHistoryContainer = this.actionsContent.querySelector(".polyglot-history-container");
        if (existingHistoryContainer) {
            existingHistoryContainer.remove();
        }
        
        const historyContainer = this.actionsContent.createDiv("polyglot-history-container");
        const history = this.plugin.settings.queryHistory.filter(item =>
            item.query.toLowerCase().includes(searchTerm.toLowerCase())
        );

        const header = historyContainer.createDiv({ cls: 'polyglot-history-header' });
        header.createEl("h5", { text: tr("最近查询", "Recent lookups") });

        this.historySearchInput = new TextComponent(header)
            .setPlaceholder(tr('搜索...', 'Search...'))
            .setValue(searchTerm)
            .onChange((value) => {
                this.renderHistory(value);
            });
        this.historySearchInput.inputEl.addClass('polyglot-history-search');

        const clearButton = header.createEl('button', { text: tr('清空', 'Clear'), cls: 'polyglot-history-clear' });
        clearButton.addEventListener('click', fire(async () => {
            this.plugin.settings.queryHistory = [];
            await this.plugin.saveSettings();
            this.renderHistory('');
            new Notice(tr("查询历史已清空。", "History cleared."));
        }));

        const list = historyContainer.createDiv({ cls: "polyglot-history-list" });

        if (history.length === 0) {
            list.createDiv({text: tr('无历史记录', 'No history yet'), cls: 'polyglot-history-empty'});
            return;
        }

        history.forEach((item: HistoryItem) => {
            const historyItemEl = list.createDiv({ cls: "polyglot-history-item" });

            // 早期版本的结构：直接在item中创建文本和类型标签
            historyItemEl.createSpan({ text: item.query, cls: 'polyglot-history-query-text' });
            historyItemEl.createSpan({ text: this.getHistoryItemTypeName(item.type), cls: 'polyglot-history-query-type' });

            // 为翻译类型的记录添加播放按钮
            if (item.type === 'quick_to_japanese' && item.translation) {
                const playBtn = historyItemEl.createEl('button', { cls: 'polyglot-history-play-btn' });
                setIcon(playBtn, 'volume-2');
                playBtn.setAttribute('aria-label', tr('播放日语语音', 'Play the Japanese'));
                playBtn.setAttribute('title', tr(`播放: ${item.translation}`, `Play: ${item.translation}`));

                playBtn.addEventListener('click', fire(async (event) => {
                    event.stopPropagation(); // 防止触发主项目点击事件

                    try {
                        await this.plugin.playJapaneseVoice(item.translation!, this.plugin.settings.forceRefreshAudio);
                        new Notice(tr(`🎵 播放: ${item.translation}`, `🎵 Playing: ${item.translation}`));
                    } catch (error) {
                        console.error('History voice playback error:', error);
                        new Notice(tr(`❌ 语音播放失败: ${errorMessage(error)}`, `❌ Could not play the audio: ${errorMessage(error)}`));
                    }
                }));
            }

            // 跳转到输出位置按钮（如果记录包含输出位置信息）
            if (item.outputLocation && item.outputLocation.destination !== 'sidebar') {
                const jumpBtn = historyItemEl.createEl('button', { cls: 'polyglot-history-item-jump' });
                setIcon(jumpBtn, 'external-link');
                jumpBtn.setAttribute('aria-label', tr('跳转到输出位置', 'Go to where it was written'));
                jumpBtn.setAttribute('title', tr('跳转到输出位置', 'Go to where it was written'));

                jumpBtn.addEventListener('click', fire(async (event) => {
                    event.stopPropagation(); // 防止触发主项目点击事件
                    await this.jumpToHistoryItemLocation(item);
                }));
            }

            // 删除按钮保持现有功能
            const deleteBtn = historyItemEl.createEl('button', { cls: 'polyglot-history-item-delete' });
            setIcon(deleteBtn, 'trash-2');
            deleteBtn.setAttribute('aria-label', tr('删除此条记录', 'Delete this record'));

            // Add click listener for the delete button
            deleteBtn.addEventListener('click', fire(async (event) => {
                event.stopPropagation(); // VERY IMPORTANT: Prevents the main item click event

                const index = this.plugin.settings.queryHistory.indexOf(item);
                if (index > -1) {
                    this.plugin.settings.queryHistory.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.renderHistory(this.historySearchInput.getValue()); // Refresh the view
                }
            }));

            // Add click listener for the whole item
            historyItemEl.addEventListener("click", fire(async () => {
                if (item.type === 'quick_to_japanese') {
                    // 对于日语翻译记录，在显示区域显示结果
                    if (item.translation) {
                        this.displayQuickTranslationResult(
                            item.query,
                            item.translation,
                            false,
                            "→日",
                            item.romaji
                        );
                    } else {
                        new Notice(tr(`原文: ${item.query}`, `Source: ${item.query}`));
                    }
                } else if (item.type === 'quick_english') {
                    // 对于英汉翻译记录，优先使用保存的翻译结果
                    if (item.translation) {
                        // 如果有保存的翻译结果，直接显示
                        this.displayQuickTranslationResult(
                            item.query,
                            item.translation,
                            false,
                            "→汉"
                        );
                    } else {
                        // 如果没有保存的翻译结果，重新获取并显示
                        void this.displayQuickTranslationFromHistory(item);
                    }
                } else if (item.type === 'japanese') {
                    // 对于日语分析记录，先尝试从缓存获取，如果失败则重新处理
                    const cachedResult = await this.plugin.getCachedResult(item);
                    if (cachedResult) {
                        void this.renderResult(cachedResult, true, item);
                    } else {
                        // 缓存未找到，重新处理日语分析并直接显示在面板中
                        new Notice(tr("缓存未找到，正在重新分析...", "Not in the cache; analysing again..."));
                        try {
                            const resultObj = await this.plugin.japaneseProcessor.runJapaneseProcess(item.query, false);
                            if (resultObj) {
                                const { original, colloquial, markdown } = resultObj;

                                // 生成标题
                                const kihonkeiMatch = markdown.match(/> - \*\*基本形:\*\* (.*)/);
                                let titlePart = kihonkeiMatch ? kihonkeiMatch[1].trim() : null;
                                if (!titlePart) {
                                    const colloquialBoldMatch = colloquial.match(/\*\*(.*?)\*\*/);
                                    titlePart = colloquialBoldMatch ? colloquialBoldMatch[1] : colloquial;
                                }

                                const header = `## ${original} - ${titlePart}`;
                                const finalResult = `${header}\n\n${markdown}`;

                                // 直接在面板中显示结果
                                void this.renderResult(finalResult, true, item);
                            } else {
                                new Notice(tr("重新分析失败", "Could not analyse again"));
                            }
                        } catch (error) {
                            new Notice(tr(`重新分析失败: ${errorMessage(error)}`, `Could not analyse again: ${errorMessage(error)}`));
                        }
                    }
                } else if (item.type === 'english') {
                    // 对于英语分析记录，先尝试从缓存获取，如果失败则重新处理
                    const cachedResult = await this.plugin.getCachedResult(item);
                    if (cachedResult) {
                        void this.renderResult(cachedResult, true, item);
                    } else {
                        // 缓存未找到，重新处理英语分析并直接显示在面板中
                        new Notice(tr("缓存未找到，正在重新分析...", "Not in the cache; analysing again..."));
                        try {
                            // 导入英语处理函数
                            const { runEnglishProcess } = await import('./english-processor');
                            const result = await runEnglishProcess(
                                item.query,
                                false,
                                this.plugin.settings,
                                this.plugin.logger,
                                this.app,
                                this.plugin.manifest.dir,
                                this.plugin.saveSettings.bind(this.plugin)
                            );
                            if (result) {
                                // 直接在面板中显示结果
                                void this.renderResult(result, true, item);
                            } else {
                                new Notice(tr("重新分析失败", "Could not analyse again"));
                            }
                        } catch (error) {
                            new Notice(tr(`重新分析失败: ${errorMessage(error)}`, `Could not analyse again: ${errorMessage(error)}`));
                        }
                    }
                } else {
                    // 对于其他未知类型
                    new Notice(tr(`未知的历史记录类型: ${String(item.type)}`, `Unknown history type: ${String(item.type)}`));
                }
            }));
        });
    }

    private getHistoryItemTypeName(type: HistoryItem['type']): string {
        switch (type) {
            case 'english': return tr('英', 'EN');
            case 'japanese': return tr('日', 'JA');
            case 'quick_english': return tr('→汉', '→ZH');
            case 'quick_to_japanese': return tr('→日', '→JA');
            default: return '?';
        }
    }

    async onClose() {
        this.review?.destroy();
    }

    private _getActiveEditor(): Editor | undefined {
        // This is still useful for the initial query trigger, 
        // but not for actions after the result is rendered.
        return this.app.workspace.activeEditor?.editor;
    }

    private async handleProcess(type: "english" | "japanese") {
        const query = this.queryInput.getValue().trim();
        if (!query) {
            new Notice(tr("请在侧边栏输入或在编辑器中选中文本。", "Type in the side panel or select text in the editor."));
            return;
        }

        // 锁定开始处理时的目标文件
        const targetFile = this.getTargetFile();
        const outputDestination = this.plugin.settings.outputDestination;

        // 如果输出模式需要文件但没有活动文件，提前提示
        if (!targetFile && (outputDestination === 'appendCurrent' || outputDestination === 'replace')) {
            new Notice(tr("当前没有打开的文件，结果将在侧边栏显示。\n💡 提示：请打开一个文件，或更改输出位置。", "No file is open, so the result is shown in the side panel.\n💡 Open a file or change the output location."));
        } else if (targetFile && (outputDestination === 'appendCurrent' || outputDestination === 'replace')) {
            new Notice(tr(`🎯 目标文件已锁定：${targetFile.name}\n处理过程中可以自由切换文件。`, `🎯 Target file locked: ${targetFile.name}\nYou can switch files while it runs.`));
        }

        const force = this.plugin.settings.forceRefresh;

        this.lastQuery = { text: query, type };
        this.queryInput.setValue('');
        await this.runLookup(query, type, force, targetFile);
    }

    /** 查一个词：结果区显示进行到哪一步，可取消；失败时说清原因并能重试。 */
    private async runLookup(query: string, type: 'english' | 'japanese', force: boolean, targetFile: TFile | null) {
        const run = ++this.lookupRun;
        const cancelled = () => run !== this.lookupRun;
        this.showStatus({
            kind: 'working',
            title: type === 'english'
                ? tr(`正在查“${query}”…`, `Looking up "${query}"…`)
                : tr(`正在分析“${query}”…`, `Analysing "${query}"…`),
            detail: tr('先查词典，再请 AI 分析，通常 5–20 秒。', 'Dictionaries first, then the AI; usually 5–20 seconds.'),
            action: {
                label: tr('取消', 'Cancel'),
                run: () => {
                    this.lookupRun++;
                    this.showIdleState();
                },
            },
        });
        const options = { quiet: true, isCancelled: cancelled };
        const outcome = type === 'english'
            ? await this.plugin.processEnglish(query, force, targetFile, undefined, options)
            : await this.plugin.processJapanese(query, force, targetFile, undefined, options);
        if (cancelled() || outcome.status === 'cancelled') return;
        if (outcome.status === 'done') {
            // 侧栏输出时 renderResult 已经画好结果；写进笔记时这里收起状态卡片
            if (this.displayContainer.querySelector('.polyglot-status')) this.showIdleState();
            return;
        }
        if (outcome.status === 'empty') {
            this.showStatus({
                kind: 'empty',
                title: tr(`没有查到“${query}”`, `Nothing found for "${query}"`),
                detail: tr('换个拼写或词形再试，或者把它当句子翻译成中文。', 'Try another spelling or form, or translate it as a sentence.'),
                action: { label: tr('翻译成中文', 'Translate to Chinese'), run: () => { this.queryInput.setValue(query); void this.handleQuickProcess(); } },
            });
            return;
        }
        this.showFailure(outcome.error, () => { void this.runLookup(query, type, true, targetFile); });
    }

    /**
     * 收词时记下出处：查词前所在的笔记，以及那篇笔记里光标所在、含这个词的那一句。
     * 和查词小卡写的“收自 [[笔记]] · 日期”同一格式，复习时会显示出来。
     */
    private collectionContext(word: string): { note: string; examples: string[] } {
        const now = new Date();
        const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
        const view = this.lastActiveLeaf;
        const file = view?.file;
        let sentence = '';
        const editor = view?.editor;
        if (editor && word) {
            const line = editor.getLine(editor.getCursor().line) || '';
            if (line.toLowerCase().includes(word.toLowerCase())) {
                const parts = line.match(/[^.!?。！？]+[.!?。！？]*/g) ?? [line];
                sentence = (parts.find((part) => part.toLowerCase().includes(word.toLowerCase())) || line).replace(/^[#>\-*\s]+/, '').trim().slice(0, 300);
            }
        }
        return {
            note: `收自 ${file ? `[[${file.basename}]]` : '语言助手'} · ${today}`,
            examples: sentence ? [sentence] : [],
        };
    }

    private lookupRun = 0;

    /** 失败卡片：按 AI 错误分类说原因和改法，给“重试”；配置类问题再给“打开设置”。 */
    private showFailure(error: unknown, retry: () => void) {
        const message = errorMessage(error);
        const status = Number(/status (\d{3})/.exec(message)?.[1] ?? /\((\d{3})\)/.exec(message)?.[1] ?? 0) || undefined;
        const noConfig = /没有可用的API配置|配置不完整/.test(message);
        const failure = classifyAiFailure({ status, error, hasKey: !noConfig });
        const configProblem = ['no-key', 'auth', 'quota', 'model'].includes(failure.kind);
        this.showStatus({
            kind: 'failed',
            title: failure.message,
            detail: failure.fix,
            action: { label: tr('重试', 'Retry'), run: retry },
            secondary: configProblem ? { label: tr('打开设置', 'Open settings'), run: () => this.openSettings() } : undefined,
        });
    }

    private openSettings() {
        const settings = (this.app as typeof this.app & { setting?: { open(): void; openTabById(id: string): void } }).setting;
        settings?.open();
        settings?.openTabById(this.plugin.manifest.id);
    }

    private hasAiService(): boolean {
        return this.plugin.settings.apiConfigs.some((config) => config.enabled && !!config.apiKey);
    }

    /** 结果区没有内容时：先看有没有配 AI，再提示怎么开始。 */
    private showIdleState() {
        if (!this.hasAiService()) {
            this.showStatus({
                kind: 'setup',
                title: tr('还没有配置 AI 服务', 'No AI service yet'),
                detail: tr('只查词典和读音不需要 AI。', 'Dictionaries and pronunciation work without it.'),
                action: { label: tr('打开 AI 设置', 'Open AI settings'), run: () => this.openSettings() },
                secondary: { label: tr('先看示例', 'See an example'), run: () => { void this.loadSample(); } },
            });
            return;
        }
        this.showStatus({
            kind: 'idle',
            title: tr('选中一个词，或在上面输入', 'Select a word, or type one above'),
            action: { label: tr('载入示例', 'Load example'), run: () => { void this.loadSample(); } },
        });
    }

    private showStatus(options: {
        kind: 'setup' | 'idle' | 'working' | 'empty' | 'failed';
        title: string;
        detail?: string;
        action?: { label: string; run: () => void };
        secondary?: { label: string; run: () => void };
    }) {
        this.displayContainer.empty();
        this.displayContainer.removeClass('polyglot-results-active');
        const card = this.displayContainer.createDiv({ cls: `polyglot-status is-${options.kind}` });
        const icon = card.createDiv({ cls: 'polyglot-status-icon' });
        setIcon(icon, { setup: 'key-round', idle: 'search', working: 'loader', empty: 'search-x', failed: 'alert-circle' }[options.kind]);
        card.createDiv({ cls: 'polyglot-status-title', text: options.title });
        if (options.detail) card.createDiv({ cls: 'polyglot-status-detail', text: options.detail });
        const row = card.createDiv({ cls: 'polyglot-status-actions' });
        if (options.action) {
            const button = row.createEl('button', { cls: 'mod-cta', text: options.action.label });
            button.addEventListener('click', options.action.run);
        }
        if (options.secondary) {
            const button = row.createEl('button', { text: options.secondary.label });
            button.addEventListener('click', options.secondary.run);
        }
    }

    /** 新建一篇标明“演示”的笔记，放一小段英文和日文，并把一个词填进查询框。 */
    private async loadSample() {
        const path = normalizePath(tr('语言助手示例（演示，可删除）.md', 'Polyglot Helper example (demo, safe to delete).md'));
        let file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) file = await this.app.vault.create(path, sampleNote());
        if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
        this.setActiveMode('english');
        this.queryInput.setValue('postpone');
        this.queryInput.inputEl.focus();
        this.showStatus({
            kind: 'idle',
            title: tr('示例已载入', 'Example loaded'),
            detail: tr(
                '已把 postpone 填进查询框，点“查询”看词卡。也可以在笔记里选中别的词或那句日语。',
                'postpone is in the search box: press Look up to see its card. You can also select another word or the Japanese sentence in the note.',
            ),
            action: { label: tr('查询', 'Look up'), run: () => this.runActiveMode() },
        });
    }

    private async handleQuickToJapanese() {
        const query = this.queryInput.getValue().trim();
        if (!query) {
            new Notice(tr("请输入文本。", "Type some text."));
            return;
        }

        // 创建一个持续的处理状态提示
        const processingNotice = new Notice(tr("🔄 正在翻译并生成语音...", "🔄 Translating and generating speech..."), 0); // 0表示不自动关闭

        try {
            // 检查API配置
            const { englishLlmApiKey, englishLlmBaseUrl, ttsEngine } = this.plugin.settings;
            if (!englishLlmApiKey || !englishLlmBaseUrl) {
                processingNotice.hide();
                new Notice(tr("❌ 请先在设置中配置 LLM 的 API 密钥和接口地址", "❌ Add an AI key and endpoint in settings first"));
                return;
            }

            // 与分析一致：先取缓存，未命中再处理
            const force = !!this.plugin.settings.forceRefresh;
            let quick: { translation: string; reading?: string; romaji?: string; audioFilePath?: string | null } | null = null;
            if (!force && this.plugin.manifest.dir) {
                quick = await getFromCache<{ translation: string; reading?: string; romaji?: string; audioFilePath?: string | null }>(
                    this.app,
                    this.plugin.manifest.dir,
                    'japanese',
                    `quick_${query}`
                );
            }

            let japaneseTranslation: string | null = quick?.translation || null;
            if (!japaneseTranslation) {
                // 使用之前稳定流程获取翻译与读音
                const rich = await this.plugin.translateToJapaneseRich(query);
                japaneseTranslation = rich?.jp || await this.plugin.translateToJapanese(query);
                // 获取纯假名读音，并优先使用 LLM 提供的 romaji
                let reading: string | null = await this.plugin.getJapaneseReading(japaneseTranslation || '');
                const romajiFromLLM: string | undefined = rich?.romaji || undefined;
                // 写入缓存（与日语分析使用的同一子目录/键）
                if (japaneseTranslation && this.plugin.manifest.dir) {
                    await saveToCache(
                        this.app,
                        this.plugin.manifest.dir,
                        'japanese',
                        `quick_${query}`,
                        { translation: japaneseTranslation, reading: (reading || ''), romaji: romajiFromLLM || '', audioFilePath: null }
                    );
                }
                quick = { translation: japaneseTranslation!, reading: (reading || ''), romaji: romajiFromLLM || '', audioFilePath: null };
            }

            if (japaneseTranslation) {
                // 译文
                const finalText = japaneseTranslation;
                // 预先计算罗马音（若开启）：优先用 LLM 输出的 romaji
                let precomputedRomaji: string | undefined;
                if (this.plugin.settings.quickTranslationOptions?.showRomaji) {
                    if (quick?.romaji && quick.romaji.trim().length > 0) {
                        precomputedRomaji = quick.romaji.trim();
                    } else {
                    let kana = (quick?.reading && quick.reading.trim().length > 0) ? quick.reading : '';
                    if (!/^[\u3040-\u30FF\s]+$/.test(kana)) {
                        try {
                            const readingNow = await this.plugin.getJapaneseReading(japaneseTranslation);
                            if (readingNow && readingNow.trim().length > 0) {
                                kana = readingNow;
                                // 回写缓存以便下次直接使用纯假名
                                if (this.plugin.manifest.dir) {
                                    await saveToCache(this.app, this.plugin.manifest.dir, 'japanese', `quick_${query}`, { translation: japaneseTranslation, reading: readingNow, romaji: '', audioFilePath: null });
                                }
                            }
                        } catch {
                            // 读音取不到就用译文本身
                        }
                    }
                    const { kanaToRomaji } = await import('./utils');
                    precomputedRomaji = kanaToRomaji(kana && kana.trim().length > 0 ? kana : japaneseTranslation);
                    }
                }

                // 添加到历史记录
                const historyItem: HistoryItem = {
                    query: query,
                    type: 'quick_to_japanese',
                    timestamp: Date.now(),
                    sections: {},
                    translation: japaneseTranslation,
                    romaji: precomputedRomaji
                };
                this.plugin.settings.queryHistory.unshift(historyItem);
                if (this.plugin.settings.queryHistory.length > 50) {
                    this.plugin.settings.queryHistory = this.plugin.settings.queryHistory.slice(0, 50);
                }
                await this.plugin.saveSettings();
                this.renderHistory(this.historySearchInput?.getValue() || '');

                // 不论是否需要音频，先显示文本结果
                processingNotice.hide();
                this.displayQuickTranslationResult(query, finalText, false, "→日", precomputedRomaji);

                // 按"快速翻译"的专属输出位置进行输出（可选）
                try {
                    const { showRomaji } = this.plugin.settings.quickTranslationOptions || { showRomaji: false };
                    const outLoc = await this.outputQuickResult('japanese', query, japaneseTranslation, showRomaji ? precomputedRomaji : undefined);
                    if (outLoc) {
                        historyItem.outputLocation = outLoc;
                        await this.plugin.saveSettings();
                        this.renderHistory(this.historySearchInput?.getValue() || '');
                    }
                } catch (e) {
                    console.error('Quick output (JP) failed:', e);
                }

                // 如果开启了"快速翻译播放音频"开关，则后台生成并播放语音
                if (this.plugin.settings.quickTranslationOptions?.playAudio) {
                    // 异步后台生成并播放
                    window.setTimeout(fire(async () => {
                        try {
                            // 检查TTS配置
                            if (ttsEngine === 'openai' && (!this.plugin.settings.openaiTtsApiKey || !this.plugin.settings.openaiTtsBaseUrl)) return;
                            if (ttsEngine === 'youdao' && (!this.plugin.settings.youdaoAppKey || !this.plugin.settings.youdaoAppSecret)) return;
                            if (ttsEngine === 'gemini' && (!this.plugin.settings.geminiTtsApiKey || !this.plugin.settings.geminiTtsBaseUrl)) return;

                            await this.plugin.playJapaneseVoice(japaneseTranslation ?? '', this.plugin.settings.forceRefreshAudio);
                            new Notice(tr(`🎵 已播放: ${japaneseTranslation}`, `🎵 Played: ${japaneseTranslation}`));
                        } catch (voiceError) {
                            console.error('Voice playback error:', voiceError);
                        }
                    }), 10);
                }
            } else {
                processingNotice.hide();
                this.showFailure(new Error(tr('没有拿到翻译结果', 'No translation came back')), () => { this.queryInput.setValue(query); void this.handleQuickToJapanese(); });
            }
        } catch (error) {
            console.error('Quick to Japanese translation error:', error);
            processingNotice.hide();
            this.showFailure(error, () => { this.queryInput.setValue(query); void this.handleQuickToJapanese(); });
        }

        this.queryInput.setValue('');
    }

    private async displayQuickTranslationFromHistory(item: HistoryItem) {
        try {
            // 显示加载状态
            const loadingNotice = new Notice(tr("🔄 正在加载历史翻译...", "🔄 Loading the earlier translation..."), 0);

            // 重新获取翻译结果
            let translation: string | null = null;
            const translationType = "→汉";

            if (item.type === 'quick_english') {
                translation = await this.plugin.translateText(item.query, { type: 'auto', force: false });
            }

            loadingNotice.hide();

            if (translation) {
                // 在显示区域显示翻译结果
                this.displayQuickTranslationResult(
                    item.query,
                    translation,
                    false, // 历史记录没有语音
                    translationType
                );
            } else {
                new Notice(tr("❌ 无法重新获取翻译结果，请检查API配置", "❌ Could not fetch the translation again; check the AI settings"));
            }
        } catch (error) {
            console.error('History translation display error:', error);
            new Notice(tr(`❌ 显示历史翻译失败：${errorMessage(error) || '未知错误'}`, `❌ Could not show the earlier translation: ${errorMessage(error) || 'unknown error'}`));
        }
    }

    displayQuickTranslationResult(originalText: string, translation: string, voiceSuccess: boolean, translationType: string = "→日", romajiPrefetched?: string) {
        // 清空显示区域
        this.displayContainer.empty();

        // 容器
        const card = this.displayContainer.createDiv({ cls: 'polyglot-quick-result-container' });

        // 顶部标题：显示原文
        const header = card.createDiv({ cls: 'polyglot-quick-result-header' });
        header.createSpan({ text: originalText, cls: 'polyglot-quick-result-title' });

        // 主译文块（更醒目）
        const mainBlock = card.createDiv({ cls: 'polyglot-quick-main' });
        const mainText = mainBlock.createDiv({ cls: 'polyglot-quick-main-text' });
        mainText.setText(translation);

        // 罗马音（仅→日且开启），显示在译文框下方，不带标签
        let romajiText = romajiPrefetched;
        if (translationType === '→日' && (this.plugin.settings.quickTranslationOptions?.showRomaji ?? false) && /[\u3040-\u30FF\u4E00-\u9FFF]/.test(translation)) {
            const romajiRow = card.createDiv({ cls: 'polyglot-quick-romaji-row' });
            const romajiValue = romajiRow.createSpan({ cls: 'polyglot-quick-romaji-text' });
            if (romajiText) {
                romajiValue.setText(romajiText);
            } else {
                void import('./utils').then(({ kanaToRomaji }) => {
                    const r = kanaToRomaji(translation);
                    romajiText = r;
                    romajiValue.setText(r);
                });
            }
        }

        // 取消底部"原文"行

        // 快速操作区
        const actions = card.createDiv({ cls: 'polyglot-actions-row' });
        const compose = () => this.buildQuickMarkdown(
            translationType === '→日' ? 'japanese' : 'chinese',
            originalText,
            translation,
            romajiText
        );
        const bInsert = actions.createEl('button', { cls: 'polyglot-action-btn primary' }); setIcon(bInsert, 'file-plus-2'); bInsert.title = tr('插入到当前文档', 'Insert into the current note'); bInsert.addEventListener('click', () => this.insertToCurrentNote(compose()));
        const bCopy = actions.createEl('button', { cls: 'polyglot-action-btn' }); setIcon(bCopy, 'copy'); bCopy.title = tr('复制结果', 'Copy result'); bCopy.addEventListener('click', () => this.copyToClipboard(compose()));
        const bPlay = actions.createEl('button', { cls: 'polyglot-action-btn' }); setIcon(bPlay, 'volume-2'); bPlay.title = tr('播放语音', 'Play speech'); bPlay.addEventListener('click', fire(async () => { try { await this.plugin.playJapaneseVoice(translation, this.plugin.settings.forceRefreshAudio); } catch (e) { new Notice(tr(`❌ 语音播放失败: ${errorMessage(e)}`, `❌ Could not play the audio: ${errorMessage(e)}`));} }));
        const bNew = actions.createEl('button', { cls: 'polyglot-action-btn secondary' }); setIcon(bNew, 'file-plus'); bNew.title = tr('输出到新笔记', 'Output to a new note'); bNew.addEventListener('click', fire(() => this.createNewNote(compose())));
        const bFixed = actions.createEl('button', { cls: 'polyglot-action-btn secondary' }); setIcon(bFixed, 'file-text'); bFixed.title = tr('输出到固定文件', 'Output to the fixed file'); bFixed.addEventListener('click', fire(() => this.outputToFixedFile(compose())));
        const bClear = actions.createEl('button', { cls: 'polyglot-action-btn danger' }); setIcon(bClear, 'trash-2'); bClear.title = tr('清空结果', 'Clear result'); bClear.addEventListener('click', () => this.clearResults());

        // 移除底部提示行（更简洁）
    }

    private async handleQuickProcess() {
        const query = this.queryInput.getValue().trim();
        if (!query) {
            new Notice(tr("请输入文本。", "Type some text."));
            return;
        }

        // 创建一个持续的处理状态提示
        const processingNotice = new Notice(tr("🔄 正在翻译为中文...", "🔄 Translating into Chinese..."), 0); // 0表示不自动关闭

        try {
            // 检查API配置
            const { englishLlmApiKey, englishLlmBaseUrl } = this.plugin.settings;
            if (!englishLlmApiKey || !englishLlmBaseUrl) {
                processingNotice.hide();
                new Notice(tr("❌ 请先在设置中配置 LLM 的 API 密钥和接口地址", "❌ Add an AI key and endpoint in settings first"));
                return;
            }

            // 自动检测语言并翻译到中文
            const force = !!this.plugin.settings.forceRefresh;
            let chineseTranslation: string | null = null;
            if (!force && this.plugin.manifest.dir) {
                // 先尝试从缓存读取
                const cached = await getFromCache<string>(this.app, this.plugin.manifest.dir, 'english', `quick_${query}`);
                if (cached) chineseTranslation = cached;
            }
            if (!chineseTranslation) {
                chineseTranslation = await this.plugin.translateText(query, { type: 'auto', force: false });
                if (chineseTranslation && this.plugin.manifest.dir) {
                    await saveToCache(this.app, this.plugin.manifest.dir, 'english', `quick_${query}`, chineseTranslation);
                }
            }

            if (chineseTranslation) {
                // 添加到历史记录
                const historyItem: HistoryItem = {
                    query: query,
                    type: 'quick_english',
                    timestamp: Date.now(),
                    sections: {},
                    translation: chineseTranslation
                };
                this.plugin.settings.queryHistory.unshift(historyItem);
                if (this.plugin.settings.queryHistory.length > 50) {
                    this.plugin.settings.queryHistory = this.plugin.settings.queryHistory.slice(0, 50);
                }
                await this.plugin.saveSettings();
                this.renderHistory(this.historySearchInput?.getValue() || '');

                // 处理完成，关闭处理提示，显示成功提示
                processingNotice.hide();
                new Notice(tr(`✅ 翻译完成：${chineseTranslation}`, `✅ Translated: ${chineseTranslation}`));

                // 在显示区域显示翻译结果
                this.displayQuickTranslationResult(query, chineseTranslation, false, "→汉");

                // 按"快速翻译"的专属输出位置进行输出（中文）
                try {
                    const outLoc = await this.outputQuickResult('chinese', query, chineseTranslation);
                    if (outLoc) {
                        historyItem.outputLocation = outLoc;
                        await this.plugin.saveSettings();
                        this.renderHistory(this.historySearchInput?.getValue() || '');
                    }
                } catch (e) {
                    console.error('Quick output (ZH) failed:', e);
                }
            } else {
                processingNotice.hide();
                this.showFailure(new Error(tr('没有拿到翻译结果', 'No translation came back')), () => { this.queryInput.setValue(query); void this.handleQuickProcess(); });
            }
        } catch (error) {
            console.error('Quick English translation error:', error);
            processingNotice.hide();
            this.showFailure(error, () => { this.queryInput.setValue(query); void this.handleQuickProcess(); });
        }

        this.queryInput.setValue('');
    }

    private setupResizer() {
        let startY: number;
        let startHeight: number;

        const startResize = (e: MouseEvent | TouchEvent) => {
            e.preventDefault();
            const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
            startY = clientY;
            startHeight = this.actionsContainer.offsetHeight;
            
            document.documentElement.addEventListener('mousemove', doResize);
            document.documentElement.addEventListener('mouseup', stopResize);
            document.documentElement.addEventListener('touchmove', doResize, { passive: false });
            document.documentElement.addEventListener('touchend', stopResize);
            document.body.classList.add('polyglot-resizing');
        };

        const doResize = (e: MouseEvent | TouchEvent) => {
            e.preventDefault();
            const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
            const newHeight = startHeight + clientY - startY;
            this.actionsContainer.style.flexBasis = `${newHeight}px`;
        };

        const stopResize = () => {
            document.documentElement.removeEventListener('mousemove', doResize);
            document.documentElement.removeEventListener('mouseup', stopResize);
            document.documentElement.removeEventListener('touchmove', doResize);
            document.documentElement.removeEventListener('touchend', stopResize);
            document.body.classList.remove('polyglot-resizing');
        };

        this.resizer.addEventListener('mousedown', startResize);
        this.resizer.addEventListener('touchstart', startResize, { passive: false });
    }

    /**
     * 创建增强的操作按钮 - 单行布局
     */
    private createEnhancedActionButtons(actionBar: HTMLElement, result: string, contentDiv: HTMLElement, historyItem?: HistoryItem): void {
        // 单行操作按钮组
        const actionsRow = actionBar.createDiv('polyglot-actions-row');

        // 插入按钮
        const insertButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn primary' });
        setIcon(insertButton, 'file-plus-2');
        insertButton.setAttribute('aria-label', tr('插入到当前笔记', 'Insert into the current note'));
        insertButton.addEventListener('click', () => this.insertToCurrentNote(result));

        // 复制按钮
        const copyButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn' });
        setIcon(copyButton, 'copy');
        copyButton.setAttribute('aria-label', tr('复制到剪贴板', 'Copy to the clipboard'));
        copyButton.addEventListener('click', () => this.copyToClipboard(result));

        // 语音播放按钮
        const audioButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn' });
        setIcon(audioButton, 'volume-2');
        audioButton.setAttribute('aria-label', tr('朗读内容', 'Read aloud'));
        audioButton.addEventListener('click', fire(() => this.playAudio(contentDiv)));

        // 添加到词汇库按钮
        const addToVocabButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn secondary' });
        setIcon(addToVocabButton, 'bookmark-plus');
        addToVocabButton.setAttribute('aria-label', tr('添加到词汇库', 'Add to word list'));
        addToVocabButton.addEventListener('click', () => void this.addToVocabulary(result, historyItem));

        // 创建新笔记按钮
        const newNoteButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn secondary' });
        setIcon(newNoteButton, 'file-plus');
        newNoteButton.setAttribute('aria-label', tr('创建新笔记', 'Create a new note'));
        newNoteButton.addEventListener('click', fire(() => this.createNewNote(result, historyItem)));

        // 输出到固定文件按钮
        const fixedFileButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn secondary' });
        setIcon(fixedFileButton, 'file-text');
        fixedFileButton.setAttribute('aria-label', tr('输出到固定文件', 'Output to the fixed file'));
        fixedFileButton.addEventListener('click', fire(() => this.outputToFixedFile(result, historyItem)));

        // 清除按钮
        const clearButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn danger' });
        setIcon(clearButton, 'trash-2');
        clearButton.setAttribute('aria-label', tr('清除结果', 'Clear result'));
        clearButton.addEventListener('click', () => this.clearResults());
    }

    /**
     * 插入到当前笔记
     */
    private insertToCurrentNote(result: string): void {
        // 优先使用开始处理时的文件，如果没有则使用最后活跃的文件
        const targetEditor = this.processingStartFile?.editor || this.lastActiveLeaf?.editor;
        const targetFileName = this.processingStartFile?.file?.name || this.lastActiveLeaf?.file?.name || tr('未知文件', 'unknown file');

        if (targetEditor) {
            targetEditor.replaceSelection(result);
            new Notice(tr(`✅ 结果已插入到 ${targetFileName}`, `✅ Inserted into ${targetFileName}`));
            this.clearResults();
        } else {
            new Notice(tr('❌ 无法插入结果，请先点击您想操作的笔记', '❌ Could not insert; click the note you want first'));
        }
    }

    /**
     * 复制到剪贴板
     */
    private copyToClipboard(result: string): void {
        // Obsidian 桌面端和手机端都提供 Clipboard API
        navigator.clipboard.writeText(result)
            .then(() => new Notice(tr('✅ 结果已复制到剪贴板', '✅ Copied to the clipboard')))
            .catch(() => new Notice(tr('❌ 复制失败，请手动复制', '❌ Could not copy; copy it by hand')));
    }

    /**
     * 播放音频
     */
    private async playAudio(contentDiv: HTMLElement): Promise<void> {
        const audioElements = contentDiv.querySelectorAll('audio');
        if (audioElements.length > 0) {
            const audio = audioElements[0];
            
            // 移动端兼容性：尝试播放，如果失败则提示用户
            try {
                await audio.play();
                new Notice(tr('🔊 开始播放音频', '🔊 Playing audio'));
            } catch (playError) {
                console.warn('Audio play failed, might need user interaction:', playError);
                if ('ontouchstart' in window) {
                    new Notice(tr('请在移动端点击音频控件来播放', 'On mobile, tap the audio control to play it'));
                    // 显示音频控件
                    audio.controls = true;
                } else {
                    new Notice(tr('❌ 音频播放失败', '❌ Could not play the audio'));
                }
            }
        } else {
            new Notice(tr('❌ 未找到音频内容', '❌ No audio found'));
        }
    }

    /**
     * 添加到词汇库
     */
    private async addToVocabulary(result: string, historyItem?: HistoryItem, card?: WordCard): Promise<void> {
        const word = (historyItem?.query || this.lastQuery?.text || this.queryInput.getValue()).trim();
        if (!word) {
            new Notice(tr('❌ 无法确定要添加的词汇', '❌ Cannot tell which word to add'));
            return;
        }
        const japanese = historyItem
            ? historyItem.type === 'japanese' || historyItem.type === 'quick_to_japanese'
            : this.lastQuery?.type === 'japanese';

        // Same store as the lookup popover and the review page.
        const settings = this.plugin.settings;
        if (!settings.enableLearningTracker) settings.enableLearningTracker = true;
        // Definition bullets sit inside callouts ("> - ..."); skip the bold field labels.
        const definitions = result.split('\n')
            .map(line => line.replace(/^(\s*>)+/, '').match(/^\s*-\s+(?!\*\*)(.+)/)?.[1]?.replace(/[*_`]/g, '').trim() ?? '')
            .filter(Boolean)
            .slice(0, 3);
        const tracker = this.plugin.learningTracker;
        const { note, examples } = this.collectionContext(card?.headword || word);
        if (card && !japanese) {
            // 词卡已经拆好了词头、音标、词性与释义，直接用
            const senses = card.sections.flatMap(section => section.groups.flatMap(group => group.lines.map(line => line.text))).slice(0, 3);
            await tracker.addEnglishVocabularyItem(card.headword.toLowerCase(), card.gloss || senses[0] || '', card.phonetic, card.pos.join(', '), senses, note, examples, ['查词']);
            new Notice(tr(`已把 "${card.headword}" 加入生词本`, `Added "${card.headword}" to the word list`));
            return;
        }
        if (japanese) {
            await tracker.addJapaneseVocabularyItem(word, word, '', definitions[0] ?? '', note, examples, ['查词']);
        } else {
            await tracker.addEnglishVocabularyItem(word.toLowerCase(), definitions[0] ?? '', '', '', definitions, note, examples, ['查词']);
        }
        new Notice(tr(`✅ "${word}" 已添加到词汇库`, `✅ "${word}" added to the word list`));
    }

    /**
     * 创建新笔记
     */
    private async createNewNote(result: string, historyItem?: HistoryItem): Promise<void> {
        // 优先使用历史记录中的查询词语，如果没有则从输入框获取
        let queryText = '';
        if (historyItem) {
            queryText = historyItem.query.trim();
        } else {
            queryText = this.queryInput.getValue().trim();
        }

        // 如果还是没有，尝试从结果中提取标题
        if (!queryText) {
            const titleMatch = result.match(/^##\s+([^\s-]+)/);
            if (titleMatch) {
                queryText = titleMatch[1];
            }
        }

        // 如果都没有，使用默认名称
        const fileName = queryText || '翻译结果';

        // 根据历史记录类型选择语言特定路径
        let languageSettings = null;
        if (historyItem) {
            if (historyItem.type === 'japanese') {
                languageSettings = this.plugin.settings.japaneseOutputSettings;
            } else if (historyItem.type === 'english') {
                languageSettings = this.plugin.settings.englishOutputSettings;
            } else if (historyItem.type === 'quick_english' || historyItem.type === 'quick_to_japanese') {
                languageSettings = this.plugin.settings.quickTranslationOutputSettings;
            }
        }

        // 使用语言特定路径或全局路径
        const newFileLocation = languageSettings?.newFileLocation || this.plugin.settings.newFileLocation;
        const fullPath = newFileLocation ? `${newFileLocation}${fileName}.md` : `${fileName}.md`;

        try {
            const file = await this.app.vault.create(fullPath, result);
            await this.app.workspace.getLeaf().openFile(file);
            new Notice(tr(`✅ 已创建新笔记: ${fileName}`, `✅ Created a new note: ${fileName}`));
        } catch {
            new Notice(tr('❌ 创建笔记失败', '❌ Could not create the note'));
        }
    }

    /**
     * 输出到固定文件
     */
    private async outputToFixedFile(result: string, historyItem?: HistoryItem): Promise<void> {
        // 根据历史记录类型选择语言特定路径
        let languageSettings = null;
        if (historyItem) {
            if (historyItem.type === 'japanese') {
                languageSettings = this.plugin.settings.japaneseOutputSettings;
            } else if (historyItem.type === 'english') {
                languageSettings = this.plugin.settings.englishOutputSettings;
            } else if (historyItem.type === 'quick_english' || historyItem.type === 'quick_to_japanese') {
                languageSettings = this.plugin.settings.quickTranslationOutputSettings;
            }
        }

        // 使用语言特定路径或全局路径
        const fixedOutputFile = languageSettings?.fixedOutputFile || this.plugin.settings.fixedOutputFile;
        
        if (!fixedOutputFile) {
            new Notice(tr("错误：未设置固定输出文件路径。请在设置中配置。", "Error: no fixed output file is set. Set one in settings."));
            return;
        }

        const fixedFile = this.app.vault.getAbstractFileByPath(fixedOutputFile);
        if (fixedFile instanceof TFile) {
            // 文件存在，追加内容
            const timestamp = new Date().toLocaleString('zh-CN');
            const content = `\n\n---\n**${timestamp}**\n\n${result}\n\n\n`;
            await this.app.vault.append(fixedFile, content);
            new Notice(tr(`结果已追加到固定文件: ${fixedFile.name}`, `Appended to the fixed file: ${fixedFile.name}`));
        } else {
            // 文件不存在，创建文件
            try {
                const timestamp = new Date().toLocaleString('zh-CN');
                const content = `# 翻译记录\n\n**${timestamp}**\n\n${result}\n\n\n`;

                // 确保目录存在
                const folderPath = fixedOutputFile.substring(0, fixedOutputFile.lastIndexOf('/'));
                if (folderPath && !await this.app.vault.adapter.exists(folderPath)) {
                    await this.app.vault.createFolder(folderPath);
                }

                const newFile = await this.app.vault.create(fixedOutputFile, content);
                new Notice(tr(`固定文件已创建并保存结果: ${newFile.name}`, `Created the fixed file and saved the result: ${newFile.name}`));
            } catch (e) {
                new Notice(tr(`创建固定文件失败: ${errorMessage(e)}`, `Could not create the fixed file: ${errorMessage(e)}`));
            }
        }
    }

    /**
     * 清除结果
     */
    private clearResults(): void {
        this.displayContainer.empty();
        this.displayContainer.removeClass('polyglot-results-active');
    }

    private showJapaneseOptionsPanel(event: MouseEvent): void {
        // 移除已存在的面板
        const existingPanel = document.querySelector('.polyglot-options-panel');
        if (existingPanel) {
            existingPanel.remove();
            return; // 如果面板已存在，点击就关闭它
        }

        const sections = this.plugin.settings.japaneseSections;
        if (!sections) {
            new Notice(tr("错误：找不到日语设置。", "Error: Japanese settings not found."));
            return;
        }

        // 创建自定义面板
        const panel = document.body.createDiv('polyglot-options-panel');

        // 设置面板位置
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        panel.addClasses(['polyglot-floating-panel', 'ap', 'ap-glass']);
        panel.setCssStyles({ left: `${rect.left}px`, top: `${rect.bottom + 5}px` });

        const sectionNames: Record<keyof typeof sections, string> = {
            vocabAnalysis: tr('词汇分析', 'Vocabulary analysis'),
            relatedVocab: tr('相关词汇解析', 'Related vocabulary'),
            sentences: tr('例句生成', 'Example sentences'),
            exercise: tr('翻译练习', 'Translation exercise'),
            jisho: tr('Jisho 词典', 'Jisho dictionary')
        };

        // 过滤掉不在 sectionNames 中的键
        const validSections = Object.keys(sections).filter(key => key in sectionNames);

        validSections.forEach(key => {
            const typedKey = key as keyof typeof sections;
            const sectionName = sectionNames[typedKey];

            const item = panel.createDiv('polyglot-option-item');

            const checkbox = item.createEl('input', { type: 'checkbox' });
            checkbox.checked = sections[typedKey];

            item.createSpan({ text: sectionName });

            // 点击切换
            item.addEventListener('click', fire(async (e) => {
                e.stopPropagation();
                sections[typedKey] = !sections[typedKey];
                checkbox.checked = sections[typedKey];
                await this.plugin.saveSettings();
            }));
        });

        // 语音生成开关
        const sep = panel.createDiv(); sep.createEl('hr');
        const voiceItem = panel.createDiv('polyglot-option-item');

        const voiceCheckbox = voiceItem.createEl('input', { type: 'checkbox' });
        voiceCheckbox.checked = !this.plugin.settings.disableJapaneseVoiceDuringAnalysis;
        voiceItem.createSpan({ text: tr('生成语音', 'Generate speech') });

        voiceItem.addEventListener('click', fire(async (e) => {
            e.stopPropagation();
            voiceCheckbox.checked = !voiceCheckbox.checked;
            this.plugin.settings.disableJapaneseVoiceDuringAnalysis = !voiceCheckbox.checked;
            await this.plugin.saveSettings();
        }));

        // 点击外部关闭面板
        const closePanel = (e: MouseEvent) => {
            if (!panel.contains(e.target as Node)) {
                panel.remove();
                document.removeEventListener('click', closePanel);
            }
        };

        // 延迟添加事件监听器，避免立即触发
        window.setTimeout(() => {
            document.addEventListener('click', closePanel);
        }, 100);
    }

    private showEnglishOptionsPanel(event: MouseEvent): void {
        // 移除已存在的面板
        const existingPanel = document.querySelector('.polyglot-options-panel');
        if (existingPanel) {
            existingPanel.remove();
            return; // 如果面板已存在，点击就关闭它
        }

        const sections = this.plugin.settings.englishSections;

        // 创建自定义面板
        const panel = document.body.createDiv('polyglot-options-panel');

        // 设置面板位置
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        panel.addClasses(['polyglot-floating-panel', 'ap', 'ap-glass']);
        panel.setCssStyles({ left: `${rect.left}px`, top: `${rect.bottom + 5}px` });

        const sectionNames: Record<keyof typeof sections, string> = {
            definitions: tr('词典释义', 'Dictionary'),
            example: tr('例句', 'Examples'),
            usage: tr('用法助记', 'Usage and memory aid'),
            etymology: tr('词源', 'Etymology'),
            medical: tr('医学专用', 'Medical'),
            slang: tr('俚语', 'Slang'),
            tatoeba: tr('Tatoeba 例句', 'Tatoeba examples'),
            idioms: tr('相关习语', 'Related idioms')
        };

        (Object.keys(sections) as Array<keyof typeof sections>).forEach(key => {
            const sectionName = sectionNames[key];

            const item = panel.createDiv('polyglot-option-item');

            const checkbox = item.createEl('input', { type: 'checkbox' });
            checkbox.checked = sections[key];

            item.createSpan({ text: sectionName });

            // 点击切换
            item.addEventListener('click', fire(async (e) => {
                e.stopPropagation();
                sections[key] = !sections[key];
                checkbox.checked = sections[key];
                await this.plugin.saveSettings();
            }));
        });



        // 点击外部关闭面板
        const closePanel = (e: MouseEvent) => {
            if (!panel.contains(e.target as Node)) {
                panel.remove();
                document.removeEventListener('click', closePanel);
            }
        };

        // 延迟添加事件监听器，避免立即触发
        window.setTimeout(() => {
            document.addEventListener('click', closePanel);
        }, 100);
    }

    // 快捷翻译的小菜单：罗马音开关、播放音频开关
    private showQuickOptionsPanel(event: MouseEvent): void {
        const existingPanel = document.querySelector('.polyglot-options-panel');
        if (existingPanel) { existingPanel.remove(); return; }

        this.plugin.settings.quickTranslationOptions = this.plugin.settings.quickTranslationOptions || { showRomaji: false, playAudio: true, outputDestination: 'sidebar' };
        const opts = this.plugin.settings.quickTranslationOptions;

        const panel = document.body.createDiv('polyglot-options-panel');
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        panel.addClasses(['polyglot-floating-panel', 'ap', 'ap-glass']);
        panel.setCssStyles({ left: `${rect.left}px`, top: `${rect.bottom + 5}px` });

        const entries: Array<{ key: 'showRomaji' | 'playAudio'; label: string; }> = [
            { key: 'showRomaji', label: tr('罗马音标注', 'Romaji') },
            { key: 'playAudio', label: tr('播放音频', 'Play audio') }
        ];

        entries.forEach(({ key, label }) => {
            const item = panel.createDiv('polyglot-option-item');

            const checkbox = item.createEl('input', { type: 'checkbox' });
            // @ts-ignore
            checkbox.checked = opts[key] ?? false;

            item.createSpan({ text: label });


            item.addEventListener('click', fire(async (e) => {
                e.stopPropagation();
                // @ts-ignore
                opts[key] = !opts[key];
                // @ts-ignore
                checkbox.checked = opts[key];
                await this.plugin.saveSettings();
            }));
        });

        const closePanel = (e: MouseEvent) => {
            if (!panel.contains(e.target as Node)) {
                panel.remove();
                document.removeEventListener('click', closePanel);
            }
        };
        window.setTimeout(() => document.addEventListener('click', closePanel), 100);
    }



    /**
     * 更新最后活动文件的记录
     */
    private updateLastActiveFile(): void {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            this.lastActiveFile = activeFile;
        }
    }

    /**
     * 智能获取目标文件
     * 优先使用当前活动文件，如果没有则使用最后记录的活动文件
     */
    private getTargetFile(): TFile | null {
        // 首先尝试获取当前活动文件
        const currentActiveFile = this.app.workspace.activeEditor?.file;
        if (currentActiveFile) {
            this.lastActiveFile = currentActiveFile; // 更新记录
            return currentActiveFile;
        }

        // 如果没有当前活动文件，使用最后记录的文件
        return this.lastActiveFile;
    }

    /**
     * 处理语音合成
     */
    private async handleVoiceSynthesis(): Promise<void> {
        const query = this.queryInput.getValue().trim();
        if (!query) {
            new Notice(tr("请先输入要合成语音的文本。", "Type the text to synthesise first."));
            return;
        }

        try {
            new Notice(tr("🎵 正在生成语音...", "🎵 Generating speech..."));
            // 使用TTS API直接播放
            await this.plugin.playJapaneseVoice(query, this.plugin.settings.forceRefreshAudio);
        } catch (error) {
            new Notice(tr(`语音合成失败: ${errorMessage(error)}`, `Speech failed: ${errorMessage(error)}`));
            this.plugin.logger.error("语音合成失败", error);
        }
    }

    /**
     * 显示设置面板
     */
    /** 语音选项浮层，贴着 anchor 下方打开。 */
    private showSettingsPanel(anchor: HTMLElement): void {
        const panel = createDiv();
        panel.className = 'polyglot-settings-panel';

        // 计算位置
        const rect = anchor.getBoundingClientRect();
        panel.addClasses(['polyglot-floating-panel', 'polyglot-fade', 'ap', 'ap-glass']);
        panel.setCssStyles({ top: `${rect.bottom + 8}px`, left: `${Math.max(10, Math.min(rect.left - 100, window.innerWidth - 300))}px` }); // 防止超出屏幕

        // 添加面板标题
        const header = panel.createDiv({ cls: 'polyglot-settings-header' });
        header.createSpan({ text: tr('语音', 'Speech'), cls: 'polyglot-settings-title' });

        // TTS引擎选择
        const ttsSection = panel.createDiv({ cls: 'polyglot-settings-section' });
        ttsSection.createEl('label', { text: tr('引擎', 'Engine'), cls: 'polyglot-settings-label' });
        const ttsSelect = ttsSection.createEl('select', { cls: 'polyglot-settings-select' });
        for (const [value, label] of [['openai', '🤖 OpenAI'], ['youdao', '📚 有道'], ['gemini', '💎 Gemini']]) {
            ttsSelect.createEl('option', { value, text: label });
        }
        ttsSelect.value = this.plugin.settings.ttsEngine;
        ttsSelect.addEventListener('change', fire(async () => {
            this.plugin.settings.ttsEngine = ttsSelect.value as 'openai' | 'youdao' | 'gemini';
            await this.plugin.saveSettings();
            // 重新渲染面板以显示/隐藏语音选择
            panel.remove();
            this.showSettingsPanel(anchor);
        }));

        // 语音速度
        const speedSection = panel.createDiv({ cls: 'polyglot-settings-section' });
        const speedHeader = speedSection.createDiv({ cls: 'polyglot-settings-speed-header' });
        speedHeader.createEl('label', { text: tr('速度', 'Speed'), cls: 'polyglot-settings-label' });
        const speedValue = speedHeader.createSpan({
            text: `${this.plugin.settings.openaiTtsSpeed || 1.0}x`,
            cls: 'polyglot-settings-value'
        });

        const speedSlider = speedSection.createEl('input', {
            type: 'range',
            cls: 'polyglot-settings-slider'
        });
        speedSlider.min = '0.5';
        speedSlider.max = '2.0';
        speedSlider.step = '0.1';
        speedSlider.value = this.plugin.settings.openaiTtsSpeed?.toString() || '1.0';

        speedSlider.addEventListener('input', fire(async () => {
            const speed = parseFloat(speedSlider.value);
            this.plugin.settings.openaiTtsSpeed = speed;
            speedValue.textContent = `${speed}x`;
            await this.plugin.saveSettings();
        }));

        // 语音选择（OpenAI和Gemini）
        if (this.plugin.settings.ttsEngine === 'openai') {
            const voiceSection = panel.createDiv({ cls: 'polyglot-settings-section' });
            voiceSection.createEl('label', { text: tr('声音', 'Voice'), cls: 'polyglot-settings-label' });
            const voiceSelect = voiceSection.createEl('select', { cls: 'polyglot-settings-select' });
            for (const [value, label] of [
                ['alloy', '🎭 Alloy'], ['echo', '🔊 Echo'], ['fable', '📖 Fable'],
                ['onyx', '💎 Onyx'], ['nova', '⭐ Nova'], ['shimmer', '✨ Shimmer'],
            ]) {
                voiceSelect.createEl('option', { value, text: label });
            }
            voiceSelect.value = this.plugin.settings.openaiTtsVoice ?? 'alloy';
            voiceSelect.addEventListener('change', fire(async () => {
                this.plugin.settings.openaiTtsVoice = voiceSelect.value;
                await this.plugin.saveSettings();
            }));
        } else if (this.plugin.settings.ttsEngine === 'gemini') {
            const voiceSection = panel.createDiv({ cls: 'polyglot-settings-section' });
            voiceSection.createEl('label', { text: tr('声音', 'Voice'), cls: 'polyglot-settings-label' });
            const voiceSelect = voiceSection.createEl('select', { cls: 'polyglot-settings-select' });

            // Gemini TTS 完整语音选项（与设置页面保持一致）
            const geminiVoices = [
                { value: 'Zephyr', label: tr('Zephyr (明亮)', 'Zephyr (bright)') },
                { value: 'Puck', label: tr('Puck (欢快)', 'Puck (upbeat)') },
                { value: 'Charon', label: tr('Charon (信息丰富)', 'Charon (informative)') },
                { value: 'Kore', label: tr('Kore (坚定)', 'Kore (firm)') },
                { value: 'Fenrir', label: tr('Fenrir (易激动)', 'Fenrir (excitable)') },
                { value: 'Leda', label: tr('Leda (年轻)', 'Leda (youthful)') },
                { value: 'Orus', label: tr('Orus (坚定)', 'Orus (firm)') },
                { value: 'Aoede', label: tr('Aoede (轻松)', 'Aoede (breezy)') },
                { value: 'Callirhoe', label: tr('Callirhoe (随和)', 'Callirhoe (easy-going)') },
                { value: 'Autonoe', label: tr('Autonoe (明亮)', 'Autonoe (bright)') },
                { value: 'Enceladus', label: tr('Enceladus (呼吸感)', 'Enceladus (breathy)') },
                { value: 'Iapetus', label: tr('Iapetus (清晰)', 'Iapetus (clear)') },
                { value: 'Umbriel', label: tr('Umbriel (随和)', 'Umbriel (easy-going)') },
                { value: 'Algieba', label: tr('Algieba (平滑)', 'Algieba (smooth)') },
                { value: 'Despina', label: tr('Despina (平滑)', 'Despina (smooth)') },
                { value: 'Erinome', label: tr('Erinome (清晰)', 'Erinome (clear)') },
                { value: 'Algenib', label: tr('Algenib (沙哑)', 'Algenib (gravelly)') },
                { value: 'Rasalgethi', label: tr('Rasalgethi (信息丰富)', 'Rasalgethi (informative)') },
                { value: 'Laomedeia', label: tr('Laomedeia (欢快)', 'Laomedeia (upbeat)') },
                { value: 'Achernar', label: tr('Achernar (轻柔)', 'Achernar (soft)') },
                { value: 'Alnilam', label: tr('Alnilam (坚定)', 'Alnilam (firm)') },
                { value: 'Schedar', label: tr('Schedar (平稳)', 'Schedar (even)') },
                { value: 'Gacrux', label: tr('Gacrux (成熟)', 'Gacrux (mature)') },
                { value: 'Pulcherrima', label: tr('Pulcherrima (向前)', 'Pulcherrima (forward)') },
                { value: 'Achird', label: tr('Achird (友好)', 'Achird (friendly)') },
                { value: 'Zubenelgenubi', label: tr('Zubenelgenubi (休闲)', 'Zubenelgenubi (casual)') },
                { value: 'Vindematrix', label: tr('Vindematrix (温柔)', 'Vindematrix (gentle)') },
                { value: 'Sadachbia', label: tr('Sadachbia (活泼)', 'Sadachbia (lively)') },
                { value: 'Sadaltager', label: tr('Sadaltager (博学)', 'Sadaltager (knowledgeable)') },
                { value: 'Sulafat', label: tr('Sulafat (温暖)', 'Sulafat (warm)') }
            ];

            for (const voice of geminiVoices) {
                voiceSelect.createEl('option', { value: voice.value, text: voice.label });
            }
            voiceSelect.value = this.plugin.settings.geminiTtsVoice ?? 'Zephyr';

            voiceSelect.addEventListener('change', fire(async () => {
                this.plugin.settings.geminiTtsVoice = voiceSelect.value;
                await this.plugin.saveSettings();
            }));
        }

        // 强制刷新音频选项
        const refreshSection = panel.createDiv({ cls: 'polyglot-settings-section' });
        refreshSection.createEl('label', { text: tr('音频缓存', 'Audio cache'), cls: 'polyglot-settings-label' });

        const refreshContainer = refreshSection.createDiv({ cls: 'polyglot-settings-refresh-container' });

        // 强制刷新复选框
        const refreshCheckbox = refreshContainer.createEl('input', { type: 'checkbox' });
        refreshCheckbox.id = 'polyglot-force-refresh-audio';
        refreshCheckbox.checked = this.plugin.settings.forceRefreshAudio || false;

        const refreshLabel = refreshContainer.createEl('label');
        refreshLabel.setAttribute('for', 'polyglot-force-refresh-audio');
        refreshLabel.textContent = tr('🔄 强制刷新音频', '🔄 Regenerate audio');

        refreshCheckbox.addEventListener('change', fire(async () => {
            this.plugin.settings.forceRefreshAudio = refreshCheckbox.checked;
            await this.plugin.saveSettings();
        }));

        document.body.appendChild(panel);

        // 添加动画效果：.polyglot-fade 默认透明，加 is-open 后淡入
        window.requestAnimationFrame(() => panel.addClass('is-open'));

        // 点击外部关闭面板
        const closePanel = (e: MouseEvent) => {
            if (!panel.contains(e.target as Node)) {
                panel.removeClass('is-open');
                window.setTimeout(() => panel.remove(), 200);
                document.removeEventListener('click', closePanel);
            }
        };

        // 延迟添加事件监听器，避免立即触发
        window.setTimeout(() => {
            document.addEventListener('click', closePanel);
        }, 100);
    }

    /**
     * 跳转到输出位置
     */
    private async jumpToOutputLocation(): Promise<void> {
        // 兼容旧入口：跳转到最近一次的输出位置
        const history = this.plugin.settings.queryHistory || [];
        const last = history.find(h => h.outputLocation && h.outputLocation.destination !== 'sidebar');
        if (last) {
            await this.jumpToHistoryItemLocation(last);
            return;
        }
        const outputDestination = this.plugin.settings.outputDestination;
        let targetFile: TFile | null = null;

        if (outputDestination === 'sidebar') {
            new Notice(tr("已在侧边栏显示", "Shown in the side panel"));
            return;
        } else if (outputDestination === 'replace') {
            const activeEditor = this.app.workspace.activeEditor;
            targetFile = activeEditor?.file || null;
            if (!targetFile) {
                new Notice(tr("❌ 当前无打开文件", "❌ No file is open"));
                return;
            }
        } else if (outputDestination === 'appendCurrent') {
            const activeEditor = this.app.workspace.activeEditor;
            targetFile = activeEditor?.file || null;
            if (!targetFile) {
                new Notice(tr("❌ 当前无打开文件", "❌ No file is open"));
                return;
            }
        } else if (outputDestination === 'newFile') {
            // 尝试根据当前输入内容判断语言类型，使用相应的语言特定路径
            const queryText = this.queryInput.getValue().trim();
            let newFileLocation = this.plugin.settings.newFileLocation;
            
            // 简单判断语言类型（可以根据需要扩展）
            if (queryText) {
                const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(queryText);
                const isEnglish = /^[a-zA-Z\s]+$/.test(queryText);
                
                if (isJapanese && this.plugin.settings.japaneseOutputSettings.newFileLocation) {
                    newFileLocation = this.plugin.settings.japaneseOutputSettings.newFileLocation;
                } else if (isEnglish && this.plugin.settings.englishOutputSettings.newFileLocation) {
                    newFileLocation = this.plugin.settings.englishOutputSettings.newFileLocation;
                }
            }
            
            const fileName = queryText ? `${queryText} - 翻译结果` : '翻译结果';
            const fullPath = newFileLocation ? `${newFileLocation}${fileName}.md` : `${fileName}.md`;
            
            try {
                // 确保目录存在
                if (newFileLocation) {
                    const folderPath = newFileLocation.replace(/\/$/, '');
                    if (!await this.app.vault.adapter.exists(folderPath)) {
                        await this.app.vault.createFolder(folderPath);
                    }
                }
                
                const file = await this.app.vault.create(fullPath, '');
                targetFile = file;
                await this.app.workspace.getLeaf().openFile(file);
                new Notice(tr('✅ 已创建新文件', '✅ Created a new file'));
            } catch {
                new Notice(tr('❌ 创建失败', '❌ Could not create it'));
                return;
            }
        } else if (outputDestination === 'fixedFile') {
            // 尝试根据当前输入内容判断语言类型，使用相应的语言特定路径
            const queryText = this.queryInput.getValue().trim();
            let fixedOutputFile = this.plugin.settings.fixedOutputFile;
            
            if (queryText) {
                const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(queryText);
                const isEnglish = /^[a-zA-Z\s]+$/.test(queryText);
                
                if (isJapanese && this.plugin.settings.japaneseOutputSettings.fixedOutputFile) {
                    fixedOutputFile = this.plugin.settings.japaneseOutputSettings.fixedOutputFile;
                } else if (isEnglish && this.plugin.settings.englishOutputSettings.fixedOutputFile) {
                    fixedOutputFile = this.plugin.settings.englishOutputSettings.fixedOutputFile;
                }
            }
            
            if (!fixedOutputFile) {
                new Notice(tr('❌ 未设置固定文件', '❌ No fixed file is set'));
                return;
            }
            
            const abstractFile = this.app.vault.getAbstractFileByPath(fixedOutputFile);
            if (abstractFile instanceof TFile) {
                targetFile = abstractFile;
                await this.app.workspace.getLeaf().openFile(targetFile);
                new Notice(tr('✅ 已跳转', '✅ Opened'));
            } else {
                new Notice(tr('❌ 找不到固定文件', '❌ Fixed file not found'));
            }
            return;
        }

        if (targetFile) {
            await this.app.workspace.getLeaf().openFile(targetFile);
            new Notice(tr('✅ 已跳转', '✅ Opened'));
        }
    }

    /**
     * 跳转到上一次的输出位置（忽略侧边栏记录）
     */
    private async jumpToLastOutputLocation(): Promise<void> {
        const history = this.plugin.settings.queryHistory || [];
        const last = history.find(h => h.outputLocation && h.outputLocation.destination !== 'sidebar');
        if (!last) { new Notice(tr('没有可用的输出位置记录', 'No output location recorded')); return; }
        await this.jumpToHistoryItemLocation(last);
    }

    /**
     * 跳转到查询记录的输出位置
     */
    private async jumpToHistoryItemLocation(item: HistoryItem): Promise<void> {
        if (!item.outputLocation) {
            new Notice(tr('❌ 无输出位置信息', '❌ No output location'));
            return;
        }

        const { destination, filePath, heading } = item.outputLocation;
        let targetFile: TFile | null = null;

        if (destination === 'sidebar') {
            new Notice(tr('已在侧边栏显示', 'Shown in the side panel'));
            return;
        } else if (destination === 'replace' || destination === 'appendCurrent') {
            if (filePath) {
                targetFile = asTFile(this.app.vault.getAbstractFileByPath(filePath));
                if (!targetFile) {
                    new Notice(tr('❌ 找不到文件', '❌ File not found'));
                    return;
                }
            } else {
                new Notice(tr('❌ 记录无文件路径', '❌ The record has no file path'));
                return;
            }
        } else if (destination === 'newFile') {
            if (filePath) {
                targetFile = asTFile(this.app.vault.getAbstractFileByPath(filePath));
                if (!targetFile) {
                    new Notice(tr('❌ 找不到新文件', '❌ New file not found'));
                    return;
                }
            } else {
                new Notice(tr('❌ 记录无新文件路径', '❌ The record has no new file path'));
                return;
            }
        } else if (destination === 'fixedFile') {
            if (filePath) {
                targetFile = asTFile(this.app.vault.getAbstractFileByPath(filePath));
                if (!targetFile) {
                    new Notice(tr('❌ 找不到固定文件', '❌ Fixed file not found'));
                    return;
                }
            } else {
                new Notice(tr('❌ 记录无固定文件路径', '❌ The record has no fixed file path'));
                return;
            }
        }

        if (targetFile) {
            // 打开文件
            const leaf = this.app.workspace.getLeaf();
            await leaf.openFile(targetFile);
            
            // 如果有标题信息，尝试定位到具体位置
            if (heading) {
                try {
                    // 等待文件加载完成
                    await new Promise(resolve => window.setTimeout(resolve, 100));
                    
                    // 获取文件内容
                    const content = await this.app.vault.read(targetFile);
                    const lines = content.split('\n');
                    
                    // 查找标题行：优先匹配"## 原文 …"行
                    const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const patterns = [
                        new RegExp(`^##\\s+${esc}(?:\\s+-\\s+.*)?\\s*$`),
                        new RegExp(`^###\\s+${esc}(?:\\s+-\\s+.*)?\\s*$`),
                        new RegExp(`^#\\s+${esc}(?:\\s+-\\s+.*)?\\s*$`),
                    ];
                    let targetLine = -1;
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        if (patterns.some(p => p.test(line)) || (line.trim().startsWith('### ') && line.includes(heading))) {
                            targetLine = i; break;
                        }
                    }
                    
                    if (targetLine !== -1) {
                        // 定位到标题行
                        const view = leaf.view;
                        if (view instanceof MarkdownView) {
                            const editor = view.editor;
                            if (editor) {
                                editor.setCursor({ line: targetLine, ch: 0 });
                                editor.scrollIntoView({ from: { line: targetLine, ch: 0 }, to: { line: targetLine, ch: 0 } }, true);
                                new Notice(tr('✅ 已定位', '✅ Found it'));
                                return;
                            }
                        }
                    }
                } catch (error) {
                    console.error('定位到标题失败:', error);
                }
            }
            
            // 如果没有标题信息或定位失败，只跳转到文件
            new Notice(tr('✅ 已跳转', '✅ Opened'));
        }
    }

    /**
     * 设置选词模式监听器
     */
    private setupWordSelectionMode(): void {
        let lastSelection = '';
        let lastClipboardText = '';
        let selectionTimeout: number | null = null;
        let clipboardCheckInterval: number | null = null;

        // 添加文本到输入框的通用方法
        const addTextToInput = (text: string) => {
            if (!text || text.trim().length === 0) {
                return;
            }

            const trimmedText = text.trim();
            
            // 防止重复添加相同的文本（检查是否已经在输入框中）
            const currentValue = this.queryInput.getValue();
            const lines = currentValue.split('\n').map(line => line.trim());
            
            if (lines.includes(trimmedText)) {
                return; // 已经存在，不重复添加
            }

            // 将选中的文本添加到输入框
            // 如果输入框为空，直接设置；否则追加，用换行符分隔
            if (currentValue.trim() === '') {
                this.queryInput.setValue(trimmedText);
            } else {
                // 追加到现有内容，用换行符分隔
                this.queryInput.setValue(currentValue + '\n' + trimmedText);
            }
        };

        // 处理选中的文本（支持编辑模式和阅读模式）
        const handleSelection = () => {
            if (!this.plugin.settings.wordSelectionMode) {
                return; // 选词模式未开启
            }

            let selection: string | null = null;

            // 首先尝试从编辑器获取选择（编辑模式）
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                const editor = activeView.editor;
                selection = editor.getSelection()?.trim() || null;
            }

            // 如果没有从编辑器获取到，尝试从全局选择获取（阅读模式）
            if (!selection || selection.length === 0) {
                const globalSelection = window.getSelection();
                if (globalSelection && globalSelection.toString().trim().length > 0) {
                    selection = globalSelection.toString().trim();
                }
            }

            if (!selection || selection.length === 0) {
                lastSelection = '';
                return; // 没有选中文本
            }

            // 如果和上次选择相同，不重复添加
            if (selection === lastSelection) {
                return;
            }

            // 使用防抖，避免频繁触发
            if (selectionTimeout) {
                window.clearTimeout(selectionTimeout);
            }

            selectionTimeout = window.setTimeout(() => {
                if (selection) {
                    addTextToInput(selection);
                    lastSelection = selection;
                }
            }, 300); // 300ms防抖，给用户足够时间完成选择
        };

        // 监听鼠标释放事件（主要方式，捕获鼠标选择）
        const handleMouseUp = (event: MouseEvent) => {
            if (!this.plugin.settings.wordSelectionMode) {
                return;
            }
            
            // 检查点击是否在编辑器或预览区域内
            const target = event.target as HTMLElement;
            const isInEditor = target.closest('.markdown-source-view, .markdown-preview-view, .cm-editor, .markdown-preview-section');
            
            if (!isInEditor) {
                return; // 不在编辑器或预览区域内，忽略
            }

            // 延迟一点执行，确保选择已经完成
            window.setTimeout(handleSelection, 150);
        };

        // 剪贴板监听功能
        const checkClipboard = async () => {
            if (!this.plugin.settings.wordSelectionMode) {
                return;
            }

            try {
                const clipboardText = await navigator.clipboard.readText();
                
                // 如果剪贴板内容发生变化且不为空
                if (clipboardText && clipboardText.trim().length > 0 && clipboardText !== lastClipboardText) {
                    // 检查是否是用户主动复制的（通过检查是否有选中的文本）
                    // 如果剪贴板内容与当前选择不同，可能是用户复制的新内容
                    const currentSelection = window.getSelection()?.toString() || '';
                    if (clipboardText !== currentSelection) {
                        // 延迟一点，避免与选择事件冲突
                        window.setTimeout(() => {
                            addTextToInput(clipboardText);
                            lastClipboardText = clipboardText;
                        }, 200);
                    }
                }
            } catch {
                // 剪贴板访问可能被拒绝，忽略错误
                // console.debug('Clipboard access denied or failed:', error);
            }
        };

        // 监听复制事件（Ctrl+C / Cmd+C）
        const handleCopy = (event: ClipboardEvent) => {
            if (!this.plugin.settings.wordSelectionMode) {
                return;
            }

            // 延迟检查剪贴板，确保内容已更新
            window.setTimeout(() => {
                void checkClipboard();
            }, 100);
        };

        // 在文档级别监听鼠标释放事件
        document.addEventListener('mouseup', handleMouseUp);
        
        // 监听复制事件
        document.addEventListener('copy', handleCopy);
        
        // 定期检查剪贴板（作为补充，用于阅读模式）
        if (this.plugin.settings.wordSelectionMode) {
            clipboardCheckInterval = window.setInterval(() => {
                void checkClipboard();
            }, 1000); // 每秒检查一次剪贴板
        }
        
        // 监听活动文件变化，重置状态
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                lastSelection = ''; // 重置，允许在新文件中重新选择
            })
        );

        // 监听设置变化，动态开启/关闭剪贴板检查
        this.registerEvent(
            // @ts-ignore
            this.app.workspace.on('polyglot-settings-change', () => {
                if (this.plugin.settings.wordSelectionMode) {
                    if (!clipboardCheckInterval) {
                        clipboardCheckInterval = window.setInterval(() => {
                            void checkClipboard();
                        }, 1000);
                    }
                } else {
                    if (clipboardCheckInterval) {
                        window.clearInterval(clipboardCheckInterval);
                        clipboardCheckInterval = null;
                    }
                }
            })
        );
        
        // 清理函数
        this.register(() => {
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('copy', handleCopy);
            if (selectionTimeout) {
                window.clearTimeout(selectionTimeout);
            }
            if (clipboardCheckInterval) {
                window.clearInterval(clipboardCheckInterval);
            }
        });
    }
}



function sampleNote(): string {
    return [
        '---',
        'polyglot_demo: true',
        '---',
        tr('> [!info] 这是语言助手的演示笔记，可以直接删除。', '> [!info] This is a Polyglot Helper demo note. Delete it whenever you like.'),
        tr('> 选中下面任意一个词或句子，再点侧栏的“查询”。', '> Select any word or sentence below, then press Look up in the side panel.'),
        '',
        '## English',
        '',
        'The committee decided to postpone the vote until the figures are reliable.',
        '',
        '## 日本語',
        '',
        '雨が降りそうなので、傘を持っていきます。',
        '',
    ].join('\n');
}
