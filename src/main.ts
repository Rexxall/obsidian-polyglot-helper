import { inferProvider } from './ai/providers';

/** How a lookup ended; the side panel turns this into its status card. */
export type ProcessOutcome =
	| { status: 'done' }
	| { status: 'empty' }
	| { status: 'cancelled' }
	| { status: 'failed'; error: unknown };

export interface ProcessOptions {
	forceSidebar?: boolean;
	/** The panel shows its own failure card instead of a notice. */
	quiet?: boolean;
	/** Checked before anything is written; a cancelled lookup leaves notes untouched. */
	isCancelled?: () => boolean;
}
import { Editor, MarkdownView, Notice, Plugin, TFile, getLanguage, normalizePath, requestUrl } from 'obsidian';
import { setInterfaceLanguage } from './shared/i18n';
import { PolyglotHelperSettings, HistoryItem, SimpleVocabularyItem } from './types';
import { runEnglishProcess } from './english-processor';
import { chatContent, getChineseTranslationTS } from './apis/llm';

import { Logger } from './shared/Logger';
import { EncryptedSettings } from './shared/EncryptedSettings';
import { JapaneseProcessor } from './japanese-processor';
import { handlePriorityOutput, addQueryToHistory } from './utils';
import { PolyglotHelperView, POLYGLOT_HELPER_VIEW_TYPE } from './view';
import { PolyglotSettingTab } from './settings';
import { getFromCache, saveToCache } from './cache';
import { LearningTracker } from './learning-tracker';
import { SimpleVocabView, SIMPLE_VOCAB_VIEW_TYPE } from './simple-vocab-view';
import { PerformanceOptimizer } from './performance-optimizer';

import { AudioCacheManager } from './audio-cache';
import { CacheManager } from './cache-manager';
import { PolyglotReviewView, POLYGLOT_REVIEW_VIEW_TYPE } from './review-view';
import { ManagementPanelView, MANAGEMENT_PANEL_VIEW_TYPE } from './management-panel';
import { CacheCleanupModal } from './cache-cleanup-modal';
import { LookupPopover, sentenceAround } from './lookup-popover';
import { readLegacyPluginData } from './legacy-migration';
import { collectCards, toAnkiText, toFlashcardNote } from './vocab-export';

import { fire } from './shared/fire';
import { errorMessage } from './shared/errors';
import { tr } from './shared/i18n';
// --- Interfaces and Defaults ---
const DEFAULT_SETTINGS: PolyglotHelperSettings = {
	// General Settings
	outputDestination: 'sidebar',
	newFileLocation: '',
	fixedOutputFile: '',

	// 语言特定路径设置（仅用于固定文件和新文件模式）
	japaneseOutputSettings: {
		newFileLocation: 'Japanese/',
		fixedOutputFile: 'Japanese/日语学习记录.md'
	},
	englishOutputSettings: {
		newFileLocation: 'English/',
		fixedOutputFile: 'English/英语学习记录.md'
	},
	quickTranslationOutputSettings: {
		newFileLocation: 'Translations/',
		fixedOutputFile: 'Translations/快捷翻译记录.md'
	},

	// 快速翻译选项默认值
	quickTranslationOptions: {
		showRomaji: false,
		playAudio: true,
		outputDestination: 'sidebar'
	},

	queryHistory: [],
	forceRefresh: false,

	// UI Settings
	lastSelectedMode: 'quick_to_japanese', // 默认选择快速翻译到日语
	wordSelectionMode: false, // 选词模式：默认关闭
	showDueInStatusBar: true,
	vocabExportFolder: 'Polyglot',

	// Audio Settings
	enableTTS: true,
	audioQuality: 'standard',
	speechRate: 1.0,
	audioStoragePath: 'Audio/Japanese',
	enableAudioCache: true,
	autoPlayAudio: false,

	// API配置管理
	apiConfigs: [
		{
			name: 'DeepSeek',
			provider: 'deepseek',
			apiKey: '',
			baseUrl: 'https://api.deepseek.com/chat/completions',
			model: 'deepseek-flash',
			enabled: true,
		},
	],

	// 功能API选择器
	apiSelectors: {
		quickTranslation: 'DeepSeek',
		englishAnalysis: 'DeepSeek',
		japaneseAnalysis: 'DeepSeek',
	},

	// English Processor Settings
	englishLlmApiKey: '', 
	englishLlmBaseUrl: 'https://openrouter.ai/api/v1/chat/completions',
	englishModelName: 'google/gemini-2.5-flash',
	mwThesaurusKey: '',
	mwMedicalKey: '',
	englishSections: {
		definitions: true,
		example: true,
		usage: true,
		etymology: true,
		medical: true,
		slang: true,
		tatoeba: false,
		idioms: true,
	},
	japaneseSections: {
		vocabAnalysis: true,
		relatedVocab: true,
		sentences: true,
		exercise: true,
		jisho: true,
	},

	// Japanese Processor Settings
	llmProvider: 'openai',
	openaiApiKey: '',
	openaiLlmBaseUrl: '',
	ollamaModel: 'llama3',

	ttsEngine: 'openai',
	
	openaiTtsApiKey: '',
	openaiTtsBaseUrl: '',
	openaiTtsModel: 'tts-1',
	openaiTtsVoice: 'nova',
	openaiTtsSpeed: 1.0,

	youdaoAppKey: '',
	youdaoAppSecret: '',

	// Gemini TTS Settings
	geminiTtsApiKey: '',
	geminiTtsBaseUrl: 'https://api.openai.com/v1',
	geminiTtsModel: 'tts-1',
	geminiTtsVoice: 'Zephyr',
	geminiTtsSpeed: 1.0,

	// Japanese Processor Settings
	japaneseAudioPath: 'Polyglot/Audio/Japanese',
	autoSaveAudio: false,
	forceRefreshAudio: false,
	disableJapaneseVoiceDuringAnalysis: false,

	// 学习进度追踪设置
	enableLearningTracker: false,
	learningStats: {
		dailyStats: {},
		totalWords: 0,
		totalReviews: 0,
		streakDays: 0,
		lastStudyDate: '',
	},

	// 分离的词库
	japaneseVocabItems: {},
	englishVocabItems: {},
	vocabItems: {},
	
	// 简化的词汇库
	simpleVocabulary: {}, // 保留兼容性

	dailyGoal: 10,
	reviewIntervals: [1, 3, 7, 14, 30, 90, 180], // 间隔重复的天数

	// 云同步设置
	cloudSync: {
		enabled: false,
		endpoint: '',
		apiKey: '',
		autoSync: false,
		syncInterval: 60, // 60分钟
		lastSync: 0,
	},

	// 语音识别功能已移除

	// 语音合成功能已移除
}

// Deep copy, so editing settings (e.g. an API key inside apiConfigs) never changes DEFAULT_SETTINGS itself.
export function freshDefaultSettings(): PolyglotHelperSettings {
	return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as PolyglotHelperSettings;
}

// --- Main Plugin Class ---
export default class PolyglotHelper extends Plugin {
	settings: PolyglotHelperSettings;
	logger: Logger;
	secureSettings: EncryptedSettings;
	legacySecureSettings: EncryptedSettings;
	japaneseProcessor: JapaneseProcessor;
	learningTracker: LearningTracker;
	performanceOptimizer: PerformanceOptimizer;
	audioCacheManager: AudioCacheManager;
	cacheManager: CacheManager;

	async onload() {
		setInterfaceLanguage(getLanguage());
		this.secureSettings = new EncryptedSettings({ namespace: 'polyglot-helper', passphrase: this.getDeviceKey() });
		this.legacySecureSettings = new EncryptedSettings({ namespace: 'polyglot-helper' });
		await this.loadSettings();

		// 移动端兼容性：安全获取插件目录
		const pluginDir = this.manifest.dir || '';
		if (!pluginDir) {
			console.warn("Polyglot Helper: this.manifest.dir is undefined, using fallback.");
		}

		// 移动端兼容性：分步初始化，避免复杂的依赖链
		try {
			this.logger = new Logger(this.app.vault.adapter, {
				namespace: 'polyglot-helper',
				file: !!this.settings.debugMode,
				filePath: `${pluginDir}/polyglot-helper.log`,
			});
			console.debug("Polyglot Helper: Logger initialized successfully");
		} catch (error) {
			console.error("Failed to initialize logger:", error);
			new Notice(tr("插件初始化失败：日志系统", "Plugin failed to start: logging"));
			return;
		}

		// 基础初始化
		try {
			this.logger.info("Polyglot Helper plugin starting to load...");
			
			// 移动端兼容性：简化初始化，避免复杂依赖
			if ('ontouchstart' in window) {
				// 移动端：只初始化必要的组件
				this.audioCacheManager = new AudioCacheManager(this.app, this.settings, this.logger);
				this.cacheManager = new CacheManager(this.app, this.logger, pluginDir);
				this.learningTracker = new LearningTracker(this.app, this.settings, this.saveSettings.bind(this));
				
				// 延迟初始化复杂组件
				window.setTimeout(() => {
					try {
						this.performanceOptimizer = new PerformanceOptimizer(this.app, this);
						this.japaneseProcessor = new JapaneseProcessor(this.app, this.settings, this.logger, pluginDir, this.audioCacheManager);
						this.logger.info("Polyglot Helper plugin loaded successfully on mobile.");
					} catch (error) {
						console.warn("Some components failed to initialize on mobile:", error);
					}
				}, 200);
			} else {
				// 桌面端：完整初始化
				this.audioCacheManager = new AudioCacheManager(this.app, this.settings, this.logger);
				this.cacheManager = new CacheManager(this.app, this.logger, pluginDir);
				this.learningTracker = new LearningTracker(this.app, this.settings, this.saveSettings.bind(this));
				this.performanceOptimizer = new PerformanceOptimizer(this.app, this);
				
				window.setTimeout(() => {
					try {
						this.japaneseProcessor = new JapaneseProcessor(this.app, this.settings, this.logger, pluginDir, this.audioCacheManager);
						this.logger.info("Polyglot Helper plugin loaded successfully on desktop.");
						this.performanceOptimizer.warmupCache();
					} catch (error) {
						this.logger.error("Failed to initialize Japanese processor:", error);
					}
				}, 100);
			}
			
		} catch (error) {
			console.error("Failed to initialize core components:", error);
			new Notice(tr("插件初始化失败：核心组件", "Plugin failed to start: core components"));
			return;
		}


		// 注册主视图
        this.registerView(POLYGLOT_REVIEW_VIEW_TYPE, leaf => new PolyglotReviewView(leaf, this, this.learningTracker));

		this.registerView(
			POLYGLOT_HELPER_VIEW_TYPE,
			(leaf) => new PolyglotHelperView(leaf, this)
		);

		// 注册简化词汇库视图
		this.registerView(
			SIMPLE_VOCAB_VIEW_TYPE,
			(leaf) => new SimpleVocabView(leaf, this)
		);

		// 注册管理面板
		this.registerView(
			MANAGEMENT_PANEL_VIEW_TYPE,
			(leaf) => new ManagementPanelView(leaf, this)
		);

		// 添加主视图按钮
		this.addRibbonIcon('book-a', 'Polyglot 助手', () => {
			void this.activateView();
		});

		// 添加管理面板侧边栏按钮
		this.addRibbonIcon('library-big', '打开语言助手管理面板', () => {
			void this.activateManagementPanel();
		});

		this.setupDueStatus();

		// === 查词小卡 ===
		this.addCommand({
			id: 'lookup-popover',
			name: tr('查词小卡（选中的词）', 'Quick word card (selected word)'),
			editorCallback: (editor: Editor, view: MarkdownView) => this.openLookupPopover(editor, view.file),
		});
		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
			const selection = editor.getSelection().trim();
			if (!selection || selection.length > 60 || selection.includes('\n')) return;
			menu.addItem(item => item
				.setTitle(tr('查词小卡', 'Quick word card'))
				.setIcon('book-a')
				.onClick(() => this.openLookupPopover(editor, info.file)));
		}));

		// === 核心翻译功能 ===
		this.addCommand({
			id: 'analyze-english',
			name: tr('英语分析', 'English analysis'),
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const query = editor.getSelection()?.trim();
				if (query) {
					void this.processEnglish(query, this.settings.forceRefresh, view.file, { from: editor.getCursor('from'), to: editor.getCursor('to') });
				} else {
					new Notice(tr("请先选中文本。", "Select some text first."));
				}
			}
		});

		this.addCommand({
			id: 'analyze-japanese',
			name: tr('日语分析', 'Japanese analysis'),
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const query = editor.getSelection()?.trim();
				if (query) {
					void this.processJapanese(query, this.settings.forceRefresh, view.file, { from: editor.getCursor('from'), to: editor.getCursor('to') });
				} else {
					new Notice(tr("请先选中文本。", "Select some text first."));
				}
			}
		});

		// 拆分为两个独立的快速翻译命令
		this.addCommand({
			id: 'quick-translate-to-chinese',
			name: tr('快速翻译 → 汉语', 'Quick translation → Chinese'),
			callback: async () => {
				let text = this.app.workspace.activeEditor?.editor?.getSelection()?.trim();
				if (!text) {
					try {
						text = await navigator.clipboard.readText();
					} catch {
						new Notice(tr("无法读取剪贴板，请先选中文本。", "Cannot read the clipboard; select some text first."));
						return;
					}
				}
				if (!text) {
					new Notice(tr("没有选中文本，剪贴板也为空。", "No text selected and the clipboard is empty."));
					return;
				}
				void this.processQuickEnglish(text, false);
			}
		});

		this.addCommand({
			id: 'quick-translate-to-japanese',
			name: tr('快速翻译 → 日语', 'Quick translation → Japanese'),
			callback: async () => {
				let text = this.app.workspace.activeEditor?.editor?.getSelection()?.trim();
				if (!text) {
					try {
						text = await navigator.clipboard.readText();
					} catch {
						new Notice(tr("无法读取剪贴板，请先选中文本。", "Cannot read the clipboard; select some text first."));
						return;
					}
				}
				if (!text) {
					new Notice(tr("没有选中文本，剪贴板也为空。", "No text selected and the clipboard is empty."));
					return;
				}
				void this.processQuickJapanese(text, false);
			}
		});

		// === 界面工具 ===
		this.addCommand({
			id: 'open-polyglot-panel',
			name: tr('打开助手面板', 'Open the helper panel'),
			callback: () => {
				void this.activateView();
			}
		});

		this.addCommand({
			id: 'open-simple-vocab',
			name: tr('打开词汇库', 'Open the word list'),
			callback: () => {
				void this.activateSimpleVocabView();
			}
		});

		this.addCommand({
			id: 'open-polyglot-tab',
			name: tr('在新标签页打开助手', 'Open the helper in a new tab'),
			callback: () => {
				void this.activateViewInNewTab();
			}
		});

		this.addCommand({
			id: 'toggle-word-selection-mode',
			name: tr('切换选词模式', 'Toggle word-selection mode'),
			callback: async () => {
				this.settings.wordSelectionMode = !this.settings.wordSelectionMode;
				await this.saveSettings();
				new Notice(this.settings.wordSelectionMode ? tr('✅ 选词模式已开启', '✅ Word-selection mode on') : tr('❌ 选词模式已关闭', '❌ Word-selection mode off'));
				
				// 触发设置变化事件，更新UI
				this.app.workspace.trigger('polyglot-settings-change');
			}
		});

		// === 词汇管理 ===
		this.addCommand({
			id: 'add-to-vocabulary',
			name: tr('添加到词汇库', 'Add to word list'),
			editorCallback: async (editor: Editor) => {
				const selection = editor.getSelection()?.trim();
				if (!selection) {
					new Notice(tr("请先选中单词。", "Select a word first."));
					return;
				}

				// 提取单词和翻译（如果有）
				const parts = selection.split(/[：:]/);
				const word = parts[0].trim();
				const translation = parts.length > 1 ? parts[1].trim() : '';

				if (word) {
					if (translation) {
						await this.addSimpleVocabularyItem(word, translation);
						new Notice(tr(`已添加单词 "${word}" 到词汇库。`, `Added "${word}" to the word list.`));
					} else {
						// 如果没有提供翻译，尝试自动翻译
						try {
							const apiConfig = this.getApiConfig('englishAnalysis');
							const result = await getChineseTranslationTS(word, this.settings, this.logger, apiConfig);
							if (result) {
								await this.addSimpleVocabularyItem(word, result);
								new Notice(tr(`已添加单词 "${word}" 到词汇库。`, `Added "${word}" to the word list.`));
							} else {
								new Notice(tr("无法获取翻译，请手动添加。", "Could not get a translation; add it by hand."));
							}
						} catch (e) {
							new Notice("添加单词失败：" + errorMessage(e));
							this.logger.error("添加单词失败", e);
						}
					}
				}
			}
		});

		// === 语音功能 ===
		this.addCommand({
			id: 'play-voice',
			name: tr('播放语音', 'Play pronunciation'),
			editorCallback: async (editor: Editor) => {
				const selectedText = editor.getSelection()?.trim();
				if (!selectedText) {
					new Notice(tr("请先选中要播放的文本", "Select the text to play first"));
					return;
				}

				try {
					new Notice(tr("🎵 正在生成语音...", "🎵 Generating speech..."));
					await this.playJapaneseVoice(selectedText);
				} catch (error) {
					new Notice(tr(`语音播放失败: ${errorMessage(error)}`, `Could not play the audio: ${errorMessage(error)}`));
					this.logger.error("语音播放失败", error);
				}
			}
		});

		// === 系统工具 ===
		this.addCommand({
			id: 'export-vocab-flashcards',
			name: tr('导出词库为闪卡笔记（间隔重复插件格式）', 'Export word list as flashcard notes (Spaced Repetition format)'),
			callback: () => void this.exportVocabulary('flashcards'),
		});

		this.addCommand({
			id: 'export-vocab-anki',
			name: tr('导出词库为 Anki 导入文件', 'Export word list as an Anki import file'),
			callback: () => void this.exportVocabulary('anki'),
		});

		this.addCommand({
			id: 'clear-cache',
			name: tr('清理缓存', 'Clear cache'),
			callback: async () => {
				try {
					await this.clearAllCache();
				} catch (error) {
					new Notice(tr(`❌ 清理缓存失败: ${errorMessage(error)}`, `❌ Could not clear the cache: ${errorMessage(error)}`));
				}
			}
		});

		this.addCommand({
			id: 'smart-cache-cleanup',
			name: tr('智能缓存管理', 'Smart cache management'),
			callback: () => {
				const modal = new CacheCleanupModal(this.app, this.logger, this.manifest.dir || '');
				modal.open();
			}
		});

		this.addSettingTab(new PolyglotSettingTab(this.app, this));
	}

	/**
	 * 在选中的词旁边弹出查词小卡。位置取浏览器选区，取不到时用编辑器光标坐标。
	 */
	openLookupPopover(editor: Editor, file: TFile | null) {
		const word = editor.getSelection().trim();
		if (!word) {
			new Notice(tr('先选中一个词', 'Select a word first'));
			return;
		}
		const from = editor.getCursor('from');
		const sentence = sentenceAround(editor.getLine(from.line), word);
		let rect: DOMRect | null = null;
		const sel = window.getSelection();
		if (sel && sel.rangeCount > 0) {
			const r = sel.getRangeAt(0).getBoundingClientRect();
			if (r.width > 0 || r.height > 0) rect = r;
		}
		if (!rect) {
			// CodeMirror 6：按文档偏移取坐标
			const cm = (editor as unknown as { cm?: { coordsAtPos(pos: number): { left: number; right: number; top: number; bottom: number } | null } }).cm;
			const c = cm?.coordsAtPos(editor.posToOffset(from));
			if (c) rect = new DOMRect(c.left, c.top, Math.max(1, c.right - c.left), c.bottom - c.top);
		}
		if (!rect) rect = new DOMRect(window.innerWidth / 2 - 190, window.innerHeight / 3, 1, 1);
		new LookupPopover(this, word, sentence, rect, file).open();
	}

	/** 查词小卡的“完整词条”：结果固定送到侧栏，不按输出位置去改笔记。 */
	async openFullEntry(word: string, japanese: boolean, file: TFile | null) {
		await this.activateView();
		if (japanese) await this.processJapanese(word, false, file, undefined, { forceSidebar: true });
		else await this.processEnglish(word, false, file, undefined, { forceSidebar: true });
	}

	/** 取某项功能的接口配置；没有可用配置时返回 null。 */
	tryGetApiConfig(functionName: keyof PolyglotHelperSettings['apiSelectors']) {
		try {
			return this.getApiConfig(functionName);
		} catch {
			return null;
		}
	}

	onunload() {
		LookupPopover.close();

		// 清理性能优化器资源
		if (this.performanceOptimizer) {
			this.performanceOptimizer.cleanup();
		}
	}

    async activateReviewView() {
        const leaf = this.app.workspace.getLeavesOfType(POLYGLOT_REVIEW_VIEW_TYPE)[0] || this.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: POLYGLOT_REVIEW_VIEW_TYPE, active: true });
        await this.app.workspace.revealLeaf(leaf);
    }

	async activateView() {
		this.app.workspace.detachLeavesOfType(POLYGLOT_HELPER_VIEW_TYPE);

		const rightLeaf = this.app.workspace.getRightLeaf(false);
        if (rightLeaf) {
		    await rightLeaf.setViewState({
			    type: POLYGLOT_HELPER_VIEW_TYPE,
			    active: true,
		    });
        }

		const leaf = this.app.workspace.getLeavesOfType(POLYGLOT_HELPER_VIEW_TYPE)?.[0];
		if (leaf) {
			void this.app.workspace.revealLeaf(leaf);
		}
	}

	async activateManagementPanel() {
		this.app.workspace.detachLeavesOfType(MANAGEMENT_PANEL_VIEW_TYPE);

		const rightLeaf = this.app.workspace.getRightLeaf(false);
		if (rightLeaf) {
			await rightLeaf.setViewState({
				type: MANAGEMENT_PANEL_VIEW_TYPE,
				active: true,
			});
		}

		const leaf = this.app.workspace.getLeavesOfType(MANAGEMENT_PANEL_VIEW_TYPE)?.[0];
		if (leaf) {
			void this.app.workspace.revealLeaf(leaf);
		}
	}

	async activateSimpleVocabView() {
		this.app.workspace.detachLeavesOfType(SIMPLE_VOCAB_VIEW_TYPE);

		const rightLeaf = this.app.workspace.getRightLeaf(false);
        if (rightLeaf) {
		    await rightLeaf.setViewState({
			    type: SIMPLE_VOCAB_VIEW_TYPE,
			    active: true,
		    });
        }

		const leaf = this.app.workspace.getLeavesOfType(SIMPLE_VOCAB_VIEW_TYPE)?.[0];
		if (leaf) {
			void this.app.workspace.revealLeaf(leaf);
		}
	}

	async activateViewInNewTab() {
		// 创建新的标签页而不是使用侧边栏
		const leaf = this.app.workspace.getLeaf('tab');
		if (leaf) {
			await leaf.setViewState({
				type: POLYGLOT_HELPER_VIEW_TYPE,
				active: true,
			});
			void this.app.workspace.revealLeaf(leaf);
		}
	}



	// 统一面板功能已移除

	async processEnglish(query: string, force: boolean, file: TFile | null, selection?: { from: { line: number, ch: number }, to: { line: number, ch: number } }, opts: ProcessOptions = {}): Promise<ProcessOutcome> {
		try {
			if (!this.manifest.dir) {
				new Notice(tr("致命错误：找不到插件目录。", "Fatal error: plugin folder not found."));
				return { status: 'failed', error: new Error('plugin folder missing') };
			}

			// 获取英语分析的API配置
			const apiConfig = this.getApiConfig('englishAnalysis');
			const result = await runEnglishProcess(query, force, this.settings, this.logger, this.app, this.manifest.dir, this.saveSettings.bind(this), apiConfig);
			if (opts.isCancelled?.()) return { status: 'cancelled' };
			if (!result) return { status: 'empty' };
			{
				// 使用优先级输出处理：侧边栏选择优先，固定文件和新文件时使用语言特定路径
				const outputInfo = await handlePriorityOutput(
					this.app,
					{
						outputDestination: opts.forceSidebar ? 'sidebar' : this.settings.outputDestination,
						newFileLocation: this.settings.newFileLocation,
						fixedOutputFile: this.settings.fixedOutputFile
					},
					this.settings.englishOutputSettings,
					this.logger,
					query,
					result,
					file?.path || '',
					selection
				);
				
				// 添加查询记录，包含输出位置信息
				await addQueryToHistory(
					this.settings, 
					this.saveSettings.bind(this), 
					{ query, type: 'english', sections: { ...this.settings.englishSections }, timestamp: Date.now() },
					outputInfo
				);
				
				// 智能提取英语词汇并添加到英语词汇库
				if (this.settings.enableLearningTracker && this.settings.autoAddToVocab) {
					await this.extractAndAddEnglishVocab(query, result);
				}
				return { status: 'done' };
			}
		} catch (e) {
			if (!opts.quiet) new Notice(tr(`处理失败: ${errorMessage(e)}`, `Failed: ${errorMessage(e)}`));
			this.logger.error("Error in processEnglish", e);
			return { status: 'failed', error: e };
		}
	}

	async processJapanese(query: string, force: boolean, file: TFile | null, selection?: { from: { line: number, ch: number }, to: { line: number, ch: number } }, opts: ProcessOptions = {}): Promise<ProcessOutcome> {
		if (!this.manifest.dir) {
			this.logger.error("插件目录未定义，无法处理日语。");
			new Notice(tr("致命错误：插件目录未找到。", "Fatal error: plugin folder not found."));
			return { status: 'failed', error: new Error('plugin folder missing') };
		}
		
		try {
			// 获取日语分析的API配置
			const apiConfig = this.getApiConfig('japaneseAnalysis');
			const resultObj = await this.japaneseProcessor.runJapaneseProcess(query, force, apiConfig, this.saveSettings.bind(this), file?.path);
			if (opts.isCancelled?.()) return { status: 'cancelled' };
			if (!resultObj) return { status: 'empty' };

			{
				const { original, colloquial, markdown } = resultObj;
				
				// 检查是否是批量处理的结果（批量处理时每个单词/短语都已经单独处理了）
				if (markdown.includes('已处理') && markdown.includes('个日语单词/短语')) {
					// 批量处理完成，不需要再输出或添加查询历史
					return { status: 'done' };
				}
				
				// 单行处理的情况
				// --- NEW LOGIC TO GET TITLE ---
				// 1. Try to get "基本形" (basic form) from the markdown.
				const kihonkeiMatch = markdown.match(/> - \*\*基本形:\*\* (.*)/);
				let titlePart = kihonkeiMatch ? kihonkeiMatch[1].trim() : null;

				// 2. If no basic form, try to get the **bolded** part from the colloquial sentence.
				if (!titlePart) {
					const colloquialBoldMatch = colloquial.match(/\*\*(.*?)\*\*/);
					// 3. Fallback to the full colloquial sentence if no bolded part is found.
					titlePart = colloquialBoldMatch ? colloquialBoldMatch[1] : colloquial;
				}

				// New header format
				const header = `## ${original} - ${titlePart}`;

				const finalResult = `${header}\n\n${markdown}`;

				// 缓存逻辑已在 JapaneseProcessor 内部处理

				// 使用优先级输出处理：侧边栏选择优先，固定文件和新文件时使用语言特定路径
				const outputInfo = await handlePriorityOutput(
					this.app,
					{
						outputDestination: opts.forceSidebar ? 'sidebar' : this.settings.outputDestination,
						newFileLocation: this.settings.newFileLocation,
						fixedOutputFile: this.settings.fixedOutputFile
					},
					this.settings.japaneseOutputSettings,
					this.logger,
					query,
					finalResult,
					file?.path ?? '',
					selection
				);

				// 添加查询记录，包含输出位置信息
				await addQueryToHistory(
					this.settings, 
					this.saveSettings.bind(this), 
					{ query: query, type: 'japanese', sections: { ...this.settings.japaneseSections }, timestamp: Date.now() },
					outputInfo
				);

				// 智能提取日语词汇并添加到日语词汇库
				if (this.settings.enableLearningTracker && this.settings.autoAddToVocab) {
					await this.extractAndAddJapaneseVocab(query, finalResult);
				}

				// 播放日语语音（尊重“生成语音”开关）
				if (!this.settings.disableJapaneseVoiceDuringAnalysis) {
					try {
						await this.playJapaneseVoice(original, this.settings.forceRefreshAudio);
					} catch (error) {
						this.logger.warn('播放日语语音失败', error);
					}
				}
				return { status: 'done' };
			}
		} catch (e) {
			this.logger.error("处理日语时出错", e);
			if (!opts.quiet) new Notice(tr(`处理失败: ${errorMessage(e)}`, `Failed: ${errorMessage(e)}`));
			return { status: 'failed', error: e };
		}
	}

	async processQuickEnglish(query: string, force: boolean) {
		try {
			// 使用性能优化器进行翻译
			const result = await this.performanceOptimizer.optimizedTranslation(query, {
				type: 'english',
				force
			});

			if (result) {
				const markdownResult = `## ${query}\n\n${result}`;

				if (this.manifest.dir) {
					await saveToCache(this.app, this.manifest.dir, 'english', `quick_${query}`, markdownResult);
				}

				this.logger.info(`快捷翻译成功: ${query} -> ${result}`);

				// 获取当前活动文件路径
				const activeFile = this.app.workspace.getActiveFile();
				const filePath = activeFile?.path;

				// 使用优先级输出处理：侧边栏选择优先，固定文件和新文件时使用语言特定路径
				const outputInfo = await handlePriorityOutput(
					this.app,
					{
						outputDestination: this.settings.outputDestination,
						newFileLocation: this.settings.newFileLocation,
						fixedOutputFile: this.settings.fixedOutputFile
					},
					this.settings.quickTranslationOutputSettings,
					this.logger,
					query,
					markdownResult,
					filePath || ''
				);

				// 添加查询记录，包含输出位置信息
				await addQueryToHistory(
					this.settings, 
					this.saveSettings.bind(this), 
					{ query, type: 'quick_english', sections: {}, timestamp: Date.now(), translation: result },
					outputInfo
				);

				// 直接在侧边栏显示结果（使用专门的快速翻译显示方法）
				const view = this.app.workspace.getLeavesOfType(POLYGLOT_HELPER_VIEW_TYPE)[0]?.view;
				if (view instanceof PolyglotHelperView) {
					view.displayQuickTranslationResult(query, result, false, "→汉");
				}
			}
		} catch (e) {
			new Notice(tr(`翻译失败: ${errorMessage(e)}`, `Translation failed: ${errorMessage(e)}`));
			this.logger.error("Error in processQuickEnglish", e);
		}
	}

	async processQuickEnglishWithTargetFile(query: string, force: boolean, targetFile: TFile | null) {
		try {
			// 使用性能优化器进行翻译
			const result = await this.performanceOptimizer.optimizedTranslation(query, {
				type: 'english',
				force
			});

			if (result) {
				const markdownResult = `## ${query}\n\n${result}`;

				if (this.manifest.dir) {
					await saveToCache(this.app, this.manifest.dir, 'english', `quick_${query}`, markdownResult);
				}

				this.logger.info(`快捷翻译成功: ${query} -> ${result}`);

				// 使用锁定的目标文件路径
				const filePath = targetFile?.path;

				// 使用优先级输出处理：侧边栏选择优先，固定文件和新文件时使用语言特定路径
				const outputInfo = await handlePriorityOutput(
					this.app,
					{
						outputDestination: this.settings.outputDestination,
						newFileLocation: this.settings.newFileLocation,
						fixedOutputFile: this.settings.fixedOutputFile
					},
					this.settings.quickTranslationOutputSettings,
					this.logger,
					query,
					markdownResult,
					filePath || ''
				);

				// 添加查询记录，包含输出位置信息
				await addQueryToHistory(
					this.settings, 
					this.saveSettings.bind(this), 
					{ query, type: 'quick_english', sections: {}, timestamp: Date.now(), translation: result },
					outputInfo
				);
			}
		} catch (e) {
			new Notice(tr(`翻译失败: ${errorMessage(e)}`, `Translation failed: ${errorMessage(e)}`));
			this.logger.error("Error in processQuickEnglishWithTargetFile", e);
		}
	}

	async processQuickJapanese(query: string, force: boolean) {
		// 创建一个持续的处理状态提示
		const processingNotice = new Notice(tr("🔄 正在翻译并生成语音...", "🔄 Translating and generating speech..."), 0);

		try {
			// 检查API配置
			const { englishLlmApiKey, englishLlmBaseUrl, ttsEngine } = this.settings;
			if (!englishLlmApiKey || !englishLlmBaseUrl) {
				processingNotice.hide();
				new Notice(tr("❌ 请先在设置中配置 LLM 的 API 密钥和接口地址", "❌ Add an AI key and endpoint in settings first"));
				return;
			}

			// 与分析一致：先取缓存，未命中再处理
			let quick: { translation: string; reading?: string; romaji?: string; audioFilePath?: string | null } | null = null;
			if (!force && this.manifest.dir) {
				quick = await getFromCache<{ translation: string; reading?: string; romaji?: string; audioFilePath?: string | null }>(
					this.app,
					this.manifest.dir,
					'japanese',
					`quick_${query}`
				);
			}

			let japaneseTranslation: string | null = quick?.translation || null;
			if (!japaneseTranslation) {
				// 使用之前稳定流程获取翻译与读音
				const rich = await this.translateToJapaneseRich(query);
				japaneseTranslation = rich?.jp || await this.translateToJapanese(query);
				// 获取纯假名读音，并优先使用 LLM 提供的 romaji
				let reading: string | null = await this.getJapaneseReading(japaneseTranslation || '');
				const romajiFromLLM: string | undefined = rich?.romaji || undefined;
				// 写入缓存（与日语分析使用的同一子目录/键）
				if (japaneseTranslation && this.manifest.dir) {
					await saveToCache(
						this.app,
						this.manifest.dir,
						'japanese',
						`quick_${query}`,
						{ translation: japaneseTranslation, reading: (reading || ''), romaji: romajiFromLLM || '', audioFilePath: null }
					);
				}
				quick = { translation: japaneseTranslation!, reading: (reading || ''), romaji: romajiFromLLM || '', audioFilePath: null };
			}

			if (japaneseTranslation) {
				// 预先计算罗马音（若开启）：优先用 LLM 输出的 romaji
				let precomputedRomaji: string | undefined;
				if (this.settings.quickTranslationOptions?.showRomaji) {
					if (quick?.romaji && quick.romaji.trim().length > 0) {
						precomputedRomaji = quick.romaji.trim();
					} else {
						let kana = (quick?.reading && quick.reading.trim().length > 0) ? quick.reading : '';
						if (!/^[\u3040-\u30FF\s]+$/.test(kana)) {
							try {
								const readingNow = await this.getJapaneseReading(japaneseTranslation);
								if (readingNow && readingNow.trim().length > 0) {
									kana = readingNow;
									// 回写缓存以便下次直接使用纯假名
									if (this.manifest.dir) {
										await saveToCache(this.app, this.manifest.dir, 'japanese', `quick_${query}`, { translation: japaneseTranslation, reading: readingNow, romaji: '', audioFilePath: null });
									}
								}
							} catch {
								// 取读音失败时退回用译文本身转罗马音
							}
						}
						const { kanaToRomaji } = await import('./utils');
						precomputedRomaji = kanaToRomaji(kana && kana.trim().length > 0 ? kana : japaneseTranslation);
					}
				}

				// 构建Markdown结果（与侧边栏一致）
				const useRomaji = (this.settings.quickTranslationOptions?.showRomaji ?? false) && !!precomputedRomaji && precomputedRomaji.trim().length > 0;
				const header = `### ${query} - ${japaneseTranslation}${useRomaji ? ` （${precomputedRomaji}）` : ''}`;
				const markdownResult = `${header}\n---\n`;

				// 获取当前活动文件路径
				const activeFile = this.app.workspace.getActiveFile();
				const filePath = activeFile?.path;

				// 使用优先级输出处理
				const outputInfo = await handlePriorityOutput(
					this.app,
					{
						outputDestination: this.settings.outputDestination,
						newFileLocation: this.settings.newFileLocation,
						fixedOutputFile: this.settings.fixedOutputFile
					},
					this.settings.quickTranslationOutputSettings,
					this.logger,
					query,
					markdownResult,
					filePath || ''
				);

				// 添加查询记录，包含输出位置信息和罗马音
				await addQueryToHistory(
					this.settings, 
					this.saveSettings.bind(this), 
					{ 
						query, 
						type: 'quick_to_japanese', 
						sections: {}, 
						timestamp: Date.now(), 
						translation: japaneseTranslation,
						romaji: precomputedRomaji
					},
					outputInfo
				);

				// 不论是否需要音频，先显示文本结果
				processingNotice.hide();
				new Notice(tr(`✅ 翻译完成: ${query} → ${japaneseTranslation}`, `✅ Translated: ${query} → ${japaneseTranslation}`));

				// 直接在侧边栏显示结果（使用专门的快速翻译显示方法）
				const view = this.app.workspace.getLeavesOfType(POLYGLOT_HELPER_VIEW_TYPE)[0]?.view;
				if (view instanceof PolyglotHelperView) {
					view.displayQuickTranslationResult(query, japaneseTranslation, false, "→日", precomputedRomaji);
				}

				// 如果开启了"快速翻译播放音频"开关，则后台生成并播放语音
				if (this.settings.quickTranslationOptions?.playAudio) {
					// 异步后台生成并播放
					window.setTimeout(fire(async () => {
						try {
							// 检查TTS配置
							if (ttsEngine === 'openai' && (!this.settings.openaiTtsApiKey || !this.settings.openaiTtsBaseUrl)) return;
							if (ttsEngine === 'youdao' && (!this.settings.youdaoAppKey || !this.settings.youdaoAppSecret)) return;
							
							await this.playJapaneseVoice(japaneseTranslation ?? '', this.settings.forceRefreshAudio);
						} catch (error) {
							console.error('Quick JP voice generation failed:', error);
						}
					}), 100);
				}
			} else {
				processingNotice.hide();
				new Notice(tr("❌ 翻译失败", "❌ Translation failed"));
			}
		} catch (error) {
			processingNotice.hide();
			this.logger.error("快捷日语翻译失败", error);
			new Notice(tr(`翻译失败: ${errorMessage(error)}`, `Translation failed: ${errorMessage(error)}`));
		}
	}

	async processQuickJapaneseWithTargetFile(query: string, force: boolean, targetFile: TFile | null) {
		// 获取快速翻译的API配置
		const apiConfig = this.getApiConfig('quickTranslation');
		const result = await this.japaneseProcessor.runQuickJapaneseTranslation(query, force, apiConfig);
		if (result) {
			let markdownResult = `### ${result.translation}\n**读音:** ${result.reading}`;
			if (result.audioFilePath) {
				const encodedPath = result.audioFilePath.split('/').map(part => encodeURIComponent(part)).join('/');
				markdownResult += `\n\n<audio src="${encodedPath}" controls style="height: 30px; width: 100%;"></audio>`;
			}

			if (this.manifest.dir) {
				await saveToCache(this.app, this.manifest.dir, 'japanese', `quick_${query}`, markdownResult);
			}

			this.logger.info(`快捷翻译成功: ${query} -> ${result.translation}`);

			// 使用锁定的目标文件路径
			const filePath = targetFile?.path;

			// 使用优先级输出处理：侧边栏选择优先，固定文件和新文件时使用语言特定路径
			const outputInfo = await handlePriorityOutput(
				this.app,
				{
					outputDestination: this.settings.outputDestination,
					newFileLocation: this.settings.newFileLocation,
					fixedOutputFile: this.settings.fixedOutputFile
				},
				this.settings.quickTranslationOutputSettings,
				this.logger,
				query,
				markdownResult,
				filePath || ''
			);

			// 添加查询记录，包含输出位置信息
			await addQueryToHistory(
				this.settings, 
				this.saveSettings.bind(this), 
				{ query, type: 'quick_to_japanese', sections: {}, timestamp: Date.now(), translation: result.translation },
				outputInfo
			);
		}
		// Errors are handled inside runQuickJapaneseTranslation
	}

	/**
	 * 智能提取英语词汇并添加到词汇库
	 */
	private async extractAndAddEnglishVocab(query: string, result: string): Promise<void> {
		try {
			// 提取主要单词（去除短语中的介词等）
			const word = query.trim().split(/\s+/)[0].toLowerCase();

			// 从结果中提取音标
			const phoneticMatch = result.match(/\[([^\]]+)\]|\/([^/]+)\//);
			const phonetics = phoneticMatch ? (phoneticMatch[1] || phoneticMatch[2]) : '';

			// 提取词性
			const posMatch = result.match(/\*\*词性[：:]\*\*\s*([^\n]+)/);
			const partOfSpeech = posMatch ? posMatch[1].trim() : '';

			// 提取主要中文翻译
			const translationMatch = result.match(/\*\*中文释义[：:]\*\*\s*([^\n]+)/);
			let translation = translationMatch ? translationMatch[1].trim() : '';

			// 如果没有找到标准格式，尝试其他模式
			if (!translation) {
				const altMatch = result.match(/[一-龥]{2,}[、，；：。！？]*[一-龥]*/);
				translation = altMatch ? altMatch[0] : '';
			}

			// 提取定义
			const definitions: string[] = [];
			const defMatches = result.match(/\d+\.\s*([^\n]+)/g);
			if (defMatches) {
				defMatches.forEach(match => {
					const def = match.replace(/^\d+\.\s*/, '').trim();
					if (def) definitions.push(def);
				});
			}

			// 提取例句
			const examples: string[] = [];
			const exampleMatches = result.match(/例句[：:]?\s*([^\n]+)/g);
			if (exampleMatches) {
				exampleMatches.forEach(match => {
					const example = match.replace(/例句[：:]?\s*/, '').trim();
					if (example) examples.push(example);
				});
			}

			if (word && translation) {
				await this.learningTracker.addEnglishVocabularyItem(
					word,
					translation,
					phonetics,
					partOfSpeech,
					definitions,
					'', // notes
					examples,
					['auto-added'] // tags
				);
				new Notice(tr(`✅ 已添加英语单词 "${word}" 到词汇库`, `✅ Added the English word "${word}" to the word list`));
			}
		} catch (error) {
			this.logger.error('提取英语词汇失败', error);
		}
	}

	/**
	 * 智能提取日语词汇并添加到词汇库
	 */
	private async extractAndAddJapaneseVocab(originalText: string, result: string): Promise<void> {
		try {
			// 从结果中提取日语文本
			const japaneseMatch = result.match(/## (.+?) -/);
			const japaneseText = japaneseMatch ? japaneseMatch[1].trim() : originalText;

			// 提取读音
			const readingMatch = result.match(/\*\*读音[：:]\*\*\s*([^\n]+)/);
			const reading = readingMatch ? readingMatch[1].trim() : '';

			// 提取翻译
			const translationMatch = result.match(/\*\*中文翻译[：:]\*\*\s*([^\n]+)/);
			let translation = translationMatch ? translationMatch[1].trim() : '';

			// 如果没有找到标准格式，尝试其他模式
			if (!translation) {
				const altMatch = result.match(/[一-龥]{2,}[、，；：。！？]*[一-龥]*/);
				translation = altMatch ? altMatch[0] : '';
			}

			// 提取例句
			const examples: string[] = [];
			const exampleMatches = result.match(/例句[：:]?\s*([^\n]+)/g);
			if (exampleMatches) {
				exampleMatches.forEach(match => {
					const example = match.replace(/例句[：:]?\s*/, '').trim();
					if (example) examples.push(example);
				});
			}

			if (japaneseText && translation) {
				await this.learningTracker.addJapaneseVocabularyItem(
					originalText, // 原文作为标题
					japaneseText, // 日文作为复习单词
					reading,
					translation,
					'', // notes
					examples,
					['auto-added'] // tags
				);
				new Notice(tr(`✅ 已添加日语词汇 "${originalText}" 到词汇库`, `✅ Added the Japanese entry "${originalText}" to the word list`));
			}
		} catch (error) {
			this.logger.error('提取日语词汇失败', error);
		}
	}

	/**
	 * 通用翻译方法（供性能优化器调用）
	 */
	async translateText(text: string, options: { type?: string; force?: boolean } = {}): Promise<string | null> {
		const { type = 'auto' } = options;

		try {
			// 使用新的API配置系统
			const apiConfig = this.getApiConfig('quickTranslation');

			if (type === 'japanese' || this.isJapanese(text)) {
				// 对于日语翻译，使用简化的API调用
				const prompt_content = `Translate the following Japanese text to Chinese. Provide only the translation, without any explanations, introductory phrases, or extra text. The output should be the Chinese text and nothing else.

Japanese text: "${text}"`;

				const messages = [
					{ "role": "system", "content": "You are a highly efficient translation engine. You only output the translated Chinese text, with no additional content." },
					{ "role": "user", "content": prompt_content }
				];

				const response = await requestUrl({
					url: apiConfig.baseUrl,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${apiConfig.apiKey}`
					},
					body: JSON.stringify({
						model: apiConfig.model,
						messages: messages,
						temperature: 0.0,
					})
				});

				if (response.status === 200) {
					return chatContent(response).trim();
				} else {
					this.logger.error(`Translation API request failed with status ${response.status}`, { response: response.text });
					return null;
				}
			} else {
				// 对于英语翻译，使用简化的API调用
				const prompt_content = `Translate the following English text to Chinese. Provide only the translation, without any explanations, introductory phrases, or extra text. The output should be the Chinese text and nothing else.

English text: "${text}"`;

				const messages = [
					{ "role": "system", "content": "You are a highly efficient translation engine. You only output the translated Chinese text, with no additional content." },
					{ "role": "user", "content": prompt_content }
				];

				const response = await requestUrl({
					url: apiConfig.baseUrl,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${apiConfig.apiKey}`
					},
					body: JSON.stringify({
						model: apiConfig.model,
						messages: messages,
						temperature: 0.0,
					})
				});

				if (response.status === 200) {
					return chatContent(response).trim();
				} else {
					this.logger.error(`Translation API request failed with status ${response.status}`, { response: response.text });
					return null;
				}
			}
		} catch (error) {
			this.logger.error('翻译失败', error);
			return null;
		}
	}

	/**
	 * 检测是否为日语文本
	 */
	private isJapanese(text: string): boolean {
		const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
		return japaneseRegex.test(text);
	}

	/**
	 * 测试TTS音频生成（供设置页面调用）
	 */
	async testTtsAudio(text: string): Promise<ArrayBuffer | null> {
		try {
			const { getTtsAudioTS } = await import('./apis/tts');
			return await getTtsAudioTS(text, this.settings, this.logger);
		} catch (error) {
			this.logger.error('TTS测试失败', error);
			throw error;
		}
	}

	/**
	 * 获取指定功能的API配置
	 */
	private getApiConfig(functionName: keyof typeof this.settings.apiSelectors) {
		const selectedConfigName = this.settings.apiSelectors[functionName];
		const config = this.settings.apiConfigs.find(c => c.name === selectedConfigName && c.enabled);

		if (!config) {
			// 回退到第一个启用的配置
			const fallbackConfig = this.settings.apiConfigs.find(c => c.enabled);
			if (!fallbackConfig) {
				throw new Error('没有可用的API配置，请在设置中配置并启用至少一个API');
			}
			return fallbackConfig;
		}

		return config;
	}

	/**
	 * 将任意语言翻译成日语
	 */
	async translateToJapanese(inputText: string): Promise<string | null> {
		try {
			// 使用新的API配置系统
			const apiConfig = this.getApiConfig('quickTranslation');

			if (!apiConfig.apiKey || !apiConfig.baseUrl) {
				this.logger.error("无法执行翻译，因为缺少 LLM API Key 或 Base URL。");
				throw new Error('LLM API配置不完整，请检查API密钥和Base URL');
			}

			const prompt_content = `Translate the following text to Japanese. Automatically detect the source language and provide only the Japanese translation, without any explanations, introductory phrases, or extra text. The output should be the Japanese text and nothing else.

Input text: "${inputText}"`;

			const messages = [
				{ "role": "system", "content": "You are a highly efficient translation engine. You automatically detect the source language and only output the translated Japanese text, with no additional content." },
				{ "role": "user", "content": prompt_content }
			];

			const response = await requestUrl({
				url: apiConfig.baseUrl,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiConfig.apiKey}`
				},
				body: JSON.stringify({
					model: apiConfig.model,
					messages: messages,
					temperature: 0.0, // Set to 0 for deterministic translation
				})
			});

			if (response.status === 200) {
				let translation = chatContent(response).trim();
				// 语言校验：必须包含日文字符（平假名/片假名/汉字），否则重试一次
				const hasJapanese = /[\u3040-\u30FF\u4E00-\u9FFF]/.test(translation);
				if (!hasJapanese) {
					const strictPrompt = `次のテキストを日本語に翻訳してください。出力は日本語のみ（アルファベットを含めない）で、説明や前置きは一切不要です。\n\n入力: "${inputText}"`;
					const strictMessages = [
						{ "role": "system", "content": "あなたは高精度の翻訳エンジンです。出力は日本語のみです。" },
						{ "role": "user", "content": strictPrompt }
					];

					const retry = await requestUrl({
						url: apiConfig.baseUrl,
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': `Bearer ${apiConfig.apiKey}`
						},
						body: JSON.stringify({ model: apiConfig.model, messages: strictMessages, temperature: 0.0 })
					});
					if (retry.status === 200) {
						translation = chatContent(retry).trim();
					}
				}
				this.logger.info('翻译成功', { original: inputText, translation });
				return translation;
			} else {
				this.logger.error(`Translation API request failed with status ${response.status}`, { response: response.text });
				throw new Error(`翻译API请求失败 (${response.status})`);
			}
		} catch (error) {
			this.logger.error('翻译失败', {
				error: errorMessage(error),
				text: inputText,
				apiConfigured: !!(this.settings.englishLlmApiKey && this.settings.englishLlmBaseUrl)
			});
			throw error;
		}
	}

	/**
	 * 快速翻译（带罗马音）：强约束模型按 JSON 输出 { jp: "...", romaji: "..." }
	 */
	async translateToJapaneseRich(inputText: string): Promise<{ jp: string; romaji?: string } | null> {
		try {
			const apiConfig = this.getApiConfig('quickTranslation');
			if (!apiConfig.apiKey || !apiConfig.baseUrl) return null;

			const prompt = `Translate the following text to Japanese. Detect the source language automatically. Return a strict JSON object with two fields only: {"jp":"<Japanese>", "romaji":"<romaji>"}. Do not add any extra text, code fences, or explanations.\n\nInput: "${inputText}"`;
			const messages = [
				{ role: 'system', content: 'You are a precise translation engine. Output STRICT JSON ONLY.' },
				{ role: 'user', content: prompt }
			];

			// 要求 JSON 输出（支持 OpenAI 兼容）
			const body = { model: apiConfig.model, messages, temperature: 0.0, response_format: { type: 'json_object' } };

			const res = await requestUrl({
				url: apiConfig.baseUrl,
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
				body: JSON.stringify(body)
			});

			if (res.status === 200) {
				let raw = chatContent(res).trim();
				try {
					// 去掉围栏
					raw = raw.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1');
					const data = JSON.parse(raw) as { jp?: unknown; romaji?: unknown } | null;
					if (typeof data?.jp === 'string') return { jp: data.jp.trim(), romaji: typeof data.romaji === 'string' ? data.romaji.trim() : undefined };
				} catch {
					// 模型没按 JSON 回答，交给调用方走普通翻译
				}
			}
			return null;
		} catch (e) {
			this.logger.error('translateToJapaneseRich failed', e);
			return null;
		}
	}

	/**
	 * 获取日语假名读音（かな）。输入为日文句子或词语，输出仅包含平假名/片假名。
	 */
	async getJapaneseReading(japaneseText: string): Promise<string | null> {
		try {
			const apiConfig = this.getApiConfig('quickTranslation');
			if (!apiConfig.apiKey || !apiConfig.baseUrl) return null;

			const prompt = `以下の日本語の語句/文について、読み（かな）だけを返してください。記号や説明は不要。かな以外は含めないでください。\n\n入力: "${japaneseText}"`;
			const messages = [
				{ role: 'system', content: 'あなたは日本語の読み仮名変換器です。出力はかな（ひらがな/カタカナ）のみです。' },
				{ role: 'user', content: prompt }
			];

			const res = await requestUrl({
				url: apiConfig.baseUrl,
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
				body: JSON.stringify({ model: apiConfig.model, messages, temperature: 0.0 })
			});
			if (res.status === 200) {
				const kana = chatContent(res).trim();
				// 仅保留假名
				if (/^[\u3040-\u30FF\s]+$/.test(kana)) return kana;
				return kana.replace(/[^\u3040-\u30FF\s]/g, '').trim() || null;
			}
			return null;
		} catch (e) {
			this.logger.error('获取日语读音失败', e);
			return null;
		}
	}

	/**
	 * 播放日语语音
	 */
	async playJapaneseVoice(japaneseText: string, forceRefresh: boolean = false): Promise<void> {
		try {
			this.logger.info(`播放日语语音: "${japaneseText}"`);

			// 使用统一的音频缓存管理器
			const audioDir = this.settings.japaneseAudioPath || "Audio/Japanese";
			const audioFilePath = await this.audioCacheManager.getOrCreateAudio(japaneseText, audioDir, forceRefresh);

			if (audioFilePath) {
				// 读取音频文件并播放
				const audioFile = this.app.vault.getAbstractFileByPath(audioFilePath);
				if (audioFile && audioFile instanceof TFile) {
					const audioBuffer = await this.app.vault.readBinary(audioFile);
					const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
					const audioUrl = URL.createObjectURL(audioBlob);
					const audio = new Audio(audioUrl);

					// 移动端兼容性：设置音频属性
					audio.preload = 'auto';
					audio.controls = false;
					
					// 移动端兼容性：处理播放错误
					audio.addEventListener('error', (e) => {
						console.error('Audio playback error:', e);
						URL.revokeObjectURL(audioUrl);
					});

					audio.addEventListener('ended', () => {
						URL.revokeObjectURL(audioUrl);
					});

					// 移动端兼容性：尝试播放，如果失败则提示用户
					try {
						await audio.play();
						this.logger.info(`✅ 语音播放成功: "${japaneseText}"`);
					} catch (playError) {
						console.warn('Audio play failed, might need user interaction:', playError);
						// 移动端可能需要用户交互才能播放音频
						if ('ontouchstart' in window) {
							new Notice(tr('请在移动端点击播放按钮来播放语音', 'On mobile, tap the play button to hear it'));
							// 创建一个播放按钮
							this.createMobileAudioPlayer(audio, japaneseText, audioUrl);
						} else {
							throw playError;
						}
					}
				} else {
					throw new Error('音频文件不存在');
				}
			} else {
				throw new Error('无法生成语音');
			}
		} catch (error) {
			this.logger.error('日语语音播放失败', error);
			throw error;
		}
	}

	/**
	 * 创建移动端音频播放器
	 */
	private createMobileAudioPlayer(audio: HTMLAudioElement, text: string, audioUrl: string): void {
		// 创建一个临时的播放按钮
		const playButton = createEl('button');
		playButton.textContent = tr(`🔊 播放: ${text}`, `🔊 Playing: ${text}`);
		playButton.className = 'polyglot-mobile-play';

		playButton.addEventListener('click', fire(async () => {
			try {
				await audio.play();
				playButton.remove();
				new Notice(tr(`🎵 正在播放: ${text}`, `🎵 Playing: ${text}`));
			} catch (error) {
				console.error('Mobile audio play failed:', error);
				new Notice(tr('❌ 音频播放失败', '❌ Could not play the audio'));
			}
		}));

		// 5秒后自动移除按钮
		window.setTimeout(() => {
			if (playButton.parentNode) {
				playButton.remove();
				URL.revokeObjectURL(audioUrl);
			}
		}, 5000);

		document.body.appendChild(playButton);
	}

	/**
	 * 播放英语语音
	 */
	async playEnglishVoice(englishText: string, forceRefresh: boolean = false): Promise<void> {
		try {
			this.logger.info(`播放英语语音: "${englishText}"`);

			// 使用TTS API直接生成音频
			const { getTtsAudioTS } = await import('./apis/tts');
			const audioBuffer = await getTtsAudioTS(englishText, this.settings, this.logger);

			if (audioBuffer) {
				const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
				const audioUrl = URL.createObjectURL(audioBlob);
				const audio = new Audio(audioUrl);

				// 移动端兼容性：设置音频属性
				audio.preload = 'auto';
				audio.controls = false;
				
				// 移动端兼容性：处理播放错误
				audio.addEventListener('error', (e) => {
					console.error('Audio playback error:', e);
					URL.revokeObjectURL(audioUrl);
				});

				audio.addEventListener('ended', () => {
					URL.revokeObjectURL(audioUrl);
				});

				// 移动端兼容性：尝试播放，如果失败则提示用户
				try {
					await audio.play();
					this.logger.info(`✅ 英语语音播放成功: "${englishText}"`);
				} catch (playError) {
					console.warn('Audio play failed, might need user interaction:', playError);
					// 移动端可能需要用户交互才能播放音频
					if ('ontouchstart' in window) {
						new Notice(tr('请在移动端点击播放按钮来播放语音', 'On mobile, tap the play button to hear it'));
						// 创建一个播放按钮
						this.createMobileAudioPlayer(audio, englishText, audioUrl);
					} else {
						throw playError;
					}
				}
			} else {
				throw new Error('无法生成英语语音');
			}
		} catch (error) {
			this.logger.error('英语语音播放失败', error);
			throw error;
		}
	}



	async getCachedResult(item: HistoryItem): Promise<string | null> {
        if (!this.manifest.dir) return null;

		let cacheKey: string;
        let subfolder: 'english' | 'japanese' = 'english';
		let sectionsToUse: HistoryItem['sections'];

		// Fallback for old history items that don't have `sections` property.
		if (item.sections === undefined) {
			sectionsToUse = item.type === 'japanese' 
				? this.settings.japaneseSections 
				: this.settings.englishSections;
		} else {
			sectionsToUse = item.sections;
		}

        switch (item.type) {
            case 'english':
			case 'japanese': {
				const activeSections = Object.entries(sectionsToUse || {})
                    .filter(([, isActive]) => isActive)
                    .map(([key]) => key)
                    .join(',');
                cacheKey = `${item.query}-${activeSections}`;
				if (item.type === 'japanese') subfolder = 'japanese';
                break;
			}
            case 'quick_english':
                cacheKey = `quick_${item.query}`;
                break;

            default:
				this.logger.info(`Unknown history item type: ${String((item as { type?: unknown }).type)}`);
                return null;
        }

		this.logger.info(`[Caching] Getting with key: ${cacheKey}`);

		if (item.type === 'japanese') {
			// 日语分析缓存的是对象格式，需要特殊处理
			const cachedResult = await getFromCache<{ original?: string; markdown?: string; colloquial?: string }>(this.app, this.manifest.dir, subfolder, cacheKey);
			if (cachedResult && cachedResult.original && cachedResult.markdown) {
				// 重新构建完整的结果格式
				const kihonkeiMatch = cachedResult.markdown.match(/> - \*\*基本形:\*\* (.*)/);
				let titlePart = kihonkeiMatch ? kihonkeiMatch[1].trim() : null;
				if (!titlePart) {
					const colloquialBoldMatch = cachedResult.colloquial?.match(/\*\*(.*?)\*\*/);
					titlePart = colloquialBoldMatch ? colloquialBoldMatch[1] : (cachedResult.colloquial ?? null);
				}

				const header = `## ${cachedResult.original} - ${titlePart}`;
				return `${header}\n\n${cachedResult.markdown}`;
			}
			return null;
		} else {
			// 英语分析缓存的是字符串格式
			return getFromCache<string>(this.app, this.manifest.dir, subfolder, cacheKey);
		}
	}

	async loadSettings() {
		let stored: unknown = await this.loadData();
		if (!stored) {
			const legacy = await readLegacyPluginData(this.app.vault.adapter, this.app.vault.configDir, this.manifest.dir);
			if (legacy) {
				stored = legacy.data;
				await this.saveData(legacy.data);
				new Notice(tr(`Polyglot Helper：已从旧版插件目录（${legacy.dir}）导入设置和词库。确认无误后可在第三方插件里停用并删除旧版。`, `Polyglot Helper: settings and word list imported from the old plugin folder (${legacy.dir}). Once everything looks right, disable and delete the old version under Community plugins.`), 12000);
			}
		}
		this.settings = Object.assign(freshDefaultSettings(), stored);

		// Decrypt API keys loaded from disk
		await this.decryptSensitiveFields();

		// Versions up to 1.3.x shipped an OpenRouter host that does not resolve.
		const brokenHost = 'https://api.openrouter.ai/';
		let repaired = false;
		for (const config of this.settings.apiConfigs) {
			if (config.baseUrl?.startsWith(brokenHost)) {
				config.baseUrl = config.baseUrl.replace(brokenHost, 'https://openrouter.ai/');
				repaired = true;
			}
		}
		if (this.settings.englishLlmBaseUrl?.startsWith(brokenHost)) {
			this.settings.englishLlmBaseUrl = this.settings.englishLlmBaseUrl.replace(brokenHost, 'https://openrouter.ai/');
			repaired = true;
		}
		// 1.7: every configuration names its provider preset, inferred from the endpoint.
		for (const config of this.settings.apiConfigs) {
			if (!config.provider) {
				config.provider = inferProvider(config.baseUrl || '');
				repaired = true;
			}
		}
		if (repaired) this.settingsNeedSave = true;

		// One-time migration: if plain text API keys exist, encrypt and re-save
		if (await this.needsEncryptionMigration()) {
			await this.saveSettings();
		}

		// 确保分离词库字段存在
		if (!this.settings.japaneseVocabItems) {
			this.settings.japaneseVocabItems = {};
		}
		if (!this.settings.englishVocabItems) {
			this.settings.englishVocabItems = {};
		}

		// 迁移现有词汇数据到分离的词库
		if (this.settings.vocabItems && Object.keys(this.settings.vocabItems).length > 0) {
			let migrated = false;

			for (const [key, item] of Object.entries(this.settings.vocabItems)) {
				// 检查是否是日语词汇（包含日文字符或假名）
				const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(item.word || '');

				if (hasJapanese) {
					// 迁移到日语词库
					if (!this.settings.japaneseVocabItems[key]) {
						this.settings.japaneseVocabItems[key] = {
							originalText: item.word || '',
							japaneseText: item.translation || '',
							reading: '',
							translation: item.translation || '',
							notes: item.notes || '',
							tags: item.tags || [],
							reviewCount: item.reviewCount || 0,
							lastReviewed: item.lastReviewed || 0,
							nextReview: item.nextReview || 0,
							difficulty: item.difficulty || 0,
							createdAt: item.addedAt || Date.now(),
							reviewHistory: []
						};
						migrated = true;
					}
				} else {
					// 迁移到英语词库
					if (!this.settings.englishVocabItems[key]) {
						this.settings.englishVocabItems[key] = {
							word: item.word || '',
							translation: item.translation || '',
							phonetics: '',
							partOfSpeech: '',
							notes: item.notes || '',
							tags: item.tags || [],
							reviewCount: item.reviewCount || 0,
							lastReviewed: item.lastReviewed || 0,
							nextReview: item.nextReview || 0,
							difficulty: item.difficulty || 0,
							createdAt: item.addedAt || Date.now(),
							reviewHistory: []
						};
						migrated = true;
					}
				}
			}

			// 如果有迁移，保存设置
			if (migrated) {
				await this.saveSettings();
				console.debug('Polyglot: 词汇数据已迁移到分离的词库');
			}
		}
	}

	async saveSettings() {
		const storageCopy = await this.encryptSensitiveFields();
		await this.saveData(storageCopy);
		this.updateDueStatus();
		this.app.workspace.trigger('polyglot-settings-change');
	}

	private dueStatusEl: HTMLElement | null = null;

	/** 状态栏的“待复习 N”：复习、加词都会经过 saveSettings，所以在那里刷新；另每 10 分钟刷新一次以跟上到期时间。 */
	private setupDueStatus() {
		this.dueStatusEl = this.addStatusBarItem();
		this.dueStatusEl.addClass('polyglot-due-status', 'mod-clickable');
		this.dueStatusEl.setAttr('aria-label', '打开 Polyglot 复习');
		this.dueStatusEl.setAttr('data-tooltip-position', 'top');
		this.registerDomEvent(this.dueStatusEl, 'click', () => void this.activateReviewView());
		this.registerInterval(window.setInterval(() => this.updateDueStatus(), 10 * 60 * 1000));
		this.updateDueStatus();
	}

	private updateDueStatus() {
		const el = this.dueStatusEl;
		if (!el || !this.learningTracker) return;
		const due = this.learningTracker.getDueCounts().total;
		const visible = this.settings.showDueInStatusBar !== false && this.settings.enableLearningTracker && due > 0;
		el.toggle(visible);
		if (visible) el.setText(tr(`待复习 ${due}`, `${due} to review`));
	}

	/** 把英语、日语词库导出成 Spaced Repetition 闪卡笔记或 Anki 导入文本。 */
	async exportVocabulary(format: 'flashcards' | 'anki') {
		const cards = collectCards(this.settings.englishVocabItems || {}, this.settings.japaneseVocabItems || {});
		if (cards.length === 0) {
			new Notice(tr('词库是空的，先查几个词再导出', 'The word list is empty; look up a few words first'));
			return;
		}
		const folder = normalizePath(this.settings.vocabExportFolder?.trim() || 'Polyglot');
		const path = normalizePath(`${folder}/${format === 'flashcards' ? '词库闪卡.md' : '词库-Anki.txt'}`);
		const { vault } = this.app;
		if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
		const existing = vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await vault.process(existing, previous => format === 'flashcards' ? toFlashcardNote(cards, previous) : toAnkiText(cards));
		} else {
			await vault.create(path, format === 'flashcards' ? toFlashcardNote(cards) : toAnkiText(cards));
		}
		new Notice(tr(`已导出 ${cards.length} 张卡片到 ${path}`, `Exported ${cards.length} cards to ${path}`));
		if (format === 'flashcards') {
			const file = vault.getAbstractFileByPath(path);
			if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
		}
	}

	// ── Encrypted settings helpers ──

	private readonly ENCRYPTED_FLAT_FIELDS = ['englishLlmApiKey', 'openaiApiKey', 'openaiTtsApiKey', 'youdaoAppKey', 'youdaoAppSecret', 'geminiTtsApiKey', 'mwThesaurusKey', 'mwMedicalKey'];

	/** Key material lives in this device's local storage, never in data.json. */
	private getDeviceKey(): string {
		const id = 'polyglot-helper-device-key';
		const saved: unknown = this.app.loadLocalStorage(id);
		if (typeof saved === 'string' && saved.length >= 32) return saved;
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		const key = btoa(String.fromCharCode(...bytes));
		this.app.saveLocalStorage(id, key);
		return key;
	}

	private settingsNeedSave = false;

	private async decryptOne(value: string): Promise<string> {
		try {
			return await this.secureSettings.decryptValue(value);
		} catch {
			try {
				const plain = await this.legacySecureSettings.decryptValue(value);
				this.settingsNeedSave = true;
				return plain;
			} catch {
				this.settingsNeedSave = true;
				new Notice(tr('语言助手：本设备读不出已保存的 API 密钥，请在设置中重新填写。', 'Polyglot Helper: this device cannot read the saved API keys. Enter them again in settings.'));
				return '';
			}
		}
	}

	private async decryptSensitiveFields() {
		const es = this.secureSettings;
		if (!es) return;
		for (const key of this.ENCRYPTED_FLAT_FIELDS) {
			const fields = this.settings as unknown as Record<string, unknown>;
			const val = fields[key];
			if (typeof val === 'string' && es.isEncryptedValue(val)) {
				fields[key] = await this.decryptOne(val);
			}
		}
		for (const config of this.settings.apiConfigs) {
			if (typeof config.apiKey === 'string' && es.isEncryptedValue(config.apiKey)) {
				config.apiKey = await this.decryptOne(config.apiKey);
			}
		}
		if (this.settings.cloudSync?.apiKey && es.isEncryptedValue(this.settings.cloudSync.apiKey)) {
			this.settings.cloudSync.apiKey = await this.decryptOne(this.settings.cloudSync.apiKey);
		}
	}

	private async needsEncryptionMigration(): Promise<boolean> {
		const es = this.secureSettings;
		if (!es) return false;
		if (this.settingsNeedSave) return true;
		for (const key of this.ENCRYPTED_FLAT_FIELDS) {
			const val = (this.settings as unknown as Record<string, unknown>)[key];
			if (typeof val === 'string' && val.length > 0 && !es.isEncryptedValue(val)) return true;
		}
		for (const config of this.settings.apiConfigs) {
			if (typeof config.apiKey === 'string' && config.apiKey.length > 0 && !es.isEncryptedValue(config.apiKey)) return true;
		}
		return false;
	}

	private async encryptSensitiveFields(): Promise<PolyglotHelperSettings> {
		const es = this.secureSettings;
		const copy = { ...this.settings };
		if (!es) return copy;
		for (const key of this.ENCRYPTED_FLAT_FIELDS) {
			const fields = copy as unknown as Record<string, unknown>;
			const val = fields[key];
			if (typeof val === 'string' && val.length > 0 && !es.isEncryptedValue(val)) {
				fields[key] = await es.encryptValue(val);
			}
		}
		copy.apiConfigs = await Promise.all(copy.apiConfigs.map(async config => ({
			...config,
			apiKey: (typeof config.apiKey === 'string' && config.apiKey.length > 0 && !es.isEncryptedValue(config.apiKey))
				? await es.encryptValue(config.apiKey) : config.apiKey,
		})));
		if (copy.cloudSync?.apiKey && !es.isEncryptedValue(copy.cloudSync.apiKey)) {
			copy.cloudSync = { ...copy.cloudSync, apiKey: await es.encryptValue(copy.cloudSync.apiKey) };
		}
		return copy;
	}

	async resetSettings() {
		this.settings = freshDefaultSettings();
		await this.saveSettings();
	}

	/**
	 * 清理翻译缓存（文本缓存）
	 */
	async clearTranslationCache() {
		if (this.manifest.dir) {
			try {
				// 清理主缓存目录
				const cacheDir = `${this.manifest.dir}/.cache`;
				const cacheExists = await this.app.vault.adapter.exists(cacheDir);
				if (cacheExists) {
					await this.app.vault.adapter.rmdir(cacheDir, true);
					this.logger.info(`翻译缓存目录已清理: ${cacheDir}`);
				}

				// 清理旧的voice-cache目录（如果存在）
				const voiceCacheDir = `${this.manifest.dir}/voice-cache`;
				const voiceCacheExists = await this.app.vault.adapter.exists(voiceCacheDir);
				if (voiceCacheExists) {
					await this.app.vault.adapter.rmdir(voiceCacheDir, true);
					this.logger.info(`旧语音缓存目录已清理: ${voiceCacheDir}`);
				}

				// 清理根目录下的voice-cache（如果存在）
				const rootVoiceCacheDir = "voice-cache";
				const rootVoiceCacheExists = await this.app.vault.adapter.exists(rootVoiceCacheDir);
				if (rootVoiceCacheExists) {
					await this.app.vault.adapter.rmdir(rootVoiceCacheDir, true);
					this.logger.info(`根目录语音缓存已清理: ${rootVoiceCacheDir}`);
				}

				// 清理性能优化器的内存缓存
				this.performanceOptimizer.clearCache();
				this.logger.info('翻译缓存已清理');
				new Notice(tr("✅ 翻译缓存已清理", "✅ Translation cache cleared"));
			} catch (error) {
				this.logger.error('清理翻译缓存失败', error);
				new Notice(tr("❌ 清理翻译缓存失败", "❌ Could not clear the translation cache"));
			}
		}
	}

	/**
	 * 清理音频文件缓存
	 */
	async clearAudioCache() {
		try {
			// 清理内存中的音频缓存
			this.audioCacheManager.clearCache();

			// 清理音频文件目录
			const audioDir = this.settings.japaneseAudioPath || "Audio/Japanese";
			const exists = await this.app.vault.adapter.exists(audioDir);
			if (exists) {
				await this.app.vault.adapter.rmdir(audioDir, true);
				this.logger.info(`音频文件缓存已清理: ${audioDir}`);
			}

			// 清理其他可能的音频目录
			const possibleAudioDirs = [
				"Audio/Japanese",
				"Polyglot/Audio/Japanese",
				"40 - Obsidian/附件/Audio/Japanese",
				this.settings.japaneseAudioPath
			].filter(Boolean);

			for (const dir of possibleAudioDirs) {
				if (dir && dir !== audioDir) {
					const dirExists = await this.app.vault.adapter.exists(dir);
					if (dirExists) {
						await this.app.vault.adapter.rmdir(dir, true);
						this.logger.info(`清理额外音频目录: ${dir}`);
					}
				}
			}

			new Notice(tr("✅ 音频缓存已清理", "✅ Audio cache cleared"));
		} catch (error) {
			this.logger.error('清理音频缓存失败', error);
			new Notice(tr("❌ 清理音频缓存失败", "❌ Could not clear the audio cache"));
		}
	}

	/**
	 * 清理所有缓存（翻译 + 音频）
	 */
	async clearAllCache() {
		try {
			await this.clearTranslationCache();
			await this.clearAudioCache();
			new Notice(tr("✅ 所有缓存已清理", "✅ All caches cleared"));
		} catch (error) {
			this.logger.error('清理所有缓存失败', error);
			new Notice(tr("❌ 清理缓存失败", "❌ Could not clear the cache"));
		}
	}

	// 保持向后兼容
	async clearCache() {
		await this.clearAllCache();
	}

	/**
	 * 获取缓存统计信息
	 */
	getCacheStats() {
		return {
			fileCache: this.getFileCacheStats(),
			memoryCache: this.performanceOptimizer.getCacheStats(),
			audioCache: this.audioCacheManager.getCacheStats()
		};
	}

	/**
	 * 获取文件缓存统计
	 */
	async getFileCacheStats(): Promise<{ size: number; files: number }> {
		if (!this.manifest.dir) {
			return { size: 0, files: 0 };
		}

		const cacheDir = `${this.manifest.dir}/.cache`;
		try {
			const files = await this.app.vault.adapter.list(cacheDir);
			let totalSize = 0;
			let fileCount = 0;

			for (const file of files.files) {
				try {
					const stat = await this.app.vault.adapter.stat(file);
					if (stat) {
						totalSize += stat.size;
						fileCount++;
					}
				} catch {
					// 忽略单个文件的错误
				}
			}

			return { size: totalSize, files: fileCount };
		} catch {
			return { size: 0, files: 0 };
		}
	}

	/**
	 * 清理过期缓存
	 */
	async clearExpiredCache(maxAgeHours: number = 24): Promise<void> {
		if (!this.manifest.dir) return;

		const cacheDir = `${this.manifest.dir}/.cache`;
		const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
		let deletedCount = 0;

		try {
			const files = await this.app.vault.adapter.list(cacheDir);

			for (const file of files.files) {
				try {
					const stat = await this.app.vault.adapter.stat(file);
					if (stat && stat.mtime < cutoffTime) {
						await this.app.vault.adapter.remove(file);
						deletedCount++;
					}
				} catch {
					// 忽略单个文件的错误
				}
			}

			new Notice(tr(`✅ 已清理 ${deletedCount} 个过期缓存文件`, `✅ Removed ${deletedCount} expired cache files`));
		} catch {
			new Notice(tr("❌ 清理过期缓存失败", "❌ Could not remove expired cache files"));
		}
	}

	/**
	 * 简化的词汇库管理 - 添加词汇项
	 */
	async addSimpleVocabularyItem(word: string, translation: string, notes?: string): Promise<void> {
		// 初始化简化的词汇库
		if (!this.settings.simpleVocabulary) {
			this.settings.simpleVocabulary = {};
		}

		// 添加或更新词汇项
		this.settings.simpleVocabulary[word] = {
			word,
			translation,
			notes: notes || '',
			createdAt: Date.now(),
			lastReviewed: Date.now(),
			reviewCount: 0,
			isFavorite: false
		};

		await this.saveSettings();
	}

	/**
	 * 获取简化的词汇库
	 */
	getSimpleVocabulary(): Record<string, SimpleVocabularyItem> {
		return this.settings.simpleVocabulary || {};
	}

	/**
	 * 删除词汇项
	 */
	async removeSimpleVocabularyItem(word: string): Promise<void> {
		if (this.settings.simpleVocabulary && this.settings.simpleVocabulary[word]) {
			delete this.settings.simpleVocabulary[word];
			await this.saveSettings();
		}
	}
}