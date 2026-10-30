import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import PolyglotHelper from "./main";
// clearCache已移除
import { Notice, requestUrl } from 'obsidian';
import { ApiConfig, EnglishSections, PolyglotHelperSettings } from "./types";
import { PROVIDERS, normalizeEndpoint, presetFor, testConnection } from './ai/providers';
import { tr } from './shared/i18n';

import { fire } from './shared/fire';
import { errorMessage } from './shared/errors';
import type { CacheItem, CacheManager } from './cache-manager';

import { confirmAction } from './shared/confirm-modal';
import { watchSettingGroups } from './shared/setting-groups';
import { SETTINGS_SEARCH_TERMS } from './settings-search';
/** 智能缓存清理面板在几个方法之间共用的状态。 */
interface CleanupState {
	allItems: CacheItem[];
	filteredItems: CacheItem[];
	selectedItems: Set<string>;
	filter: { type: string; days: string; size: string; pattern: string };
	cacheManager: CacheManager;
	statsDiv?: HTMLElement;
	listDiv?: HTMLElement;
	selectAllCheckbox?: HTMLInputElement;
}

export class PolyglotSettingTab extends PluginSettingTab {
	plugin: PolyglotHelper;
	private currentTab: string = 'general';

	constructor(app: App, plugin: PolyglotHelper) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** 上次画到哪里：1.13 以前是 containerEl，1.13 起是设置清单里的那一行 */
	private host: HTMLElement | null = null;

	/**
	 * Obsidian 1.13 起按这份清单画设置页并建立搜索索引。设置页沿用自己的分页布局：
	 * 一行画整页，所有设置名作为搜索别名。
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [{
			name: tr('语言助手设置', 'Polyglot Helper settings'),
			desc: tr('输出、翻译与模型、语音、学习、缓存和高级选项', 'Output, translation and models, speech, learning, cache and advanced options'),
			aliases: SETTINGS_SEARCH_TERMS,
			render: (setting) => {
				const host = setting.settingEl;
				host.className = 'polyglot-settings-host';
				this.renderPage(host);
			},
		}];
	}

	display(): void {
		this.renderPage(this.containerEl);
	}

	private redraw() {
		if (this.host) this.renderPage(this.host);
	}

	/** Stops keeping the group corners current once the page is closed. */
	private stopGroupMarks: (() => void) | null = null;

	hide(): void {
		this.stopGroupMarks?.();
		this.stopGroupMarks = null;
	}

	private renderPage(containerEl: HTMLElement): void {
		this.host = containerEl;
		containerEl.empty();
		containerEl.addClass('ap', 'ap-settings', 'polyglot-settings');

		// 创建标签页导航
		this.createTabNavigation(containerEl);

		// 创建内容容器
		const contentContainer = containerEl.createDiv({ cls: 'polyglot-settings-content' });

		// 根据当前标签页显示内容
		this.displayTabContent(contentContainer);

		this.stopGroupMarks?.();
		this.stopGroupMarks = watchSettingGroups(containerEl);
	}

	private createTabNavigation(containerEl: HTMLElement) {
		const tabNav = containerEl.createDiv({ cls: 'polyglot-tab-navigation' });

		const tabs = [
			{ id: 'general', name: tr('输出与保存', 'Output'), icon: '🔧' },
			{ id: 'translation', name: tr('翻译与模型', 'Translation and models'), icon: '🌐' },
			{ id: 'audio', name: tr('语音', 'Speech'), icon: '🎵' },
			{ id: 'ui', name: tr('学习与界面', 'Learning and interface'), icon: '🎨' },
			{ id: 'cache', name: tr('缓存', 'Cache'), icon: '🗑️' },
			{ id: 'advanced', name: tr('高级', 'Advanced'), icon: '⚙️' }
		];

		tabs.forEach(tab => {
			const tabButton = tabNav.createEl('button', {
				cls: `polyglot-tab-button ${this.currentTab === tab.id ? 'active' : ''}`,
				text: tab.name
			});

			tabButton.addEventListener('click', () => {
				// 移除所有活动状态
				tabNav.querySelectorAll('.polyglot-tab-button').forEach(btn =>
					btn.removeClass('active')
				);

				// 设置当前按钮为活动状态
				tabButton.addClass('active');
				this.currentTab = tab.id;

				// 重新显示内容
				const contentContainer = containerEl.querySelector('.polyglot-settings-content') as HTMLElement;
				if (contentContainer) {
					contentContainer.empty();
					this.displayTabContent(contentContainer);
				}
			});
		});
	}

	private displayTabContent(containerEl: HTMLElement) {
		switch (this.currentTab) {
			case 'general':
				this.displayGeneralSettings(containerEl);
				break;
			case 'translation':
				this.displayTranslationSettings(containerEl);
				break;
			case 'audio':
				this.displayAudioSettings(containerEl);
				break;
			case 'ui':
				this.displayUISettings(containerEl);
				break;
			case 'cache':
				this.displayCacheSettings(containerEl);
				break;
			case 'advanced':
				this.displayAdvancedSettings(containerEl);
				break;
		}
	}

	private displayGeneralSettings(containerEl: HTMLElement) {
		new Setting(containerEl).setName(tr('输出与保存', 'Output')).setHeading();

		new Setting(containerEl)
			.setName(tr('自动添加到词汇库', 'Add to the word list automatically'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoAddToVocab || false)
				.onChange(async (value) => {
					this.plugin.settings.autoAddToVocab = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(tr('选词模式', 'Word-selection mode'))
			.setDesc(tr('选中的词会自动填进侧栏输入框。', 'Selected words go into the side panel input.'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.wordSelectionMode || false)
				.onChange(async (value) => {
					this.plugin.settings.wordSelectionMode = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(tr('复习提醒', 'Review reminders'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.reviewReminder || false)
				.onChange(async (value) => {
					this.plugin.settings.reviewReminder = value;
					await this.plugin.saveSettings();
				}));

		// --- 输出位置设置 ---
		new Setting(containerEl).setName(tr('输出位置', 'Output location')).setHeading();


		new Setting(containerEl)
			.setName(tr('默认输出位置', 'Default output location'))
			.setDesc(tr('侧栏里的选择优先于这里。', 'The choice in the side panel takes precedence.'))
			.addDropdown(dropdown => dropdown
				.addOption('sidebar', tr('侧边栏', 'Side panel'))
				.addOption('newFile', tr('创建新文件', 'New file'))
				.addOption('appendCurrent', tr('追加到当前文件', 'Append to current file'))
				.addOption('replace', tr('替换选中内容', 'Replace selection'))
				.addOption('fixedFile', tr('固定文件', 'Fixed file'))
				.setValue(this.plugin.settings.outputDestination)
				.onChange(async (value: 'sidebar' | 'newFile' | 'appendCurrent' | 'replace' | 'fixedFile') => {
					this.plugin.settings.outputDestination = value;
					await this.plugin.saveSettings();
					this.redraw();
				}));

		if (this.plugin.settings.outputDestination === 'newFile') {
			new Setting(containerEl)
				.setName(tr('通用新文件存放位置', 'Default folder for new files'))
				.setDesc(tr('当输出位置为"创建新文件"且未设置语言特定路径时使用。', 'Used for "New file" when no language-specific folder is set.'))
				.addText(text => text
					.setPlaceholder(tr('例如: Notes/', 'For example Notes/'))
					.setValue(this.plugin.settings.newFileLocation)
					.onChange(async (value) => {
						this.plugin.settings.newFileLocation = value;
						await this.plugin.saveSettings();
					}));
		}

		if (this.plugin.settings.outputDestination === 'fixedFile') {
			new Setting(containerEl)
				.setName(tr('通用固定输出文件', 'Default fixed output file'))
				.setDesc(tr('当输出位置为"固定文件"且未设置语言特定路径时使用。', 'Used for "Fixed file" when no language-specific file is set.'))
				.addText(text => text
					.setPlaceholder(tr('例如: Notes/学习记录.md', 'For example Notes/Study log.md'))
					.setValue(this.plugin.settings.fixedOutputFile)
					.onChange(async (value) => {
						this.plugin.settings.fixedOutputFile = value;
						await this.plugin.saveSettings();
					}));
		}

		// --- 快速翻译专属设置 ---
		new Setting(containerEl).setName(tr('快速翻译', 'Quick translation')).setHeading();
		new Setting(containerEl)
			.setName(tr('快速翻译：罗马音标注', 'Quick translation: romaji'))
			.setDesc(tr('只对日语文本生效。', 'Japanese text only.'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.quickTranslationOptions?.showRomaji ?? false)
				.onChange(async (value) => {
					this.plugin.settings.quickTranslationOptions = this.plugin.settings.quickTranslationOptions || { showRomaji: false, playAudio: true, outputDestination: 'sidebar' };
					this.plugin.settings.quickTranslationOptions.showRomaji = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(tr('快速翻译：播放音频', 'Quick translation: play audio'))
			.setDesc(tr('开启后，快速翻译会在显示文本后后台生成音频并播放。', 'When on, quick translation generates and plays audio after showing the text.'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.quickTranslationOptions?.playAudio ?? true)
				.onChange(async (value) => {
					this.plugin.settings.quickTranslationOptions = this.plugin.settings.quickTranslationOptions || { showRomaji: false, playAudio: true, outputDestination: 'sidebar' };
					this.plugin.settings.quickTranslationOptions.playAudio = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(tr('快速翻译：输出位置', 'Quick translation: output location'))
			.addDropdown(dropdown => dropdown
				.addOption('sidebar', tr('侧边栏', 'Side panel'))
				.addOption('newFile', tr('创建新文件', 'New file'))
				.addOption('appendCurrent', tr('追加到当前文件', 'Append to current file'))
				.addOption('replace', tr('替换选中内容', 'Replace selection'))
				.addOption('fixedFile', tr('固定文件', 'Fixed file'))
				.setValue(this.plugin.settings.quickTranslationOptions?.outputDestination ?? 'sidebar')
				.onChange(async (value: 'sidebar' | 'newFile' | 'appendCurrent' | 'replace' | 'fixedFile') => {
					this.plugin.settings.quickTranslationOptions = this.plugin.settings.quickTranslationOptions || { showRomaji: false, playAudio: true, outputDestination: 'sidebar' };
					this.plugin.settings.quickTranslationOptions.outputDestination = value;
					await this.plugin.saveSettings();
				}));

		// --- 语言特定路径设置 ---
		new Setting(containerEl).setName(tr('语言特定路径', 'Language-specific paths')).setHeading();

		containerEl.createDiv({
			cls: 'polyglot-setting-description',
			text: tr('只在输出到“固定文件”或“创建新文件”时使用；留空用上面的路径。', 'Used only for "Fixed file" and "New file"; empty uses the paths above.'),
		});

		// 日语特定路径设置
		this.createLanguagePathSettings(containerEl, tr('日语分析', 'Japanese analysis'), 'japaneseOutputSettings');

		// 英语特定路径设置
		this.createLanguagePathSettings(containerEl, tr('英语分析', 'English analysis'), 'englishOutputSettings');

		// 快捷翻译特定路径设置
		this.createLanguagePathSettings(containerEl, tr('快捷翻译', 'Quick translation'), 'quickTranslationOutputSettings');
	}

	/** 一套 AI 配置：服务商、密钥、接口地址、模型分开填，可以单独测试。 */
	private renderApiConfigCard(containerEl: HTMLElement, config: ApiConfig, index: number) {
		const card = containerEl.createDiv({ cls: 'api-config-container' });
		const save = () => this.plugin.saveSettings();
		const preset = presetFor(config.provider);

		const head = new Setting(card)
			.setName(config.name)
			.setDesc(
				config.apiKey
					? tr(`${preset.label} · ${config.model || '未填模型'} · 已填密钥`, `${preset.label} · ${config.model || 'no model'} · key set`)
					: tr(`${preset.label} · 还没有密钥`, `${preset.label} · no key yet`),
			)
			.setHeading()
			.addToggle((toggle) =>
				toggle
					.setTooltip(tr('启用这套配置', 'Use this configuration'))
					.setValue(config.enabled)
					.onChange(async (value) => {
						config.enabled = value;
						await save();
						this.redraw();
					}),
			);
		if (this.plugin.settings.apiConfigs.length > 1) {
			head.addExtraButton((button) =>
				button
					.setIcon('trash')
					.setTooltip(tr('删除这套配置', 'Delete this configuration'))
					.onClick(async () => {
						const confirmed = await confirmAction(
							this.app,
							tr(`确定要删除“${config.name}”吗？`, `Delete "${config.name}"?`),
							tr('删除', 'Delete'),
						);
						if (!confirmed) return;
						this.plugin.settings.apiConfigs.splice(index, 1);
						await save();
						this.redraw();
					}),
			);
		}

		new Setting(card)
			.setName(tr('服务商', 'Provider'))
			.setDesc(tr('选好后自动填接口地址和默认模型。', 'Fills in the endpoint and default model.'))
			.addDropdown((dropdown) => {
				for (const option of PROVIDERS) dropdown.addOption(option.id, option.label);
				dropdown.setValue(preset.id).onChange(async (value) => {
					const next = presetFor(value);
					config.provider = next.id;
					if (next.id !== 'custom') {
						config.baseUrl = next.endpoint;
						config.model = next.model;
					}
					await save();
					this.redraw();
				});
			});

		const keySetting = new Setting(card)
			.setName(tr('密钥', 'API key'))
			.addText((text) => {
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
				text.setPlaceholder(tr('粘贴服务商给的密钥', "Paste the provider's key"))
					.setValue(config.apiKey)
					.onChange(async (value) => {
						config.apiKey = value.trim();
						await save();
					});
			});
		if (preset.keyUrl) {
			const desc = keySetting.descEl;
			desc.appendText(tr('在这里申请：', 'Get one here: '));
			desc.createEl('a', { text: preset.label, href: preset.keyUrl });
		}

		new Setting(card)
			.setName(tr('接口地址', 'Endpoint'))
			.setDesc(tr('只填到 /v1 也可以，会自动补全。', 'A base URL ending in /v1 is fine; the rest is added.'))
			.addText((text) =>
				text
					.setPlaceholder(tr('例如 https://api.deepseek.com', 'For example https://api.deepseek.com'))
					.setValue(config.baseUrl)
					.onChange(async (value) => {
						config.baseUrl = normalizeEndpoint(value);
						await save();
					}),
			);

		new Setting(card)
			.setName(tr('模型', 'Model'))
			.addText((text) =>
				text
					.setPlaceholder(preset.model || 'model-name')
					.setValue(config.model)
					.onChange(async (value) => {
						config.model = value.trim();
						await save();
					}),
			);

		const result = card.createDiv({ cls: 'ph-test-result' });
		new Setting(card)
			.setName(tr('测试连接', 'Test connection'))
			.setDesc(
				tr(
					'发一次只有几个字的请求，确认密钥、地址和模型都能用。会产生不到一分钱的费用。',
					'Sends one request of a few words to check the key, endpoint and model. It costs a tiny fraction of a cent.',
				),
			)
			.addButton((button) =>
				button.setButtonText(tr('测试', 'Test')).onClick(async () => {
					button.setDisabled(true);
					result.empty();
					result.removeClass('is-ok', 'is-error');
					result.setText(tr('测试中…', 'Testing…'));
					const outcome = await testConnection(config, async (request) => {
						const response = await requestUrl({ ...request, throw: false });
						return { status: response.status, text: response.text };
					});
					result.empty();
					if (outcome.ok) {
						result.addClass('is-ok');
						result.setText(tr(`能用，用时 ${outcome.ms} 毫秒。`, `Works, ${outcome.ms} ms.`));
					} else {
						result.addClass('is-error');
						result.createEl('strong', { text: outcome.message });
						result.createSpan({ text: ` ${outcome.fix}` });
					}
					button.setDisabled(false);
				}),
			);
		// 结果显示在按钮那一行下面
		card.appendChild(result);

		new Setting(card)
			.setName(tr('配置名称', 'Name'))
			.setDesc(tr('下面“各功能用哪套”按这个名字选。', 'Used when choosing a configuration for each feature below.'))
			.addText((text) =>
				text.setValue(config.name).onChange(async (value) => {
					const name = value.trim();
					if (!name) return;
					for (const key of Object.keys(this.plugin.settings.apiSelectors) as (keyof PolyglotHelperSettings['apiSelectors'])[]) {
						if (this.plugin.settings.apiSelectors[key] === config.name) {
							this.plugin.settings.apiSelectors[key] = name;
						}
					}
					config.name = name;
					await save();
				}),
			);
	}

	private displayTranslationSettings(containerEl: HTMLElement) {
		new Setting(containerEl).setName(tr('AI 服务', 'AI services')).setHeading();
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: tr(
				'查词典和读音不需要 AI。翻译和分析要填一个 AI 密钥；密钥加密存在这台设备上，换设备要重新填。',
				'Dictionary lookups and pronunciation need no AI. Translation and analysis need an AI key, stored encrypted on this device; enter it again on another device.',
			),
		});

		this.plugin.settings.apiConfigs.forEach((config, index) => {
			this.renderApiConfigCard(containerEl, config, index);
		});

		new Setting(containerEl)
			.setName(tr('添加一套 AI 配置', 'Add an AI configuration'))
			.addButton((button) =>
				button.setButtonText(tr('添加', 'Add')).onClick(async () => {
					const preset = presetFor('deepseek');
					this.plugin.settings.apiConfigs.push({
						name: uniqueConfigName(this.plugin.settings.apiConfigs, preset.label),
						provider: preset.id,
						apiKey: '',
						baseUrl: preset.endpoint,
						model: preset.model,
						enabled: true,
					});
					await this.plugin.saveSettings();
					this.redraw();
				}),
			);

		// --- 功能API选择器 ---
		new Setting(containerEl).setName(tr('功能API选择', 'AI configuration for each feature')).setHeading();

		const enabledConfigs = this.plugin.settings.apiConfigs.filter(config => config.enabled);

		new Setting(containerEl)
			.setName(tr('快速翻译API', 'Quick translation'))
			.addDropdown(dropdown => {
				enabledConfigs.forEach(config => {
					dropdown.addOption(config.name, config.name);
				});
				dropdown.setValue(this.plugin.settings.apiSelectors.quickTranslation)
					.onChange(async (value) => {
						this.plugin.settings.apiSelectors.quickTranslation = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(tr('英语分析API', 'English analysis'))
			.addDropdown(dropdown => {
				enabledConfigs.forEach(config => {
					dropdown.addOption(config.name, config.name);
				});
				dropdown.setValue(this.plugin.settings.apiSelectors.englishAnalysis)
					.onChange(async (value) => {
						this.plugin.settings.apiSelectors.englishAnalysis = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(tr('日语分析API', 'Japanese analysis'))
			.addDropdown(dropdown => {
				enabledConfigs.forEach(config => {
					dropdown.addOption(config.name, config.name);
				});
				dropdown.setValue(this.plugin.settings.apiSelectors.japaneseAnalysis)
					.onChange(async (value) => {
						this.plugin.settings.apiSelectors.japaneseAnalysis = value;
						await this.plugin.saveSettings();
					});
			});

		// 语音转日语功能已移除

		// --- 内容定制设置 ---
		new Setting(containerEl).setName(tr('内容定制', 'Content')).setHeading();

		// 日语内容定制
		new Setting(containerEl).setName(tr('日语内容定制', 'Japanese sections')).setHeading();
        const japaneseSectionToggles: Record<keyof PolyglotHelper['settings']['japaneseSections'], string> = {
            vocabAnalysis: tr('词汇分析', 'Vocabulary analysis'),
            relatedVocab: tr('相关词汇解析', 'Related vocabulary'),
            sentences: tr('例句生成 (不同场景)', 'Example sentences (different situations)'),
			exercise: tr('翻译练习', 'Translation exercise'),
			jisho: tr('Jisho 词典', 'Jisho dictionary')
        };

        Object.keys(japaneseSectionToggles).forEach((key: keyof typeof japaneseSectionToggles) => {
            new Setting(containerEl)
                .setName(japaneseSectionToggles[key])
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.japaneseSections[key])
                    .onChange(async (value) => {
                        this.plugin.settings.japaneseSections[key] = value;
                        await this.plugin.saveSettings();
                    })
                );
        });

		// 英语内容定制
		new Setting(containerEl).setName(tr('英语内容定制', 'English sections')).setHeading();
		const englishSectionToggles: Record<keyof EnglishSections, string> = {
            definitions: tr('词典释义 (核心)', 'Dictionary definitions (core)'),
            example: tr('例句 (LLM生成)', 'Example sentences (AI)'),
            usage: tr('用法助记 (搭配/同反义词/技巧)', 'Usage notes (collocations, synonyms, tips)'),
            etymology: tr('词源', 'Etymology'),
            medical: tr('医学专用', 'Medical'),
            slang: tr('俚语 (Urban Dictionary)', 'Slang (Urban Dictionary)'),
            tatoeba: tr('Tatoeba 真实世界例句', 'Tatoeba real-world sentences'),
            idioms: tr('相关习语', 'Related idioms')
        };

        (Object.keys(englishSectionToggles) as Array<keyof EnglishSections>).forEach(key => {
            new Setting(containerEl)
                .setName(englishSectionToggles[key])
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.englishSections[key])
                    .onChange(async (value) => {
                        this.plugin.settings.englishSections[key] = value;
                        await this.plugin.saveSettings();
                    })
                );
        });
	}

	private displayAudioSettings(containerEl: HTMLElement) {
		new Setting(containerEl).setName(tr('语音', 'Speech')).setHeading();

		// 音频文件存储设置
		new Setting(containerEl).setName(tr('音频文件', 'Audio files')).setHeading();

		new Setting(containerEl)
			.setName(tr('日语音频文件存储路径', 'Japanese audio folder'))
			.addText(text => text
				.setPlaceholder(tr('库内文件夹路径', 'Folder in this vault'))
				.setValue(this.plugin.settings.japaneseAudioPath || 'Audio/Japanese')
				.onChange(async (value) => {
					this.plugin.settings.japaneseAudioPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(tr('自动保存音频文件', 'Save audio files automatically'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSaveAudio || false)
				.onChange(async (value) => {
					this.plugin.settings.autoSaveAudio = value;
					await this.plugin.saveSettings();
				}));

		// TTS Engine for Japanese
		new Setting(containerEl).setName(tr('语音合成', 'Speech')).setHeading();
		new Setting(containerEl)
			.setName(tr('语音合成引擎', 'Speech engine'))
			.addDropdown(dropdown => dropdown
				.addOption('openai', tr('OpenAI 语音合成', 'OpenAI speech'))
				.addOption('youdao', tr('有道语音合成', 'Youdao speech'))
				.addOption('gemini', tr('Gemini 语音合成', 'Gemini speech'))
				.setValue(this.plugin.settings.ttsEngine)
				.onChange(async (value: 'openai' | 'youdao' | 'gemini') => {
					this.plugin.settings.ttsEngine = value;
					await this.plugin.saveSettings();
					this.redraw();
				}));

		// Conditional TTS settings
		if (this.plugin.settings.ttsEngine === 'openai') {
			this.displayOpenAITTSSettings(containerEl);
		} else if (this.plugin.settings.ttsEngine === 'youdao') {
			this.displayYoudaoTTSSettings(containerEl);
		} else if (this.plugin.settings.ttsEngine === 'gemini') {
			this.displayGeminiTTSSettings(containerEl);
		}

		// 音频格式信息
		const audioFormatDiv = containerEl.createDiv({ cls: 'polyglot-info-section' });
		audioFormatDiv.createEl('p', { cls: 'setting-item-description', text: tr('音频会嵌入翻译结果。', 'Audio is embedded in the result.') });
	}

	private displayUISettings(containerEl: HTMLElement) {
		new Setting(containerEl).setName(tr('学习与界面', 'Learning and interface')).setHeading();

		new Setting(containerEl)
			.setName(tr('状态栏显示待复习数', 'Show due reviews in the status bar'))
			.setDesc(tr('点一下打开复习。仅桌面端。', 'Click it to start reviewing. Desktop only.'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showDueInStatusBar !== false)
				.onChange(async (value) => {
					this.plugin.settings.showDueInStatusBar = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(tr('词库导出文件夹', 'Word list export folder'))
			.setDesc(tr('命令“导出词库为闪卡笔记”“导出词库为 Anki 导入文件”写到这里。闪卡笔记可直接用间隔重复插件复习，重新导出会保留它的复习排程。', 'The "Export word list as flashcard notes" and "Export word list as an Anki import file" commands write here. Flashcard notes work with the Spaced Repetition plugin, and exporting again keeps its review schedule.'))
			.addText(text => text
				.setPlaceholder('Polyglot')
				.setValue(this.plugin.settings.vocabExportFolder || 'Polyglot')
				.onChange(async (value) => {
					this.plugin.settings.vocabExportFolder = value.trim() || 'Polyglot';
					await this.plugin.saveSettings();
				}));

		// 学习进度追踪设置
		
		new Setting(containerEl)
			.setName(tr('启用学习进度追踪', 'Track learning progress'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableLearningTracker)
				.onChange(async (value) => {
					this.plugin.settings.enableLearningTracker = value;
					await this.plugin.saveSettings();
					this.redraw();
				}));
		
		if (this.plugin.settings.enableLearningTracker) {
			new Setting(containerEl)
				.setName(tr('自动添加词汇到词汇库', 'Add words to the word list automatically'))
				.setDesc(tr('分析文本时自动提取并添加词汇到对应的词汇库。', 'Extract words while analysing text and add them to the matching word list.'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.autoAddToVocab || false)
					.onChange(async (value) => {
						this.plugin.settings.autoAddToVocab = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName(tr('每日学习目标', 'Daily goal'))
				.setDesc(tr('设置每天计划学习的新单词数量。', 'How many new words to learn each day.'))
				.addSlider(slider => slider
					.setLimits(1, 50, 1)
					.setValue(this.plugin.settings.dailyGoal)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.dailyGoal = value;
						await this.plugin.saveSettings();
					}));
			
			// 复习间隔设置
			const intervalDesc = createFragment();
			intervalDesc.append(
				tr('设置间隔重复的天数序列，用逗号分隔。', 'Review intervals in days, separated by commas.'),
				intervalDesc.createEl('br'),
				tr('例如: 1,3,7,14,30,90,180 表示第一次复习在1天后，第二次在3天后，依此类推。', 'For example 1,3,7,14,30,90,180: the first review after 1 day, the second after 3 days, and so on.')
			);
			
			new Setting(containerEl)
				.setName(tr('复习间隔设置', 'Review intervals'))
				.setDesc(intervalDesc)
				.addText(text => text
					.setValue(this.plugin.settings.reviewIntervals.join(','))
					.onChange(async (value) => {
						const intervals = value.split(',')
							.map(s => parseInt(s.trim()))
							.filter(n => !isNaN(n) && n > 0);
						
						if (intervals.length > 0) {
							this.plugin.settings.reviewIntervals = intervals;
							await this.plugin.saveSettings();
						}
					}));
			
			// 学习数据管理
			const statsInfo = createFragment();
			statsInfo.append(
				tr(`总词汇量: ${this.plugin.settings.learningStats.totalWords} 词`, `Total words: ${this.plugin.settings.learningStats.totalWords}`),
				statsInfo.createEl('br'),
				tr(`总复习次数: ${this.plugin.settings.learningStats.totalReviews} 次`, `Total reviews: ${this.plugin.settings.learningStats.totalReviews}`),
				statsInfo.createEl('br'),
				tr(`学习连续天数: ${this.plugin.settings.learningStats.streakDays} 天`, `Study streak: ${this.plugin.settings.learningStats.streakDays} days`)
			);
			
			new Setting(containerEl)
				.setName(tr('学习统计', 'Statistics'))
				.setDesc(statsInfo);
			
			new Setting(containerEl)
				.setName(tr('重置学习数据', 'Reset learning data'))
				.setDesc(tr('警告：此操作将清除所有学习进度和统计数据，无法恢复。', 'Warning: this deletes all learning progress and statistics and cannot be undone.'))
				.addButton(button => button
					.setButtonText(tr('重置数据', 'Reset'))
					.setClass('mod-warning')
					.onClick(async () => {
						const confirmed = await confirmAction(this.app, tr('确定要重置所有学习数据吗？此操作无法撤销。', 'Reset all learning data? This cannot be undone.'));
						if (confirmed) {
							this.plugin.settings.learningStats = {
								dailyStats: {},
								totalWords: 0,
								totalReviews: 0,
								streakDays: 0,
								lastStudyDate: '',
							};
							this.plugin.settings.vocabItems = {};
							await this.plugin.saveSettings();
							this.redraw();
							new Notice(tr('学习数据已重置。', 'Learning data reset.'));
						}
					}));
		}
		
		// 音频和翻译内容定制设置已移动到对应的标签页

	}

	private displayCacheSettings(containerEl: HTMLElement) {
		new Setting(containerEl).setName(tr('缓存', 'Cache')).setHeading();

		// 创建智能清理区域
		void this.createSmartCleanupSection(containerEl);

		// 快速清理选项
		const quickCleanDiv = containerEl.createDiv({ cls: 'polyglot-quick-clean-section' });
		new Setting(quickCleanDiv).setName(tr('快速清理', 'Quick cleanup')).setHeading();

		// 翻译缓存清理
		new Setting(quickCleanDiv)
			.setName(tr('清理翻译缓存', 'Clear translation cache'))
			.setDesc(tr('清理所有翻译相关的缓存文件（保留音频文件）', 'Delete all cached translations (audio stays)'))
			.addButton(button => {
				button
					.setButtonText(tr('📝 清理翻译缓存', '📝 Clear translation cache'))
					.onClick(async () => {
						try {
							await this.plugin.clearTranslationCache();
						} catch (error) {
							new Notice(tr(`清理失败: ${errorMessage(error)}`, `Cleanup failed: ${errorMessage(error)}`));
						}
					});
			});

		// 音频缓存清理
		new Setting(quickCleanDiv)
			.setName(tr('清理音频缓存', 'Clear audio cache'))
			.setDesc(tr('清理所有音频文件缓存（保留翻译缓存）', 'Delete all cached audio (translations stay)'))
			.addButton(button => {
				button
					.setButtonText(tr('🎵 清理音频缓存', '🎵 Clear audio cache'))
					.onClick(async () => {
						try {
							await this.plugin.clearAudioCache();
						} catch (error) {
							new Notice(tr(`清理失败: ${errorMessage(error)}`, `Cleanup failed: ${errorMessage(error)}`));
						}
					});
			});

		// 全部清理
		new Setting(quickCleanDiv)
			.setName(tr('清理所有缓存', 'Clear all caches'))
			.setDesc(tr('⚠️ 清理所有缓存数据，包括翻译和音频文件', '⚠️ Delete all cached data, translations and audio'))
			.addButton(button => {
				button
					.setButtonText(tr('🗑️ 清理所有缓存', '🗑️ Clear all caches'))
					.setClass('mod-warning')
					.onClick(async () => {
						const confirmed = await confirmAction(this.app, tr('确定要清理所有缓存吗？此操作不可撤销！', 'Clear all caches? This cannot be undone.'));
						if (confirmed) {
							try {
								await this.plugin.clearAllCache();
							} catch (error) {
								new Notice(tr(`清理失败: ${errorMessage(error)}`, `Cleanup failed: ${errorMessage(error)}`));
							}
						}
					});
			});
	}

	private displayAdvancedSettings(containerEl: HTMLElement) {
		new Setting(containerEl).setName(tr('高级', 'Advanced')).setHeading();

		new Setting(containerEl)
			.setName(tr('启用调试模式', 'Debug mode'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugMode || false)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(tr('自动保存设置', 'Save settings automatically'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSave || true)
				.onChange(async (value) => {
					this.plugin.settings.autoSave = value;
					await this.plugin.saveSettings();
				}));

		// 开发者信息
		const devInfo = containerEl.createDiv({ cls: 'polyglot-dev-info' });
		new Setting(devInfo).setName(tr('插件信息', 'About')).setHeading();
		devInfo.createEl('p', { text: tr(`版本: ${this.plugin.manifest.version}`, `Version: ${this.plugin.manifest.version}`) });
	}

	private createLanguagePathSettings(containerEl: HTMLElement, title: string, settingsKey: keyof Pick<PolyglotHelperSettings, 'japaneseOutputSettings' | 'englishOutputSettings' | 'quickTranslationOutputSettings'>) {
		new Setting(containerEl).setName(title).setHeading();

		const settings = this.plugin.settings[settingsKey];

		new Setting(containerEl)
			.setName(tr('新文件存放位置', 'Folder for new files'))
			.addText(text => text
				.setPlaceholder(tr('例如: Japanese/', 'For example Japanese/'))
				.setValue(settings.newFileLocation)
				.onChange(async (value) => {
					this.plugin.settings[settingsKey].newFileLocation = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(tr('固定输出文件', 'Fixed output file'))
			.addText(text => text
				.setPlaceholder(tr('例如: Japanese/日语学习记录.md', 'For example Japanese/Study log.md'))
				.setValue(settings.fixedOutputFile)
				.onChange(async (value) => {
					this.plugin.settings[settingsKey].fixedOutputFile = value;
					await this.plugin.saveSettings();
				}));
	}

	private displayOpenAITTSSettings(containerEl: HTMLElement) {
		new Setting(containerEl).setName(tr('OpenAI 语音合成', 'OpenAI speech')).setHeading();
		new Setting(containerEl).setName(tr('语音合成接口地址', 'Speech endpoint')).addText(text => text.setValue(this.plugin.settings.openaiTtsBaseUrl || '').onChange(async (value) => { this.plugin.settings.openaiTtsBaseUrl = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName(tr('语音合成 API 密钥', 'Speech API key')).setDesc(tr("留空时使用上面的 OpenAI API 密钥", "Empty uses the OpenAI API key above")).addText(text => { text.inputEl.type = 'password'; text.setValue(this.plugin.settings.openaiTtsApiKey || '').onChange(async (value) => { this.plugin.settings.openaiTtsApiKey = value; await this.plugin.saveSettings(); }); });
		new Setting(containerEl).setName(tr('语音合成模型名称', 'Speech model')).setDesc(tr('例如：tts-1、tts-1-hd', 'For example tts-1, tts-1-hd')).addText(text => text.setValue(this.plugin.settings.openaiTtsModel || '').onChange(async (value) => { this.plugin.settings.openaiTtsModel = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName(tr('语音合成声音', 'Voice')).setDesc(tr('例如：alloy、echo、fable、onyx、nova、shimmer', 'For example alloy, echo, fable, onyx, nova, shimmer')).addText(text => text.setValue(this.plugin.settings.openaiTtsVoice || '').onChange(async (value) => { this.plugin.settings.openaiTtsVoice = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName(tr('语音合成语速', 'Speed')).setDesc(tr('范围：0.25 - 4.0（默认 1.0）', 'Range 0.25–4.0 (default 1.0)')).addText(text => text.setValue(String(this.plugin.settings.openaiTtsSpeed || 1.0)).onChange(async (value) => { const speed = parseFloat(value); if (!isNaN(speed)) { this.plugin.settings.openaiTtsSpeed = speed; await this.plugin.saveSettings(); } }));

		// 添加测试按钮
		new Setting(containerEl)
			.setName(tr('测试 OpenAI 语音合成', 'Test OpenAI speech'))
			.addButton(button => button
				.setButtonText(tr('测试', 'Test'))
				.onClick(async () => {
					button.setButtonText(tr('测试中...', 'Testing...'));
					button.setDisabled(true);

					try {
						const testText = 'こんにちは';
						const audioBuffer = await this.plugin.testTtsAudio(testText);

						if (audioBuffer) {
							new Notice(tr('OpenAI 语音合成测试成功！', 'OpenAI speech works.'));
						} else {
							new Notice(tr('OpenAI 语音合成测试失败，请检查配置和网络连接', 'OpenAI speech test failed; check the settings and network'));
						}
					} catch (error) {
						new Notice(tr(`OpenAI 语音合成测试失败: ${errorMessage(error)}`, `OpenAI speech test failed: ${errorMessage(error)}`));
						this.plugin.logger.error('OpenAI 语音合成测试失败', error);
					} finally {
						button.setButtonText(tr('测试', 'Test'));
						button.setDisabled(false);
					}
				}));
	}

	private displayYoudaoTTSSettings(containerEl: HTMLElement) {
		new Setting(containerEl).setName(tr('有道语音合成', 'Youdao speech')).setHeading();
		new Setting(containerEl).setName(tr('有道应用 ID', 'Youdao app ID')).addText(text => { text.inputEl.type = 'password'; text.setValue(this.plugin.settings.youdaoAppKey || '').onChange(async (value) => { this.plugin.settings.youdaoAppKey = value; await this.plugin.saveSettings(); }); });
		new Setting(containerEl).setName(tr('有道应用密钥', 'Youdao app secret')).addText(text => { text.inputEl.type = 'password'; text.setValue(this.plugin.settings.youdaoAppSecret || '').onChange(async (value) => { this.plugin.settings.youdaoAppSecret = value; await this.plugin.saveSettings(); }); });

		// 添加测试按钮
		new Setting(containerEl)
			.setName(tr('测试有道语音合成', 'Test Youdao speech'))
			.addButton(button => button
				.setButtonText(tr('测试', 'Test'))
				.onClick(async () => {
					button.setButtonText(tr('测试中...', 'Testing...'));
					button.setDisabled(true);

					try {
						const testText = 'こんにちは';
						const audioBuffer = await this.plugin.testTtsAudio(testText);

						if (audioBuffer) {
							new Notice(tr('有道语音合成测试成功！', 'Youdao speech works.'));
						} else {
							new Notice(tr('有道语音合成测试失败，请检查配置和网络连接', 'Youdao speech test failed; check the settings and network'));
						}
					} catch (error) {
						new Notice(tr(`有道语音合成测试失败: ${errorMessage(error)}`, `Youdao speech test failed: ${errorMessage(error)}`));
						this.plugin.logger.error('有道语音合成测试失败', error);
					} finally {
						button.setButtonText(tr('测试', 'Test'));
						button.setDisabled(false);
					}
				}));
	}

	private displayGeminiTTSSettings(containerEl: HTMLElement) {
		new Setting(containerEl).setName(tr('Gemini 语音合成', 'Gemini speech')).setHeading();

		new Setting(containerEl)
			.setName(tr('Gemini 语音合成接口地址', 'Gemini speech endpoint'))
			.setDesc(tr('Gemini 语音合成 API 的基础地址', 'Base address of the Gemini speech API'))
			.addText(text => text
				.setValue(this.plugin.settings.geminiTtsBaseUrl || '')
				.onChange(async (value) => {
					this.plugin.settings.geminiTtsBaseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(tr('Gemini 语音合成 API 密钥', 'Gemini speech API key'))
			.setDesc(tr('输入你的 Gemini API 密钥', 'Your Gemini API key'))
			.addText(text => {
				text.inputEl.type = 'password';
				text.setValue(this.plugin.settings.geminiTtsApiKey || '')
					.onChange(async (value) => {
						this.plugin.settings.geminiTtsApiKey = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(tr('Gemini 语音合成模型名称', 'Gemini speech model'))
			.setDesc(tr('例如：tts-1、tts-1-hd', 'For example tts-1, tts-1-hd'))
			.addText(text => text
				.setValue(this.plugin.settings.geminiTtsModel || '')
				.onChange(async (value) => {
					this.plugin.settings.geminiTtsModel = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(tr('Gemini 语音合成声音', 'Gemini voice'))
			.setDesc(tr('选择 Gemini 语音合成的声音', 'Choose a Gemini voice'))
			.addDropdown(dropdown => {
				// 添加图中显示的所有语音选项
				const voices = [
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

				voices.forEach(voice => {
					dropdown.addOption(voice.value, voice.label);
				});

				dropdown.setValue(this.plugin.settings.geminiTtsVoice || 'Zephyr')
					.onChange(async (value) => {
						this.plugin.settings.geminiTtsVoice = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(tr('Gemini 语音合成语速', 'Gemini speech speed'))
			.setDesc(tr('范围：0.25 - 4.0（默认 1.0）', 'Range 0.25–4.0 (default 1.0)'))
			.addText(text => text
				.setValue(String(this.plugin.settings.geminiTtsSpeed || 1.0))
				.onChange(async (value) => {
					const speed = parseFloat(value);
					if (!isNaN(speed)) {
						this.plugin.settings.geminiTtsSpeed = speed;
						await this.plugin.saveSettings();
					}
				}));

		// 添加测试按钮
		new Setting(containerEl)
			.setName(tr('测试 Gemini 语音合成', 'Test Gemini speech'))
			.addButton(button => button
				.setButtonText(tr('测试', 'Test'))
				.onClick(async () => {
					button.setButtonText(tr('测试中...', 'Testing...'));
					button.setDisabled(true);

					try {
						const testText = 'こんにちは';
						const audioBuffer = await this.plugin.testTtsAudio(testText);

						if (audioBuffer) {
							new Notice(tr('Gemini 语音合成测试成功！', 'Gemini speech works.'));
						} else {
							new Notice(tr('Gemini 语音合成测试失败，请检查配置和网络连接', 'Gemini speech test failed; check the settings and network'));
						}
					} catch (error) {
						new Notice(tr(`Gemini 语音合成测试失败: ${errorMessage(error)}`, `Gemini speech test failed: ${errorMessage(error)}`));
						this.plugin.logger.error('Gemini 语音合成测试失败', error);
					} finally {
						button.setButtonText(tr('测试', 'Test'));
						button.setDisabled(false);
					}
				}));
	}

	private async createSmartCleanupSection(containerEl: HTMLElement) {
		// 智能清理容器
		const smartCleanupDiv = containerEl.createDiv({ cls: 'polyglot-smart-cleanup-section' });
		new Setting(smartCleanupDiv).setName(tr('智能缓存清理', 'Smart cache cleanup')).setHeading();

		// 加载缓存数据 - 使用动态导入以支持移动端
		const { CacheManager } = await import('./cache-manager');
		const cacheManager = new CacheManager(
			this.app,
			this.plugin.logger,
			this.plugin.manifest.dir || ''
		);

		let allItems: CacheItem[] = [];
		let filteredItems: CacheItem[] = [];
		let selectedItems = new Set<string>();

		// 筛选器状态
		const filter = {
			type: 'all',
			days: '',
			size: '',
			pattern: ''
		};

		// 扫描缓存按钮
		const scanSection = smartCleanupDiv.createDiv({ cls: 'polyglot-scan-section' });
		const scanButton = scanSection.createEl('button', {
			text: tr('🔍 扫描缓存文件', '🔍 Scan cache files'),
			cls: 'mod-cta'
		});

		const scanStatus = scanSection.createDiv({ cls: 'polyglot-scan-status' });

		scanButton.addEventListener('click', fire(async () => {
			try {
				scanButton.disabled = true;
				scanButton.textContent = tr('⏳ 扫描中...', '⏳ Scanning...');
				scanStatus.textContent = '';

				allItems = await cacheManager.scanAllCache();
				filteredItems = [...allItems];
				selectedItems.clear();

				scanButton.disabled = false;
				scanButton.textContent = tr('🔍 重新扫描', '🔍 Scan again');
				scanStatus.textContent = tr(`✅ 扫描完成，找到 ${allItems.length} 个缓存文件`, `✅ Scan finished: ${allItems.length} cache files`);

				// 创建筛选和预览区域
				this.createFilterAndPreviewSection(smartCleanupDiv, {
					allItems,
					filteredItems,
					selectedItems,
					filter,
					cacheManager
				});

			} catch (error) {
				scanButton.disabled = false;
				scanButton.textContent = tr('🔍 扫描缓存文件', '🔍 Scan cache files');
				scanStatus.textContent = tr(`❌ 扫描失败: ${errorMessage(error)}`, `❌ Scan failed: ${errorMessage(error)}`);
			}
		}));
	}

	private createFilterAndPreviewSection(containerEl: HTMLElement, data: CleanupState) {
		// 移除之前的筛选和预览区域
		const existingSection = containerEl.querySelector('.polyglot-filter-preview-section');
		if (existingSection) {
			existingSection.remove();
		}

		const section = containerEl.createDiv({ cls: 'polyglot-filter-preview-section' });

		// 筛选区域
		this.createInlineFilterSection(section, data);

		// 预览区域
		this.createInlinePreviewSection(section, data);

		// 操作按钮
		this.createInlineActionButtons(section, data);
	}

	private createInlineFilterSection(containerEl: HTMLElement, data: CleanupState) {
		const filterDiv = containerEl.createDiv({ cls: 'polyglot-inline-filter' });
		new Setting(filterDiv).setName(tr('筛选条件', 'Filters')).setHeading();

		const filterRow = filterDiv.createDiv({ cls: 'polyglot-filter-row' });

		// 类型筛选
		const typeSelect = filterRow.createEl('select', { cls: 'polyglot-filter-select' });
		typeSelect.createEl('option', { value: 'all', text: tr('🔄 所有类型', '🔄 All types') });
		typeSelect.createEl('option', { value: 'translation', text: tr('📝 翻译缓存', '📝 Translation cache') });
		typeSelect.createEl('option', { value: 'audio', text: tr('🎵 音频缓存', '🎵 Audio cache') });

		// 时间筛选
		const timeSelect = filterRow.createEl('select', { cls: 'polyglot-filter-select' });
		timeSelect.createEl('option', { value: '', text: tr('🕐 所有时间', '🕐 Any age') });
		timeSelect.createEl('option', { value: '1', text: tr('1天前', '1 day') });
		timeSelect.createEl('option', { value: '7', text: tr('1周前', '1 week') });
		timeSelect.createEl('option', { value: '30', text: tr('1个月前', '1 month') });
		timeSelect.createEl('option', { value: '90', text: tr('3个月前', '3 months') });

		// 大小筛选
		const sizeSelect = filterRow.createEl('select', { cls: 'polyglot-filter-select' });
		sizeSelect.createEl('option', { value: '', text: tr('📦 所有大小', '📦 Any size') });
		sizeSelect.createEl('option', { value: '1024', text: tr('大于 1 千字节', 'Over 1 KB') });
		sizeSelect.createEl('option', { value: '10240', text: tr('大于 10 千字节', 'Over 10 KB') });
		sizeSelect.createEl('option', { value: '102400', text: tr('大于 100 千字节', 'Over 100 KB') });
		sizeSelect.createEl('option', { value: '1048576', text: tr('大于 1 兆字节', 'Over 1 MB') });

		// 应用筛选
		const applyFilter = () => {
			data.filter.type = typeSelect.value;
			data.filter.days = timeSelect.value;
			data.filter.size = sizeSelect.value;

			this.applyInlineFilter(data);
			this.updateInlinePreview(data);
		};

		typeSelect.addEventListener('change', applyFilter);
		timeSelect.addEventListener('change', applyFilter);
		sizeSelect.addEventListener('change', applyFilter);
	}

	private createInlinePreviewSection(containerEl: HTMLElement, data: CleanupState) {
		const previewDiv = containerEl.createDiv({ cls: 'polyglot-inline-preview' });
		new Setting(previewDiv).setName(tr('预览结果', 'Preview')).setHeading();

		// 统计信息
		const statsDiv = previewDiv.createDiv({ cls: 'polyglot-inline-stats' });

		// 全选控制
		const selectAllDiv = previewDiv.createDiv({ cls: 'polyglot-inline-select-all' });
		const selectAllCheckbox = selectAllDiv.createEl('input', { type: 'checkbox' });
		selectAllDiv.createEl('label', { text: tr('全选/取消全选', 'Select all / none') });

		selectAllCheckbox.addEventListener('change', () => {
			if (selectAllCheckbox.checked) {
				data.filteredItems.forEach((item: CacheItem) => data.selectedItems.add(item.path));
			} else {
				data.selectedItems.clear();
			}
			this.updateInlinePreview(data);
		});

		// 文件列表
		const listDiv = previewDiv.createDiv({ cls: 'polyglot-inline-list' });

		// 保存引用以便更新
		data.statsDiv = statsDiv;
		data.listDiv = listDiv;
		data.selectAllCheckbox = selectAllCheckbox;

		this.updateInlinePreview(data);
	}

	private createInlineActionButtons(containerEl: HTMLElement, data: CleanupState) {
		const buttonDiv = containerEl.createDiv({ cls: 'polyglot-inline-actions' });

		// 清理按钮
		const cleanButton = buttonDiv.createEl('button', {
			text: tr('🗑️ 清理选中项', '🗑️ Delete selected'),
			cls: 'mod-warning'
		});

		cleanButton.addEventListener('click', fire(async () => {
			if (data.selectedItems.size === 0) {
				new Notice(tr('请先选择要清理的文件', 'Select files to clean first'));
				return;
			}

			const confirmed = await confirmAction(this.app, tr(`确定要删除 ${data.selectedItems.size} 个缓存文件吗？此操作不可撤销！`, `Delete ${data.selectedItems.size} cache files? This cannot be undone.`));
			if (!confirmed) return;

			try {
				cleanButton.disabled = true;
				cleanButton.textContent = tr('⏳ 清理中...', '⏳ Cleaning...');

				const selectedPaths = Array.from(data.selectedItems);
				await data.cacheManager.deleteItems(data.allItems.filter(item => data.selectedItems.has(item.path)));

				// 重新扫描
				data.allItems = await data.cacheManager.scanAllCache();
				data.selectedItems.clear();
				this.applyInlineFilter(data);
				this.updateInlinePreview(data);

				cleanButton.disabled = false;
				cleanButton.textContent = tr('🗑️ 清理选中项', '🗑️ Delete selected');
				new Notice(tr(`成功清理 ${selectedPaths.length} 个缓存文件`, `Deleted ${selectedPaths.length} cache files`));

			} catch (error) {
				cleanButton.disabled = false;
				cleanButton.textContent = tr('🗑️ 清理选中项', '🗑️ Delete selected');
				new Notice(tr(`清理失败: ${errorMessage(error)}`, `Cleanup failed: ${errorMessage(error)}`));
			}
		}));
	}

	private applyInlineFilter(data: CleanupState) {
		const { allItems, filter } = data;

		data.filteredItems = allItems.filter((item: CacheItem) => {
			// 类型筛选
			if (filter.type !== 'all') {
				if (filter.type === 'translation' && item.type !== 'translation') return false;
				if (filter.type === 'audio' && item.type !== 'audio') return false;
			}

			// 时间筛选
			if (filter.days) {
				const daysAgo = parseInt(filter.days);
				const cutoffTime = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
				if (item.lastModified > cutoffTime) return false;
			}

			// 大小筛选
			if (filter.size) {
				const minSize = parseInt(filter.size);
				if (item.size < minSize) return false;
			}

			return true;
		});
	}

	private updateInlinePreview(data: CleanupState) {
		const { filteredItems, selectedItems, statsDiv, listDiv, selectAllCheckbox } = data;
		if (!statsDiv || !listDiv || !selectAllCheckbox) return;

		// 更新统计信息
		const totalSize = filteredItems.reduce((sum: number, item: CacheItem) => sum + item.size, 0);
		const selectedSize = filteredItems
			.filter((item: CacheItem) => selectedItems.has(item.path))
			.reduce((sum: number, item: CacheItem) => sum + item.size, 0);

		const formatSize = (bytes: number) => {
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		};

		statsDiv.empty();
		statsDiv.createDiv({ cls: 'polyglot-stat-item', text: tr(`📊 筛选结果: ${filteredItems.length} 个文件 (${formatSize(totalSize)})`, `📊 Matches: ${filteredItems.length} files (${formatSize(totalSize)})`) });
		statsDiv.createDiv({ cls: 'polyglot-stat-item selected', text: tr(`✅ 已选择: ${selectedItems.size} 个文件 (${formatSize(selectedSize)})`, `✅ Selected: ${selectedItems.size} files (${formatSize(selectedSize)})`) });

		// 更新文件列表
		listDiv.empty();

		if (filteredItems.length === 0) {
			listDiv.createDiv({
				text: tr('没有找到符合条件的缓存文件', 'No cache files match'),
				cls: 'polyglot-empty-message'
			});
			return;
		}

		// 限制显示数量
		const displayItems = filteredItems.slice(0, 50);
		if (filteredItems.length > 50) {
			listDiv.createDiv({
				text: tr(`显示前50个文件，共${filteredItems.length}个`, `Showing the first 50 of ${filteredItems.length} files`),
				cls: 'polyglot-limit-message'
			});
		}

		displayItems.forEach((item: CacheItem) => {
			const itemDiv = listDiv.createDiv({ cls: 'polyglot-inline-item' });

			const checkbox = itemDiv.createEl('input', { type: 'checkbox' });
			checkbox.checked = selectedItems.has(item.path);

			const infoDiv = itemDiv.createDiv({ cls: 'polyglot-item-info' });
			infoDiv.createDiv({ text: item.name, cls: 'polyglot-item-name' });
			infoDiv.createDiv({
				text: `${formatSize(item.size)} • ${new Date(item.lastModified).toLocaleDateString()}`,
				cls: 'polyglot-item-details'
			});

			itemDiv.createSpan({
				text: item.type === 'audio' ? '🎵 AUDIO' : '📝 TEXT',
				cls: `polyglot-type-tag ${item.type}`
			});

			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					selectedItems.add(item.path);
				} else {
					selectedItems.delete(item.path);
				}
				this.updateInlinePreview(data);
			});
		});

		// 更新全选状态
		selectAllCheckbox.checked = filteredItems.length > 0 && selectedItems.size === filteredItems.length;
		selectAllCheckbox.indeterminate = selectedItems.size > 0 && selectedItems.size < filteredItems.length;
	}
}

function uniqueConfigName(configs: ApiConfig[], base: string): string {
	const names = new Set(configs.map((config) => config.name));
	if (!names.has(base)) return base;
	let index = 2;
	while (names.has(`${base} ${index}`)) index += 1;
	return `${base} ${index}`;
}
