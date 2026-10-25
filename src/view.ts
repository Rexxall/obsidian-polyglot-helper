import { ItemView, WorkspaceLeaf, Notice, TextAreaComponent, Editor, ToggleComponent, MarkdownRenderer, MarkdownView, TextComponent, DropdownComponent, setIcon, TFile } from "obsidian";
import PolyglotHelper from "./main";
import { HistoryItem } from "./types";
import { getFromCache, saveToCache } from './cache';
import { ReviewSession, sourceNote } from './review-session';

export const POLYGLOT_HELPER_VIEW_TYPE = "polyglot-helper-view";

export class PolyglotHelperView extends ItemView {
    plugin: PolyglotHelper;
    private queryInput: TextAreaComponent;
    private actionsContainer: HTMLDivElement;
    private actionsContent: HTMLDivElement;
    private displayContainer: HTMLDivElement;
    private historySearchInput: TextComponent;
    private lastActiveLeaf: MarkdownView | null = null;
    private resizer: HTMLDivElement;
    private processingStartFile: any = null; // 记录开始处理时的活跃文件
    private lastActiveFile: TFile | null = null; // 记录最后的活动文件
    private activeMode: 'japanese' | 'english' | 'quick_to_japanese' | 'quick_english' = 'quick_to_japanese';
    private modeButtons: { japBtn?: HTMLButtonElement; engBtn?: HTMLButtonElement; quickJpBtn?: HTMLButtonElement; quickZhBtn?: HTMLButtonElement } = {};
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
        const { japBtn, engBtn, quickJpBtn, quickZhBtn } = this.modeButtons;
        [japBtn, engBtn, quickJpBtn, quickZhBtn].forEach(btn => btn && btn.removeClass('active'));
        switch (mode) {
            case 'japanese': japBtn?.addClass('active'); break;
            case 'english': engBtn?.addClass('active'); break;
            case 'quick_to_japanese': quickJpBtn?.addClass('active'); break;
            case 'quick_english': quickZhBtn?.addClass('active'); break;
        }
        
        // 保存当前选择到设置中
        this.plugin.settings.lastSelectedMode = mode;
        this.plugin.saveSettings();
    }

    private runActiveMode(): void {
        switch (this.activeMode) {
            case 'japanese': this.handleProcess('japanese'); break;
            case 'english': this.handleProcess('english'); break;
            case 'quick_to_japanese': this.handleQuickToJapanese(); break;
            case 'quick_english': this.handleQuickProcess(); break;
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
                if (!fixedPath) { new Notice('未设置"快捷翻译"固定输出文件'); return; }
                const file = this.app.vault.getAbstractFileByPath(fixedPath);
                if (file instanceof TFile) {
                    await this.app.vault.append(file, `\n---\n${content}`);
                    new Notice(`已追加到固定文件: ${file.name}`);
                    return { destination: 'fixedFile', filePath: fixedPath, fileName: file.name, heading: headingText };
                } else {
                    const folderPath = fixedPath.substring(0, fixedPath.lastIndexOf('/'));
                    if (folderPath && !await this.app.vault.adapter.exists(folderPath)) {
                        await this.app.vault.createFolder(folderPath);
                    }
                    await this.app.vault.create(fixedPath, `# 快捷翻译记录\n\n${content}`);
                    new Notice('已创建固定文件并写入内容');
                    return { destination: 'fixedFile', filePath: fixedPath, fileName: fixedPath.split('/').pop(), heading: headingText };
                }
            } else if (destination === 'newFile') {
                const base = this.plugin.settings.quickTranslationOutputSettings.newFileLocation || '';
                const safe = original.substring(0, 50).replace(/[\\/:?*<>"|#^\[\]]/g, '').trim() || '翻译结果';
                const fileName = `${safe} - 快速翻译.md`;
                const full = base ? `${base}${fileName}` : fileName;
                if (base && !await this.app.vault.adapter.exists(base.replace(/\/$/, ''))) {
                    await this.app.vault.createFolder(base.replace(/\/$/, ''));
                }
                await this.app.vault.create(full, content);
                const file = this.app.vault.getAbstractFileByPath(full) as TFile;
                if (file) await this.app.workspace.getLeaf().openFile(file);
                new Notice(`已创建新文件: ${fileName}`);
                return { destination: 'newFile', filePath: full, fileName, heading: headingText };
            } else if (destination === 'appendCurrent' || destination === 'replace') {
                const targetFile = this.getTargetFile();
                if (!targetFile) { new Notice('未找到当前文件，已跳过文件输出'); return; }
                if (destination === 'appendCurrent') {
                    await this.app.vault.append(targetFile, `\n---\n${content}`);
                    new Notice(`已追加到当前文件: ${targetFile.name}`);
                    return { destination: 'appendCurrent', filePath: targetFile.path, fileName: targetFile.name, heading: headingText };
                } else {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    const editor = view?.editor;
                    if (editor && editor.somethingSelected()) {
                        editor.replaceSelection(content);
                        new Notice('已替换选中内容');
                        return { destination: 'replace', filePath: targetFile.path, fileName: targetFile.name, heading: headingText };
                    } else {
                        await this.app.vault.append(targetFile, `\n---\n${content}`);
                        new Notice(`未选中文本，已追加到文件: ${targetFile.name}`);
                        return { destination: 'appendCurrent', filePath: targetFile.path, fileName: targetFile.name, heading: headingText };
                    }
                }
            }
        } catch (e) {
            new Notice(`快速翻译输出失败: ${e.message}`);
        }
    }
    getViewType() { return POLYGLOT_HELPER_VIEW_TYPE; }
    getDisplayText() { return "Polyglot Helper"; }
    getIcon() { return "book-open"; }

    async onOpen() {
        const root = this.containerEl.children[1] as HTMLElement;
        root.empty();
        root.addClass('polyglot-root', 'polyglot-helper-view-container');

        // --- 顶部：标题、设置、两页切换 ---
        const head = root.createDiv({ cls: 'polyglot-view-head' });
        head.createEl('h3', { text: '语言助手' });
        const settingsEntry = head.createEl('button', { text: '设置', cls: 'polyglot-link' });
        settingsEntry.addEventListener('click', () => {
            const settings = (this.app as typeof this.app & { setting?: { open(): void; openTabById(id: string): void } }).setting;
            settings?.open();
            settings?.openTabById(this.plugin.manifest.id);
        });
        const tabs = root.createDiv({ cls: 'polyglot-tabs' });
        this.tabButtons.look = tabs.createEl('button', { text: '查词' });
        this.tabButtons.learn = tabs.createEl('button', { text: '学习' });
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
            this.actionsContainer.style.flexBasis = '38%';
        });

        this.setupResizer();

        // --- Populate Actions Container ---
        this.actionsContent = this.actionsContainer.createDiv('polyglot-actions-content');
        this.actionsContent.style.flex = '1'; // Ensure content fills the container

        // 文本框容器，包含输入框和选词模式开关
        const inputContainer = this.actionsContent.createDiv({ cls: 'polyglot-input-container' });
        
        this.queryInput = new TextAreaComponent(inputContainer)
            .setPlaceholder("在此输入文本...");
        this.queryInput.inputEl.addClass('polyglot-query-input');

        // 右侧按钮容器
        const rightButtonsContainer = inputContainer.createDiv({ cls: 'polyglot-input-right-buttons' });

        // 选词模式开关按钮
        const wordSelectionToggle = rightButtonsContainer.createEl('button', {
            cls: `polyglot-word-selection-toggle ${this.plugin.settings.wordSelectionMode ? 'active' : ''}`,
            title: this.plugin.settings.wordSelectionMode ? '选词模式：已开启' : '选词模式：已关闭'
        });
        setIcon(wordSelectionToggle, 'mouse-pointer-click');
        wordSelectionToggle.addEventListener('click', async () => {
            this.plugin.settings.wordSelectionMode = !this.plugin.settings.wordSelectionMode;
            wordSelectionToggle.toggleClass('active', this.plugin.settings.wordSelectionMode);
            wordSelectionToggle.setAttribute('title', this.plugin.settings.wordSelectionMode ? '选词模式：已开启' : '选词模式：已关闭');
            await this.plugin.saveSettings();
            new Notice(this.plugin.settings.wordSelectionMode ? '✅ 选词模式已开启' : '❌ 选词模式已关闭');
        });

        // 确认按钮（执行当前模式）
        const confirmButton = rightButtonsContainer.createEl('button', {
            cls: 'polyglot-confirm-button',
            title: '执行当前模式（或按 Enter）'
        });
        confirmButton.setText('查询');
        confirmButton.setAttribute('aria-label', '查询当前文本');
        confirmButton.addEventListener('click', () => {
            this.runActiveMode();
        });

        // 保存按钮引用，以便在设置变化时更新
        this.wordSelectionToggle = wordSelectionToggle;

        const buttonContainer = this.actionsContent.createDiv({ cls: "polyglot-button-container-row" });

        // --- Japanese Button Group ---
        const japGroup = buttonContainer.createDiv({ cls: 'polyglot-button-group' });
        const japBtn = japGroup.createEl("button", { text: "日语", cls: "polyglot-button" });
        japBtn.addEventListener("click", () => { this.setActiveMode('japanese'); });
        const japSettingsBtn = japGroup.createEl("button", { cls: "polyglot-settings-button" });
        setIcon(japSettingsBtn, 'more-vertical');
        japSettingsBtn.addEventListener('click', (event) => {
            this.showJapaneseOptionsPanel(event);
        }, { capture: false });

        // --- English Button Group ---
        const engGroup = buttonContainer.createDiv({ cls: 'polyglot-button-group' });
        const engBtn = engGroup.createEl("button", { text: "英语", cls: "polyglot-button" });
        engBtn.addEventListener("click", () => { this.setActiveMode('english'); });
        const engSettingsBtn = engGroup.createEl("button", { cls: "polyglot-settings-button" });
        setIcon(engSettingsBtn, 'more-vertical');
        engSettingsBtn.addEventListener('click', (event) => {
            this.showEnglishOptionsPanel(event);
        }, { capture: false });
        
        // --- Quick to Japanese Group (button + settings) ---
        const quickJpGroup = buttonContainer.createDiv({ cls: 'polyglot-button-group' });
        const quickJpBtn = quickJpGroup.createEl("button", { text: "译日语", cls: "polyglot-button polyglot-quick-button" });
        quickJpBtn.addEventListener("click", () => { this.setActiveMode('quick_to_japanese'); });
        const quickSettingsSmall = quickJpGroup.createEl("button", { cls: "polyglot-settings-button", attr: { title: '快捷翻译设置' } });
        setIcon(quickSettingsSmall, 'more-vertical');
        quickSettingsSmall.addEventListener('click', (event) => this.showQuickOptionsPanel(event), { capture: false });
        const quickZhBtn = buttonContainer.createEl("button", { text: "译中文", cls: "polyglot-button polyglot-quick-button" });
        quickZhBtn.addEventListener("click", () => { this.setActiveMode('quick_english'); });

        // 记录按钮引用，便于切换高亮
        this.modeButtons = { japBtn, engBtn, quickJpBtn, quickZhBtn } as any;

        // 设置初始模式（从设置中读取上次选择）
        const savedMode = this.plugin.settings.lastSelectedMode || 'quick_to_japanese';
        this.setActiveMode(savedMode);

        // 输入框回车：执行当前模式
        this.queryInput.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.runActiveMode();
            }
        });

        // --- Compact Options Row ---
        const optionsContainer = this.actionsContent.createDiv({ cls: 'polyglot-compact-options' });

        // 强制刷新按钮（小图标）
        const refreshBtn = optionsContainer.createEl('button', {
            cls: `polyglot-icon-button ${this.plugin.settings.forceRefresh ? 'active' : ''}`,
            title: '强制刷新'
        });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.addEventListener('click', async () => {
            this.plugin.settings.forceRefresh = !this.plugin.settings.forceRefresh;
            refreshBtn.toggleClass('active', this.plugin.settings.forceRefresh);
            await this.plugin.saveSettings();
        });

        // 语音合成按钮
        const voiceBtn = optionsContainer.createEl('button', {
            cls: 'polyglot-icon-button',
            title: '语音合成'
        });
        setIcon(voiceBtn, 'volume-2');
        voiceBtn.addEventListener('click', () => this.handleVoiceSynthesis());

        // 设置菜单按钮
        const settingsBtn = optionsContainer.createEl('button', {
            cls: 'polyglot-icon-button',
            title: '语音选项',
            attr: { 'aria-label': '语音选项' }
        });
        setIcon(settingsBtn, 'settings');
        settingsBtn.addEventListener('click', (event) => this.showSettingsPanel(event));

        // 输出位置下拉（保持但样式更紧凑）
        const outputContainer = optionsContainer.createDiv({cls: 'polyglot-output-container'});
        const outputDropdown = new DropdownComponent(outputContainer)
            .addOptions({
                'sidebar': '侧边栏',
                'replace': '替换选文',
                'appendCurrent': '追加当前文件',
                'newFile': '创建新文件',
                'fixedFile': '固定文件'
            })
            .setValue(this.plugin.settings.outputDestination)
            .onChange(async (value: 'replace' | 'appendCurrent' | 'newFile' | 'sidebar' | 'fixedFile') => {
                this.plugin.settings.outputDestination = value;
                // 合并为一个控制：同时应用于"快速翻译"的输出目的地
                this.plugin.settings.quickTranslationOptions = this.plugin.settings.quickTranslationOptions || { showRomaji: false, playAudio: true, outputDestination: 'sidebar' };
                this.plugin.settings.quickTranslationOptions.outputDestination = value;
                await this.plugin.saveSettings();
            });

        // 移除紧凑行中的"快捷翻译设置"按钮（已放到→日旁）

        // 跳转到上一次输出位置按钮
        const jumpToOutputBtn = optionsContainer.createEl('button', {
            cls: 'polyglot-icon-button',
            title: '跳转到上一次输出位置'
        });
        setIcon(jumpToOutputBtn, 'external-link');
        jumpToOutputBtn.addEventListener('click', () => this.jumpToLastOutputLocation());


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
                    this.wordSelectionToggle.setAttribute('title', this.plugin.settings.wordSelectionMode ? '选词模式：已开启' : '选词模式：已关闭');
                }
            })
        );
        this.registerEvent(
            // @ts-ignore
            this.app.workspace.on('polyglot-query-success', (result) => this.renderResult(result))
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

        // 创建操作按钮栏
        const actionBar = this.displayContainer.createDiv({ cls: 'polyglot-results-action-bar' });

        // 创建内容容器
        const contentDiv = this.displayContainer.createDiv('polyglot-result-content');

        // 渲染Markdown内容
        await MarkdownRenderer.render(this.app, result, contentDiv, '', this);

        // 处理渲染后的内容，应用卡片布局和折叠区域
        this.applyCardLayout(contentDiv);
        this.applyCollapsibleSections(contentDiv);
        this.foldSecondarySections(contentDiv);
        this.applyPOSTagging(contentDiv);
        this.renderVocabFooter(contentDiv, result, historyItem);

        // 添加增强的操作按钮
        this.createEnhancedActionButtons(actionBar, result, contentDiv, historyItem);
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
            const collapsible = document.createElement('div');
            collapsible.className = 'polyglot-collapsible';
            heading.parentNode?.insertBefore(collapsible, heading);

            // 创建标题栏
            const header = document.createElement('div');
            header.className = 'polyglot-collapsible-header';
            
            // 移动标题到标题栏
            const title = document.createElement('h3');
            title.className = 'polyglot-collapsible-title';
            title.textContent = heading.textContent || '';
            header.appendChild(title);
            
            // 添加折叠图标
            const icon = document.createElement('span');
            icon.className = 'polyglot-collapsible-icon';
            icon.textContent = '▼';
            header.appendChild(icon);
            
            collapsible.appendChild(header);
            
            // 创建内容区域
            const content = document.createElement('div');
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
    private renderVocabFooter(container: HTMLElement, result: string, historyItem?: HistoryItem) {
        const heading = result.match(/^##\s+(.+?)(?:\s+-\s+.*)?\s*$/m)?.[1]?.trim();
        const word = (historyItem?.query || heading || '').trim();
        if (!word || !this.plugin.settings.enableLearningTracker) return;
        const s = this.plugin.settings;
        const item = s.englishVocabItems[word.toLowerCase()] || s.englishVocabItems[word]
            || Object.values(s.japaneseVocabItems).find(v => v.japaneseText === word || v.originalText === word);
        if (!item) return;

        const foot = container.createDiv({ cls: 'polyglot-vocab-foot' });
        const source = sourceNote(item.notes);
        if (source) foot.createDiv({ cls: 'polyglot-muted', text: source });
        const row = foot.createDiv({ cls: 'polyglot-vocab-foot-row' });
        row.createSpan({ text: '掌握程度' });
        const level = row.createSpan({ cls: 'polyglot-level' });
        const filled = 4 - Math.min(4, Math.max(0, item.difficulty));
        for (let i = 0; i < 4; i++) level.createEl('i', { cls: i < filled ? 'is-on' : '' });
        const next = item.nextReview && item.nextReview > Date.now()
            ? `下次复习：${new Date(item.nextReview).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}`
            : '今天可以复习';
        row.createSpan({ text: next });
    }

    // 添加词性标签
    private applyPOSTagging(container: HTMLElement) {
        // 查找所有可能包含词性的元素
        const elements = container.querySelectorAll('p, li, dt, dd');
        
        const posPatterns = [
            { regex: /\b(n\.|noun|名词)\b/i, class: 'polyglot-pos-noun', text: '名词' },
            { regex: /\b(v\.|verb|动词)\b/i, class: 'polyglot-pos-verb', text: '动词' },
            { regex: /\b(adj\.|adjective|形容词)\b/i, class: 'polyglot-pos-adj', text: '形容词' },
            { regex: /\b(adv\.|adverb|副词)\b/i, class: 'polyglot-pos-adv', text: '副词' },
            { regex: /\b(prep\.|preposition|介词)\b/i, class: 'polyglot-pos-other', text: '介词' },
            { regex: /\b(conj\.|conjunction|连词)\b/i, class: 'polyglot-pos-other', text: '连词' },
            { regex: /\b(pron\.|pronoun|代词)\b/i, class: 'polyglot-pos-other', text: '代词' },
            { regex: /\b(interj\.|interjection|感叹词)\b/i, class: 'polyglot-pos-other', text: '感叹词' }
        ];
        
        elements.forEach(element => {
            const text = element.textContent || '';
            
            for (const pattern of posPatterns) {
                if (pattern.regex.test(text)) {
                    // 创建词性标签
                    const tag = document.createElement('span');
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
        header.createEl("h5", { text: "最近查询" });

        this.historySearchInput = new TextComponent(header)
            .setPlaceholder('搜索...')
            .setValue(searchTerm)
            .onChange((value) => {
                this.renderHistory(value);
            });
        this.historySearchInput.inputEl.addClass('polyglot-history-search');

        const clearButton = header.createEl('button', { text: '清空', cls: 'polyglot-history-clear' });
        clearButton.addEventListener('click', async () => {
            this.plugin.settings.queryHistory = [];
            await this.plugin.saveSettings();
            this.renderHistory('');
            new Notice("查询历史已清空。");
        });

        const list = historyContainer.createDiv({ cls: "polyglot-history-list" });

        if (history.length === 0) {
            list.createDiv({text: '无历史记录', cls: 'polyglot-history-empty'});
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
                playBtn.setAttribute('aria-label', '播放日语语音');
                playBtn.setAttribute('title', `播放: ${item.translation}`);

                playBtn.addEventListener('click', async (event) => {
                    event.stopPropagation(); // 防止触发主项目点击事件

                    try {
                        await this.plugin.playJapaneseVoice(item.translation!, this.plugin.settings.forceRefreshAudio);
                        new Notice(`🎵 播放: ${item.translation}`);
                    } catch (error) {
                        console.error('History voice playback error:', error);
                        new Notice(`❌ 语音播放失败: ${error.message}`);
                    }
                });
            }

            // 跳转到输出位置按钮（如果记录包含输出位置信息）
            if (item.outputLocation && item.outputLocation.destination !== 'sidebar') {
                const jumpBtn = historyItemEl.createEl('button', { cls: 'polyglot-history-item-jump' });
                setIcon(jumpBtn, 'external-link');
                jumpBtn.setAttribute('aria-label', '跳转到输出位置');
                jumpBtn.setAttribute('title', '跳转到输出位置');

                jumpBtn.addEventListener('click', async (event) => {
                    event.stopPropagation(); // 防止触发主项目点击事件
                    await this.jumpToHistoryItemLocation(item);
                });
            }

            // 删除按钮保持现有功能
            const deleteBtn = historyItemEl.createEl('button', { cls: 'polyglot-history-item-delete' });
            setIcon(deleteBtn, 'trash-2');
            deleteBtn.setAttribute('aria-label', '删除此条记录');

            // Add click listener for the delete button
            deleteBtn.addEventListener('click', async (event) => {
                event.stopPropagation(); // VERY IMPORTANT: Prevents the main item click event

                const index = this.plugin.settings.queryHistory.indexOf(item);
                if (index > -1) {
                    this.plugin.settings.queryHistory.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.renderHistory(this.historySearchInput.getValue()); // Refresh the view
                }
            });

            // Add click listener for the whole item
            historyItemEl.addEventListener("click", async () => {
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
                        new Notice(`原文: ${item.query}`);
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
                        this.displayQuickTranslationFromHistory(item);
                    }
                } else if (item.type === 'japanese') {
                    // 对于日语分析记录，先尝试从缓存获取，如果失败则重新处理
                    const cachedResult = await this.plugin.getCachedResult(item);
                    if (cachedResult) {
                        this.renderResult(cachedResult, true, item);
                    } else {
                        // 缓存未找到，重新处理日语分析并直接显示在面板中
                        new Notice("缓存未找到，正在重新分析...");
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
                                this.renderResult(finalResult, true, item);
                            } else {
                                new Notice("重新分析失败");
                            }
                        } catch (error) {
                            new Notice(`重新分析失败: ${error.message}`);
                        }
                    }
                } else if (item.type === 'english') {
                    // 对于英语分析记录，先尝试从缓存获取，如果失败则重新处理
                    const cachedResult = await this.plugin.getCachedResult(item);
                    if (cachedResult) {
                        this.renderResult(cachedResult, true, item);
                    } else {
                        // 缓存未找到，重新处理英语分析并直接显示在面板中
                        new Notice("缓存未找到，正在重新分析...");
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
                                this.renderResult(result, true, item);
                            } else {
                                new Notice("重新分析失败");
                            }
                        } catch (error) {
                            new Notice(`重新分析失败: ${error.message}`);
                        }
                    }
                } else {
                    // 对于其他未知类型
                    new Notice(`未知的历史记录类型: ${item.type}`);
                }
            });
        });
    }

    private getHistoryItemTypeName(type: HistoryItem['type']): string {
        switch (type) {
            case 'english': return '英';
            case 'japanese': return '日';
            case 'quick_english': return '→汉';
            case 'quick_to_japanese': return '→日';
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
            new Notice("请在侧边栏输入或在编辑器中选中文本。");
            return;
        }

        // 锁定开始处理时的目标文件
        const targetFile = this.getTargetFile();
        const outputDestination = this.plugin.settings.outputDestination;

        // 如果输出模式需要文件但没有活动文件，提前提示
        if (!targetFile && (outputDestination === 'appendCurrent' || outputDestination === 'replace')) {
            new Notice("当前没有打开的文件，结果将在侧边栏显示。\n💡 提示：请打开一个文件，或更改输出位置。");
        } else if (targetFile && (outputDestination === 'appendCurrent' || outputDestination === 'replace')) {
            new Notice(`🎯 目标文件已锁定：${targetFile.name}\n处理过程中可以自由切换文件。`);
        }

        const force = this.plugin.settings.forceRefresh;

        if (type === "english") {
            this.plugin.processEnglish(query, force, targetFile);
        } else {
            this.plugin.processJapanese(query, force, targetFile);
        }

        this.queryInput.setValue('');
    }

    private async handleQuickToJapanese() {
        const query = this.queryInput.getValue().trim();
        if (!query) {
            new Notice("请输入文本。");
            return;
        }

        // 创建一个持续的处理状态提示
        const processingNotice = new Notice("🔄 正在翻译并生成语音...", 0); // 0表示不自动关闭

        try {
            // 检查API配置
            const { englishLlmApiKey, englishLlmBaseUrl, ttsEngine } = this.plugin.settings;
            if (!englishLlmApiKey || !englishLlmBaseUrl) {
                processingNotice.hide();
                new Notice("❌ 请先在设置中配置LLM API密钥和Base URL");
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
                const romajiFromLLM: string | undefined = (rich && (rich as any).romaji) ? (rich as any).romaji : undefined;
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
                        } catch {}
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
                    setTimeout(async () => {
                        try {
                            // 检查TTS配置
                            if (ttsEngine === 'openai' && (!this.plugin.settings.openaiTtsApiKey || !this.plugin.settings.openaiTtsBaseUrl)) return;
                            if (ttsEngine === 'youdao' && (!this.plugin.settings.youdaoAppKey || !this.plugin.settings.youdaoAppSecret)) return;
                            if (ttsEngine === 'gemini' && (!this.plugin.settings.geminiTtsApiKey || !this.plugin.settings.geminiTtsBaseUrl)) return;

                            await this.plugin.playJapaneseVoice(japaneseTranslation!, this.plugin.settings.forceRefreshAudio);
                            new Notice(`🎵 已播放: ${japaneseTranslation}`);
                        } catch (voiceError) {
                            console.error('Voice playback error:', voiceError);
                        }
                    }, 10);
                }
            } else {
                processingNotice.hide();
                new Notice("❌ 翻译失败，请检查API配置或网络连接。");
            }
        } catch (error) {
            console.error('Quick to Japanese translation error:', error);
            processingNotice.hide();
            new Notice(`❌ 翻译过程中出现错误：${error.message || '未知错误'}`);
        }

        this.queryInput.setValue('');
    }

    private async displayQuickTranslationFromHistory(item: HistoryItem) {
        try {
            // 显示加载状态
            const loadingNotice = new Notice("🔄 正在加载历史翻译...", 0);

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
                new Notice("❌ 无法重新获取翻译结果，请检查API配置");
            }
        } catch (error) {
            console.error('History translation display error:', error);
            new Notice(`❌ 显示历史翻译失败：${error.message || '未知错误'}`);
        }
    }

    private displayQuickTranslationResult(originalText: string, translation: string, voiceSuccess: boolean, translationType: string = "→日", romajiPrefetched?: string) {
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
                import('./utils').then(({ kanaToRomaji }) => {
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
        const bInsert = actions.createEl('button', { cls: 'polyglot-action-btn primary' }); setIcon(bInsert, 'file-plus-2'); bInsert.title = '插入到当前文档'; bInsert.addEventListener('click', () => this.insertToCurrentNote(compose()));
        const bCopy = actions.createEl('button', { cls: 'polyglot-action-btn' }); setIcon(bCopy, 'copy'); bCopy.title = '复制结果'; bCopy.addEventListener('click', () => this.copyToClipboard(compose()));
        const bPlay = actions.createEl('button', { cls: 'polyglot-action-btn' }); setIcon(bPlay, 'volume-2'); bPlay.title = '播放语音'; bPlay.addEventListener('click', async () => { try { await this.plugin.playJapaneseVoice(translation, this.plugin.settings.forceRefreshAudio); } catch (e) { new Notice(`❌ 语音播放失败: ${e.message}`);} });
        const bNew = actions.createEl('button', { cls: 'polyglot-action-btn secondary' }); setIcon(bNew, 'file-plus'); bNew.title = '输出到新笔记'; bNew.addEventListener('click', () => this.createNewNote(compose()));
        const bFixed = actions.createEl('button', { cls: 'polyglot-action-btn secondary' }); setIcon(bFixed, 'file-text'); bFixed.title = '输出到固定文件'; bFixed.addEventListener('click', () => this.outputToFixedFile(compose()));
        const bClear = actions.createEl('button', { cls: 'polyglot-action-btn danger' }); setIcon(bClear, 'trash-2'); bClear.title = '清空结果'; bClear.addEventListener('click', () => this.clearResults());

        // 移除底部提示行（更简洁）
    }

    private async handleQuickProcess() {
        const query = this.queryInput.getValue().trim();
        if (!query) {
            new Notice("请输入文本。");
            return;
        }

        // 创建一个持续的处理状态提示
        const processingNotice = new Notice("🔄 正在翻译为中文...", 0); // 0表示不自动关闭

        try {
            // 检查API配置
            const { englishLlmApiKey, englishLlmBaseUrl } = this.plugin.settings;
            if (!englishLlmApiKey || !englishLlmBaseUrl) {
                processingNotice.hide();
                new Notice("❌ 请先在设置中配置LLM API密钥和Base URL");
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
                new Notice(`✅ 翻译完成：${chineseTranslation}`);

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
                new Notice("❌ 翻译失败，请检查API配置或网络连接。");
            }
        } catch (error) {
            console.error('Quick English translation error:', error);
            processingNotice.hide();
            new Notice(`❌ 翻译过程中出现错误：${error.message || '未知错误'}`);
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
        insertButton.setAttribute('aria-label', '插入到当前笔记');
        insertButton.addEventListener('click', () => this.insertToCurrentNote(result));

        // 复制按钮
        const copyButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn' });
        setIcon(copyButton, 'copy');
        copyButton.setAttribute('aria-label', '复制到剪贴板');
        copyButton.addEventListener('click', () => this.copyToClipboard(result));

        // 语音播放按钮
        const audioButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn' });
        setIcon(audioButton, 'volume-2');
        audioButton.setAttribute('aria-label', '朗读内容');
        audioButton.addEventListener('click', () => this.playAudio(contentDiv));

        // 添加到词汇库按钮
        const addToVocabButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn secondary' });
        setIcon(addToVocabButton, 'bookmark-plus');
        addToVocabButton.setAttribute('aria-label', '添加到词汇库');
        addToVocabButton.addEventListener('click', () => this.addToVocabulary(result));

        // 创建新笔记按钮
        const newNoteButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn secondary' });
        setIcon(newNoteButton, 'file-plus');
        newNoteButton.setAttribute('aria-label', '创建新笔记');
        newNoteButton.addEventListener('click', () => this.createNewNote(result, historyItem));

        // 输出到固定文件按钮
        const fixedFileButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn secondary' });
        setIcon(fixedFileButton, 'file-text');
        fixedFileButton.setAttribute('aria-label', '输出到固定文件');
        fixedFileButton.addEventListener('click', () => this.outputToFixedFile(result, historyItem));

        // 清除按钮
        const clearButton = actionsRow.createEl('button', { cls: 'polyglot-action-btn danger' });
        setIcon(clearButton, 'trash-2');
        clearButton.setAttribute('aria-label', '清除结果');
        clearButton.addEventListener('click', () => this.clearResults());
    }

    /**
     * 插入到当前笔记
     */
    private insertToCurrentNote(result: string): void {
        // 优先使用开始处理时的文件，如果没有则使用最后活跃的文件
        const targetEditor = this.processingStartFile?.editor || this.lastActiveLeaf?.editor;
        const targetFileName = this.processingStartFile?.file?.name || this.lastActiveLeaf?.file?.name || '未知文件';

        if (targetEditor) {
            targetEditor.replaceSelection(result);
            new Notice(`✅ 结果已插入到 ${targetFileName}`);
            this.clearResults();
        } else {
            new Notice('❌ 无法插入结果，请先点击您想操作的笔记');
        }
    }

    /**
     * 复制到剪贴板
     */
    private copyToClipboard(result: string): void {
        // 优先使用现代 Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(result).then(() => {
                new Notice('✅ 结果已复制到剪贴板');
            }).catch(() => {
                // 降级到传统方法
                this.fallbackCopyToClipboard(result);
            });
        } else {
            // 降级到传统方法
            this.fallbackCopyToClipboard(result);
        }
    }

    /**
     * 降级复制方法（兼容移动端和旧浏览器）
     */
    private fallbackCopyToClipboard(text: string): void {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            
            // 移动端兼容性处理
            if ('ontouchstart' in window) {
                // 移动端：直接选择文本
                textArea.select();
            } else {
                // 桌面端：先聚焦再选择
                textArea.focus();
                textArea.select();
            }
            
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                new Notice('✅ 结果已复制到剪贴板');
            } else {
                new Notice('❌ 复制失败，请手动复制');
            }
        } catch (err) {
            new Notice('❌ 复制失败，请手动复制');
        }
    }

    /**
     * 播放音频
     */
    private async playAudio(contentDiv: HTMLElement): Promise<void> {
        const audioElements = contentDiv.querySelectorAll('audio');
        if (audioElements.length > 0) {
            const audio = audioElements[0] as HTMLAudioElement;
            
            // 移动端兼容性：尝试播放，如果失败则提示用户
            try {
                await audio.play();
                new Notice('🔊 开始播放音频');
            } catch (playError) {
                console.warn('Audio play failed, might need user interaction:', playError);
                if ('ontouchstart' in window) {
                    new Notice('请在移动端点击音频控件来播放');
                    // 显示音频控件
                    audio.controls = true;
                } else {
                    new Notice('❌ 音频播放失败');
                }
            }
        } else {
            new Notice('❌ 未找到音频内容');
        }
    }

    /**
     * 添加到词汇库
     */
    private addToVocabulary(result: string): void {
        // 提取查询的单词
        const queryText = this.queryInput.getValue().trim();
        if (!queryText) {
            new Notice('❌ 无法确定要添加的词汇');
            return;
        }

        // 添加到词汇库
        if (!this.plugin.settings.vocabItems) {
            this.plugin.settings.vocabItems = {};
        }

        this.plugin.settings.vocabItems[queryText] = {
            word: queryText,
            translation: result,
            createdAt: Date.now(),
            addedAt: Date.now(),
            reviewCount: 0,
            difficulty: 1,
            masteryLevel: 0,
            reviewHistory: [],
            lastReviewed: 0,
            nextReview: Date.now() + 24 * 60 * 60 * 1000 // 明天复习
        };

        this.plugin.saveSettings();
        new Notice(`✅ "${queryText}" 已添加到词汇库`);
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
            new Notice(`✅ 已创建新笔记: ${fileName}`);
        } catch (error) {
            new Notice('❌ 创建笔记失败');
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
            new Notice("错误：未设置固定输出文件路径。请在设置中配置。");
            return;
        }

        const fixedFile = this.app.vault.getAbstractFileByPath(fixedOutputFile);
        if (fixedFile instanceof TFile) {
            // 文件存在，追加内容
            const timestamp = new Date().toLocaleString('zh-CN');
            const content = `\n\n---\n**${timestamp}**\n\n${result}\n\n\n`;
            await this.app.vault.append(fixedFile, content);
            new Notice(`结果已追加到固定文件: ${fixedFile.name}`);
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
                new Notice(`固定文件已创建并保存结果: ${newFile.name}`);
            } catch (e) {
                new Notice(`创建固定文件失败: ${e.message}`);
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
            new Notice("错误：找不到日语设置。");
            return;
        }

        // 创建自定义面板
        const panel = document.body.createDiv('polyglot-options-panel');

        // 设置面板位置
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.bottom + 5}px`;
        panel.style.zIndex = '1000';

        const sectionNames: Record<keyof typeof sections, string> = {
            vocabAnalysis: '词汇分析',
            relatedVocab: '相关词汇解析',
            sentences: '例句生成',
            exercise: '翻译练习',
            jisho: 'Jisho 词典'
        };

        // 过滤掉不在 sectionNames 中的键
        const validSections = Object.keys(sections).filter(key => key in sectionNames);

        validSections.forEach(key => {
            const typedKey = key as keyof typeof sections;
            const sectionName = sectionNames[typedKey];

            const item = panel.createDiv('polyglot-option-item');

            const checkbox = item.createEl('input', { type: 'checkbox' });
            checkbox.checked = sections[typedKey];

            const label = item.createEl('span', { text: sectionName });

            // 点击切换
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                sections[typedKey] = !sections[typedKey];
                checkbox.checked = sections[typedKey];
                await this.plugin.saveSettings();
            });
        });

        // 语音生成开关
        const sep = panel.createDiv(); sep.createEl('hr');
        const voiceItem = panel.createDiv('polyglot-option-item');

        const voiceCheckbox = voiceItem.createEl('input', { type: 'checkbox' });
        voiceCheckbox.checked = !this.plugin.settings.disableJapaneseVoiceDuringAnalysis;
        const voiceLabel = voiceItem.createEl('span', { text: '生成语音' });

        voiceItem.addEventListener('click', async (e) => {
            e.stopPropagation();
            voiceCheckbox.checked = !voiceCheckbox.checked;
            this.plugin.settings.disableJapaneseVoiceDuringAnalysis = !voiceCheckbox.checked;
            await this.plugin.saveSettings();
        });

        // 点击外部关闭面板
        const closePanel = (e: MouseEvent) => {
            if (!panel.contains(e.target as Node)) {
                panel.remove();
                document.removeEventListener('click', closePanel);
            }
        };

        // 延迟添加事件监听器，避免立即触发
        setTimeout(() => {
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
        panel.style.position = 'fixed';
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.bottom + 5}px`;
        panel.style.zIndex = '1000';

        const sectionNames: Record<keyof typeof sections, string> = {
            definitions: '词典释义',
            example: '例句',
            usage: '用法助记',
            etymology: '词源',
            medical: '医学专用',
            slang: '俚语',
            tatoeba: 'Tatoeba 例句',
            idioms: '相关习语'
        };

        (Object.keys(sections) as Array<keyof typeof sections>).forEach(key => {
            const sectionName = sectionNames[key];

            const item = panel.createDiv('polyglot-option-item');

            const checkbox = item.createEl('input', { type: 'checkbox' });
            checkbox.checked = sections[key];

            const label = item.createEl('span', { text: sectionName });

            // 点击切换
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                sections[key] = !sections[key];
                checkbox.checked = sections[key];
                await this.plugin.saveSettings();
            });
        });



        // 点击外部关闭面板
        const closePanel = (e: MouseEvent) => {
            if (!panel.contains(e.target as Node)) {
                panel.remove();
                document.removeEventListener('click', closePanel);
            }
        };

        // 延迟添加事件监听器，避免立即触发
        setTimeout(() => {
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
        panel.style.position = 'fixed';
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.bottom + 5}px`;
        panel.style.zIndex = '1000';

        const entries: Array<{ key: 'showRomaji' | 'playAudio'; label: string; }> = [
            { key: 'showRomaji', label: '罗马音标注' },
            { key: 'playAudio', label: '播放音频' }
        ];

        entries.forEach(({ key, label }) => {
            const item = panel.createDiv('polyglot-option-item');

            const checkbox = item.createEl('input', { type: 'checkbox' });
            // @ts-ignore
            checkbox.checked = opts[key] ?? false;

            const labelEl = item.createEl('span', { text: label });


            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                // @ts-ignore
                opts[key] = !opts[key];
                // @ts-ignore
                checkbox.checked = opts[key];
                await this.plugin.saveSettings();
            });
        });

        const closePanel = (e: MouseEvent) => {
            if (!panel.contains(e.target as Node)) {
                panel.remove();
                document.removeEventListener('click', closePanel);
            }
        };
        setTimeout(() => document.addEventListener('click', closePanel), 100);
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
            new Notice("请先输入要合成语音的文本。");
            return;
        }

        try {
            new Notice("🎵 正在生成语音...");
            // 使用TTS API直接播放
            await this.plugin.playJapaneseVoice(query, this.plugin.settings.forceRefreshAudio);
        } catch (error) {
            new Notice(`语音合成失败: ${error.message}`);
            this.plugin.logger.error("语音合成失败", error);
        }
    }

    /**
     * 显示设置面板
     */
    private showSettingsPanel(event: MouseEvent): void {
        const panel = document.createElement('div');
        panel.className = 'polyglot-settings-panel';

        // 计算位置
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.top = `${rect.bottom + 8}px`;
        panel.style.left = `${Math.max(10, rect.left - 100)}px`; // 防止超出屏幕
        panel.style.zIndex = '1000';

        // 添加面板标题
        const header = panel.createDiv({ cls: 'polyglot-settings-header' });
        header.createEl('span', { text: '语音', cls: 'polyglot-settings-title' });

        // TTS引擎选择
        const ttsSection = panel.createDiv({ cls: 'polyglot-settings-section' });
        ttsSection.createEl('label', { text: '引擎', cls: 'polyglot-settings-label' });
        const ttsSelect = ttsSection.createEl('select', { cls: 'polyglot-settings-select' });
        ttsSelect.innerHTML = `
            <option value="openai" ${this.plugin.settings.ttsEngine === 'openai' ? 'selected' : ''}>🤖 OpenAI</option>
            <option value="youdao" ${this.plugin.settings.ttsEngine === 'youdao' ? 'selected' : ''}>📚 有道</option>
            <option value="gemini" ${this.plugin.settings.ttsEngine === 'gemini' ? 'selected' : ''}>💎 Gemini</option>
        `;
        ttsSelect.addEventListener('change', async () => {
            this.plugin.settings.ttsEngine = ttsSelect.value as 'openai' | 'youdao' | 'gemini';
            await this.plugin.saveSettings();
            // 重新渲染面板以显示/隐藏语音选择
            panel.remove();
            this.showSettingsPanel(event);
        });

        // 语音速度
        const speedSection = panel.createDiv({ cls: 'polyglot-settings-section' });
        const speedHeader = speedSection.createDiv({ cls: 'polyglot-settings-speed-header' });
        speedHeader.createEl('label', { text: '速度', cls: 'polyglot-settings-label' });
        const speedValue = speedHeader.createEl('span', {
            text: `${this.plugin.settings.openaiTtsSpeed || 1.0}x`,
            cls: 'polyglot-settings-value'
        });

        const speedSlider = speedSection.createEl('input', {
            type: 'range',
            cls: 'polyglot-settings-slider'
        }) as HTMLInputElement;
        speedSlider.min = '0.5';
        speedSlider.max = '2.0';
        speedSlider.step = '0.1';
        speedSlider.value = this.plugin.settings.openaiTtsSpeed?.toString() || '1.0';

        speedSlider.addEventListener('input', async () => {
            const speed = parseFloat(speedSlider.value);
            this.plugin.settings.openaiTtsSpeed = speed;
            speedValue.textContent = `${speed}x`;
            await this.plugin.saveSettings();
        });

        // 语音选择（OpenAI和Gemini）
        if (this.plugin.settings.ttsEngine === 'openai') {
            const voiceSection = panel.createDiv({ cls: 'polyglot-settings-section' });
            voiceSection.createEl('label', { text: '声音', cls: 'polyglot-settings-label' });
            const voiceSelect = voiceSection.createEl('select', { cls: 'polyglot-settings-select' });
            voiceSelect.innerHTML = `
                <option value="alloy" ${this.plugin.settings.openaiTtsVoice === 'alloy' ? 'selected' : ''}>🎭 Alloy</option>
                <option value="echo" ${this.plugin.settings.openaiTtsVoice === 'echo' ? 'selected' : ''}>🔊 Echo</option>
                <option value="fable" ${this.plugin.settings.openaiTtsVoice === 'fable' ? 'selected' : ''}>📖 Fable</option>
                <option value="onyx" ${this.plugin.settings.openaiTtsVoice === 'onyx' ? 'selected' : ''}>💎 Onyx</option>
                <option value="nova" ${this.plugin.settings.openaiTtsVoice === 'nova' ? 'selected' : ''}>⭐ Nova</option>
                <option value="shimmer" ${this.plugin.settings.openaiTtsVoice === 'shimmer' ? 'selected' : ''}>✨ Shimmer</option>
            `;
            voiceSelect.addEventListener('change', async () => {
                this.plugin.settings.openaiTtsVoice = voiceSelect.value;
                await this.plugin.saveSettings();
            });
        } else if (this.plugin.settings.ttsEngine === 'gemini') {
            const voiceSection = panel.createDiv({ cls: 'polyglot-settings-section' });
            voiceSection.createEl('label', { text: '声音', cls: 'polyglot-settings-label' });
            const voiceSelect = voiceSection.createEl('select', { cls: 'polyglot-settings-select' });

            // Gemini TTS 完整语音选项（与设置页面保持一致）
            const geminiVoices = [
                { value: 'Zephyr', label: 'Zephyr (明亮)' },
                { value: 'Puck', label: 'Puck (欢快)' },
                { value: 'Charon', label: 'Charon (信息丰富)' },
                { value: 'Kore', label: 'Kore (坚定)' },
                { value: 'Fenrir', label: 'Fenrir (易激动)' },
                { value: 'Leda', label: 'Leda (年轻)' },
                { value: 'Orus', label: 'Orus (坚定)' },
                { value: 'Aoede', label: 'Aoede (轻松)' },
                { value: 'Callirhoe', label: 'Callirhoe (随和)' },
                { value: 'Autonoe', label: 'Autonoe (明亮)' },
                { value: 'Enceladus', label: 'Enceladus (呼吸感)' },
                { value: 'Iapetus', label: 'Iapetus (清晰)' },
                { value: 'Umbriel', label: 'Umbriel (随和)' },
                { value: 'Algieba', label: 'Algieba (平滑)' },
                { value: 'Despina', label: 'Despina (平滑)' },
                { value: 'Erinome', label: 'Erinome (清晰)' },
                { value: 'Algenib', label: 'Algenib (沙哑)' },
                { value: 'Rasalgethi', label: 'Rasalgethi (信息丰富)' },
                { value: 'Laomedeia', label: 'Laomedeia (欢快)' },
                { value: 'Achernar', label: 'Achernar (轻柔)' },
                { value: 'Alnilam', label: 'Alnilam (坚定)' },
                { value: 'Schedar', label: 'Schedar (平稳)' },
                { value: 'Gacrux', label: 'Gacrux (成熟)' },
                { value: 'Pulcherrima', label: 'Pulcherrima (向前)' },
                { value: 'Achird', label: 'Achird (友好)' },
                { value: 'Zubenelgenubi', label: 'Zubenelgenubi (休闲)' },
                { value: 'Vindematrix', label: 'Vindematrix (温柔)' },
                { value: 'Sadachbia', label: 'Sadachbia (活泼)' },
                { value: 'Sadaltager', label: 'Sadaltager (博学)' },
                { value: 'Sulafat', label: 'Sulafat (温暖)' }
            ];

            voiceSelect.innerHTML = geminiVoices.map(voice =>
                `<option value="${voice.value}" ${this.plugin.settings.geminiTtsVoice === voice.value ? 'selected' : ''}>${voice.label}</option>`
            ).join('');

            voiceSelect.addEventListener('change', async () => {
                this.plugin.settings.geminiTtsVoice = voiceSelect.value;
                await this.plugin.saveSettings();
            });
        }

        // 强制刷新音频选项
        const refreshSection = panel.createDiv({ cls: 'polyglot-settings-section' });
        refreshSection.createEl('label', { text: '音频缓存', cls: 'polyglot-settings-label' });

        const refreshContainer = refreshSection.createDiv({ cls: 'polyglot-settings-refresh-container' });

        // 强制刷新复选框
        const refreshCheckbox = refreshContainer.createEl('input', { type: 'checkbox' });
        refreshCheckbox.id = 'polyglot-force-refresh-audio';
        refreshCheckbox.checked = this.plugin.settings.forceRefreshAudio || false;

        const refreshLabel = refreshContainer.createEl('label');
        refreshLabel.setAttribute('for', 'polyglot-force-refresh-audio');
        refreshLabel.textContent = '🔄 强制刷新音频';

        refreshCheckbox.addEventListener('change', async () => {
            this.plugin.settings.forceRefreshAudio = refreshCheckbox.checked;
            await this.plugin.saveSettings();
        });

        // 添加说明文字
        const refreshHint = refreshSection.createDiv({ cls: 'polyglot-settings-hint' });
        refreshHint.textContent = '勾选后，相同文字会重新生成音频';

        document.body.appendChild(panel);

        // 添加动画效果
        panel.style.opacity = '0';
        panel.style.transform = 'translateY(-10px)';
        requestAnimationFrame(() => {
            panel.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            panel.style.opacity = '1';
            panel.style.transform = 'translateY(0)';
        });

        // 点击外部关闭面板
        const closePanel = (e: MouseEvent) => {
            if (!panel.contains(e.target as Node)) {
                panel.style.opacity = '0';
                panel.style.transform = 'translateY(-10px)';
                setTimeout(() => panel.remove(), 200);
                document.removeEventListener('click', closePanel);
            }
        };

        // 延迟添加事件监听器，避免立即触发
        setTimeout(() => {
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
            new Notice("已在侧边栏显示");
            return;
        } else if (outputDestination === 'replace') {
            const activeEditor = this.app.workspace.activeEditor;
            targetFile = activeEditor?.file || null;
            if (!targetFile) {
                new Notice("❌ 当前无打开文件");
                return;
            }
        } else if (outputDestination === 'appendCurrent') {
            const activeEditor = this.app.workspace.activeEditor;
            targetFile = activeEditor?.file || null;
            if (!targetFile) {
                new Notice("❌ 当前无打开文件");
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
                new Notice('✅ 已创建新文件');
            } catch (error) {
                new Notice('❌ 创建失败');
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
                new Notice('❌ 未设置固定文件');
                return;
            }
            
            const abstractFile = this.app.vault.getAbstractFileByPath(fixedOutputFile);
            if (abstractFile instanceof TFile) {
                targetFile = abstractFile;
                await this.app.workspace.getLeaf().openFile(targetFile);
                new Notice('✅ 已跳转');
            } else {
                new Notice('❌ 找不到固定文件');
            }
            return;
        }

        if (targetFile) {
            await this.app.workspace.getLeaf().openFile(targetFile);
            new Notice('✅ 已跳转');
        }
    }

    /**
     * 跳转到上一次的输出位置（忽略侧边栏记录）
     */
    private async jumpToLastOutputLocation(): Promise<void> {
        const history = this.plugin.settings.queryHistory || [];
        const last = history.find(h => h.outputLocation && h.outputLocation.destination !== 'sidebar');
        if (!last) { new Notice('没有可用的输出位置记录'); return; }
        await this.jumpToHistoryItemLocation(last);
    }

    /**
     * 跳转到查询记录的输出位置
     */
    private async jumpToHistoryItemLocation(item: HistoryItem): Promise<void> {
        if (!item.outputLocation) {
            new Notice('❌ 无输出位置信息');
            return;
        }

        const { destination, filePath, fileName, heading } = item.outputLocation;
        let targetFile: TFile | null = null;

        if (destination === 'sidebar') {
            new Notice('已在侧边栏显示');
            return;
        } else if (destination === 'replace' || destination === 'appendCurrent') {
            if (filePath) {
                targetFile = this.app.vault.getAbstractFileByPath(filePath) as TFile;
                if (!targetFile) {
                    new Notice('❌ 找不到文件');
                    return;
                }
            } else {
                new Notice('❌ 记录无文件路径');
                return;
            }
        } else if (destination === 'newFile') {
            if (filePath) {
                targetFile = this.app.vault.getAbstractFileByPath(filePath) as TFile;
                if (!targetFile) {
                    new Notice('❌ 找不到新文件');
                    return;
                }
            } else {
                new Notice('❌ 记录无新文件路径');
                return;
            }
        } else if (destination === 'fixedFile') {
            if (filePath) {
                targetFile = this.app.vault.getAbstractFileByPath(filePath) as TFile;
                if (!targetFile) {
                    new Notice('❌ 找不到固定文件');
                    return;
                }
            } else {
                new Notice('❌ 记录无固定文件路径');
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
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
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
                        if (view && view.getViewType() === 'markdown') {
                            const editor = (view as any).editor;
                            if (editor) {
                                editor.setCursor({ line: targetLine, ch: 0 });
                                editor.scrollIntoView({ line: targetLine, ch: 0 });
                                new Notice('✅ 已定位');
                                return;
                            }
                        }
                    }
                } catch (error) {
                    console.error('定位到标题失败:', error);
                }
            }
            
            // 如果没有标题信息或定位失败，只跳转到文件
            new Notice('✅ 已跳转');
        }
    }

    /**
     * 设置选词模式监听器
     */
    private setupWordSelectionMode(): void {
        let lastSelection = '';
        let lastClipboardText = '';
        let selectionTimeout: NodeJS.Timeout | null = null;
        let clipboardCheckInterval: NodeJS.Timeout | null = null;

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
                clearTimeout(selectionTimeout);
            }

            selectionTimeout = setTimeout(() => {
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
            setTimeout(handleSelection, 150);
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
                    const selectionText = window.getSelection()?.toString() || '';
                    const hasSelection = selectionText.trim().length > 0;
                    
                    // 如果剪贴板内容与当前选择不同，可能是用户复制的新内容
                    const currentSelection = window.getSelection()?.toString() || '';
                    if (clipboardText !== currentSelection) {
                        // 延迟一点，避免与选择事件冲突
                        setTimeout(() => {
                            addTextToInput(clipboardText);
                            lastClipboardText = clipboardText;
                        }, 200);
                    }
                }
            } catch (error) {
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
            setTimeout(() => {
                checkClipboard();
            }, 100);
        };

        // 在文档级别监听鼠标释放事件
        document.addEventListener('mouseup', handleMouseUp);
        
        // 监听复制事件
        document.addEventListener('copy', handleCopy);
        
        // 定期检查剪贴板（作为补充，用于阅读模式）
        if (this.plugin.settings.wordSelectionMode) {
            clipboardCheckInterval = setInterval(() => {
                checkClipboard();
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
                        clipboardCheckInterval = setInterval(() => {
                            checkClipboard();
                        }, 1000);
                    }
                } else {
                    if (clipboardCheckInterval) {
                        clearInterval(clipboardCheckInterval);
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
                clearTimeout(selectionTimeout);
            }
            if (clipboardCheckInterval) {
                clearInterval(clipboardCheckInterval);
            }
        });
    }
}


