import { App, PluginSettingTab, Setting } from "obsidian";
import PolyglotHelper from "./main";
// clearCache已移除
import { Notice } from 'obsidian';
import { EnglishSections, PolyglotHelperSettings } from "./types";

export class PolyglotSettingTab extends PluginSettingTab {
	plugin: PolyglotHelper;
	private currentTab: string = 'general';

	constructor(app: App, plugin: PolyglotHelper) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('h2', {text: '语言助手设置'});

		// 创建标签页导航
		this.createTabNavigation(containerEl);

		// 创建内容容器
		const contentContainer = containerEl.createDiv({ cls: 'polyglot-settings-content' });

		// 根据当前标签页显示内容
		this.displayTabContent(contentContainer);
	}

	private createTabNavigation(containerEl: HTMLElement) {
		const tabNav = containerEl.createDiv({ cls: 'polyglot-tab-navigation' });

		const tabs = [
			{ id: 'general', name: '输出与保存', icon: '🔧' },
			{ id: 'translation', name: '翻译与模型', icon: '🌐' },
			{ id: 'audio', name: '语音', icon: '🎵' },
			{ id: 'ui', name: '学习与界面', icon: '🎨' },
			{ id: 'cache', name: '缓存', icon: '🗑️' },
			{ id: 'advanced', name: '高级', icon: '⚙️' }
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
		containerEl.createEl('h3', {text: '输出与保存'});

		new Setting(containerEl)
			.setName('自动添加到词汇库')
			.setDesc('翻译后自动将词汇添加到词汇库。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoAddToVocab || false)
				.onChange(async (value) => {
					this.plugin.settings.autoAddToVocab = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('选词模式')
			.setDesc('开启后，鼠标选择的词汇会自动添加到侧边栏文本框，便于批量处理。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.wordSelectionMode || false)
				.onChange(async (value) => {
					this.plugin.settings.wordSelectionMode = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('复习提醒')
			.setDesc('启用智能复习提醒功能。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.reviewReminder || false)
				.onChange(async (value) => {
					this.plugin.settings.reviewReminder = value;
					await this.plugin.saveSettings();
				}));

		// --- 输出位置设置 ---
		containerEl.createEl('h3', {text: '📁 输出位置设置'});

		const outputDesc = containerEl.createDiv({cls: 'polyglot-setting-description'});
		outputDesc.innerHTML = `
			<p><strong>优先级说明：</strong></p>
			<ul>
				<li>🥇 <strong>最高优先级</strong>：侧边栏选择的输出位置</li>
				<li>🥈 <strong>语言特定路径</strong>：仅在选择"固定文件"或"创建新文件"时使用下方的语言专用路径</li>
				<li>🥉 <strong>通用路径</strong>：其他情况使用此处设置的通用路径</li>
			</ul>
		`;

		new Setting(containerEl)
			.setName('默认输出位置')
			.setDesc('设置默认的输出位置。侧边栏的选择会覆盖此设置。')
			.addDropdown(dropdown => dropdown
				.addOption('sidebar', '侧边栏')
				.addOption('newFile', '创建新文件')
				.addOption('appendCurrent', '追加到当前文件')
				.addOption('replace', '替换选中内容')
				.addOption('fixedFile', '固定文件')
				.setValue(this.plugin.settings.outputDestination)
				.onChange(async (value: 'sidebar' | 'newFile' | 'appendCurrent' | 'replace' | 'fixedFile') => {
					this.plugin.settings.outputDestination = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.outputDestination === 'newFile') {
			new Setting(containerEl)
				.setName('通用新文件存放位置')
				.setDesc('当输出位置为"创建新文件"且未设置语言特定路径时使用。')
				.addText(text => text
					.setPlaceholder('例如: Notes/')
					.setValue(this.plugin.settings.newFileLocation)
					.onChange(async (value) => {
						this.plugin.settings.newFileLocation = value;
						await this.plugin.saveSettings();
					}));
		}

		if (this.plugin.settings.outputDestination === 'fixedFile') {
			new Setting(containerEl)
				.setName('通用固定输出文件')
				.setDesc('当输出位置为"固定文件"且未设置语言特定路径时使用。')
				.addText(text => text
					.setPlaceholder('例如: Notes/学习记录.md')
					.setValue(this.plugin.settings.fixedOutputFile)
					.onChange(async (value) => {
						this.plugin.settings.fixedOutputFile = value;
						await this.plugin.saveSettings();
					}));
		}

		// --- 快速翻译专属设置 ---
		containerEl.createEl('h4', {text: '⚡ 快速翻译设置'});
		new Setting(containerEl)
			.setName('快速翻译：罗马音标注')
			.setDesc('在“→日”快速翻译结果中显示罗马音（仅日语文本时生效）。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.quickTranslationOptions?.showRomaji ?? false)
				.onChange(async (value) => {
					this.plugin.settings.quickTranslationOptions = this.plugin.settings.quickTranslationOptions || { showRomaji: false, playAudio: true, outputDestination: 'sidebar' };
					this.plugin.settings.quickTranslationOptions.showRomaji = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('快速翻译：播放音频')
			.setDesc('开启后，快速翻译会在显示文本后后台生成音频并播放。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.quickTranslationOptions?.playAudio ?? true)
				.onChange(async (value) => {
					this.plugin.settings.quickTranslationOptions = this.plugin.settings.quickTranslationOptions || { showRomaji: false, playAudio: true, outputDestination: 'sidebar' };
					this.plugin.settings.quickTranslationOptions.playAudio = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('快速翻译：输出位置')
			.setDesc('为“→日 / →汉”快速翻译单独设置输出位置。')
			.addDropdown(dropdown => dropdown
				.addOption('sidebar', '侧边栏')
				.addOption('newFile', '创建新文件')
				.addOption('appendCurrent', '追加到当前文件')
				.addOption('replace', '替换选中内容')
				.addOption('fixedFile', '固定文件')
				.setValue(this.plugin.settings.quickTranslationOptions?.outputDestination ?? 'sidebar')
				.onChange(async (value: 'sidebar' | 'newFile' | 'appendCurrent' | 'replace' | 'fixedFile') => {
					this.plugin.settings.quickTranslationOptions = this.plugin.settings.quickTranslationOptions || { showRomaji: false, playAudio: true, outputDestination: 'sidebar' };
					this.plugin.settings.quickTranslationOptions.outputDestination = value;
					await this.plugin.saveSettings();
				}));

		// --- 语言特定路径设置 ---
		containerEl.createEl('h4', {text: '🌍 语言特定路径设置'});

		const languageDesc = containerEl.createDiv({cls: 'polyglot-setting-description'});
		languageDesc.innerHTML = `
			<p><strong>说明：</strong>这些路径仅在选择"固定文件"或"创建新文件"输出模式时使用。</p>
			<p>如果留空，将使用上方的通用路径设置。</p>
		`;

		// 日语特定路径设置
		this.createLanguagePathSettings(containerEl, '🇯🇵 日语分析', 'japaneseOutputSettings');

		// 英语特定路径设置
		this.createLanguagePathSettings(containerEl, '🇺🇸 英语分析', 'englishOutputSettings');

		// 快捷翻译特定路径设置
		this.createLanguagePathSettings(containerEl, '⚡ 快捷翻译', 'quickTranslationOutputSettings');
	}

	private displayTranslationSettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', {text: '🌐 翻译API配置'});

		// API配置列表
		this.plugin.settings.apiConfigs.forEach((config, index) => {
			const configContainer = containerEl.createDiv({ cls: 'api-config-container' });

			// 配置标题和删除按钮
			const headerContainer = configContainer.createDiv({ cls: 'api-config-header' });
			headerContainer.createEl('h4', { text: `${config.name} API配置` });

			// 只有超过1个配置时才显示删除按钮
			if (this.plugin.settings.apiConfigs.length > 1) {
				const deleteButton = headerContainer.createEl('button', {
					text: '删除',
					cls: 'api-config-delete-btn'
				});
				deleteButton.addEventListener('click', async () => {
					// 确认删除
					const confirmed = confirm(`确定要删除 "${config.name}" API配置吗？`);
					if (confirmed) {
						this.plugin.settings.apiConfigs.splice(index, 1);
						await this.plugin.saveSettings();
						this.display(); // 重新渲染设置页面
					}
				});
			}

			new Setting(configContainer)
				.setName('启用')
				.setDesc(`启用 ${config.name} API配置`)
				.addToggle(toggle => toggle
					.setValue(config.enabled)
					.onChange(async (value) => {
						this.plugin.settings.apiConfigs[index].enabled = value;
						await this.plugin.saveSettings();
					}));

			new Setting(configContainer)
				.setName('配置名称')
				.setDesc('API配置的显示名称')
				.addText(text => text
					.setPlaceholder('例如：OpenRouter')
					.setValue(config.name)
					.onChange(async (value) => {
						this.plugin.settings.apiConfigs[index].name = value;
						await this.plugin.saveSettings();
					}));

			new Setting(configContainer)
				.setName('API密钥')
				.setDesc('API访问密钥')
				.addText(text => {
					text.inputEl.type = 'password';
					return text
						.setPlaceholder('sk-...')
						.setValue(config.apiKey)
						.onChange(async (value) => {
							this.plugin.settings.apiConfigs[index].apiKey = value;
							await this.plugin.saveSettings();
						});
				});

			new Setting(configContainer)
				.setName('Base URL')
				.setDesc('API的基础URL地址')
				.addText(text => text
					.setPlaceholder('https://api.example.com/v1/chat/completions')
					.setValue(config.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiConfigs[index].baseUrl = value;
						await this.plugin.saveSettings();
					}));

			new Setting(configContainer)
				.setName('模型名称')
				.setDesc('使用的模型名称')
				.addText(text => text
					.setPlaceholder('gpt-4o-mini')
					.setValue(config.model)
					.onChange(async (value) => {
						this.plugin.settings.apiConfigs[index].model = value;
						await this.plugin.saveSettings();
					}));
		});

		// 添加新API配置按钮
		new Setting(containerEl)
			.setName('添加新API配置')
			.setDesc('添加一个新的API配置')
			.addButton(button => button
				.setButtonText('添加配置')
				.onClick(async () => {
					this.plugin.settings.apiConfigs.push({
						name: `API配置 ${this.plugin.settings.apiConfigs.length + 1}`,
						apiKey: '',
						baseUrl: '',
						model: '',
						enabled: false,
					});
					await this.plugin.saveSettings();
					this.display();
				}));

		// --- 功能API选择器 ---
		containerEl.createEl('h3', {text: '功能API选择'});

		const enabledConfigs = this.plugin.settings.apiConfigs.filter(config => config.enabled);

		new Setting(containerEl)
			.setName('快速翻译API')
			.setDesc('选择快速翻译功能使用的API配置')
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
			.setName('英语分析API')
			.setDesc('选择英语分析功能使用的API配置')
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
			.setName('日语分析API')
			.setDesc('选择日语分析功能使用的API配置')
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
		containerEl.createEl('h3', {text: '📝 内容定制'});

		// 日语内容定制
		containerEl.createEl('h4', {text: '🇯🇵 日语内容定制'});
        const japaneseSectionToggles: Record<keyof PolyglotHelper['settings']['japaneseSections'], string> = {
            vocabAnalysis: '词汇分析',
            relatedVocab: '相关词汇解析',
            sentences: '例句生成 (不同场景)',
			exercise: '翻译练习',
			jisho: 'Jisho 词典'
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
		containerEl.createEl('h4', {text: '🇺🇸 英语内容定制'});
		const englishSectionToggles: Record<keyof EnglishSections, string> = {
            definitions: '词典释义 (核心)',
            example: '例句 (LLM生成)',
            usage: '用法助记 (搭配/同反义词/技巧)',
            etymology: '词源',
            medical: '医学专用',
            slang: '俚语 (Urban Dictionary)',
            tatoeba: 'Tatoeba 真实世界例句',
            idioms: '相关习语'
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
		containerEl.createEl('h3', {text: '语音'});

		// 音频文件存储设置
		containerEl.createEl('h4', {text: '📁 音频文件设置'});

		new Setting(containerEl)
			.setName('日语音频文件存储路径')
			.setDesc('用于保存日语单词或句子音频文件的基本路径。')
			.addText(text => text
				.setPlaceholder('例如: Polyglot/Audio/Japanese')
				.setValue(this.plugin.settings.japaneseAudioPath || 'Audio/Japanese')
				.onChange(async (value) => {
					this.plugin.settings.japaneseAudioPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('自动保存音频文件')
			.setDesc('启用后，TTS生成的音频文件会自动保存到指定路径。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSaveAudio || false)
				.onChange(async (value) => {
					this.plugin.settings.autoSaveAudio = value;
					await this.plugin.saveSettings();
				}));

		// TTS Engine for Japanese
		containerEl.createEl('h4', {text: '🎤 TTS 音频生成'});
		new Setting(containerEl)
			.setName('TTS 引擎选择')
			.addDropdown(dropdown => dropdown
				.addOption('openai', 'OpenAI TTS')
				.addOption('youdao', '有道 TTS')
				.addOption('gemini', 'Gemini TTS')
				.setValue(this.plugin.settings.ttsEngine)
				.onChange(async (value: 'openai' | 'youdao' | 'gemini') => {
					this.plugin.settings.ttsEngine = value;
					await this.plugin.saveSettings();
					this.display();
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
		audioFormatDiv.createEl('h4', { text: '📋 音频格式信息' });
		audioFormatDiv.createEl('p', { text: '• 支持格式: MP3, WAV, M4A' });
		audioFormatDiv.createEl('p', { text: '• 默认格式: MP3 (兼容性最佳)' });
		audioFormatDiv.createEl('p', { text: '• 音频文件会自动嵌入到翻译结果中' });
	}

	private displayUISettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', {text: '学习与界面'});

		// 学习进度追踪设置
		
		new Setting(containerEl)
			.setName('启用学习进度追踪')
			.setDesc('开启后可以追踪单词学习进度，支持间隔重复复习。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableLearningTracker)
				.onChange(async (value) => {
					this.plugin.settings.enableLearningTracker = value;
					await this.plugin.saveSettings();
					this.display();
				}));
		
		if (this.plugin.settings.enableLearningTracker) {
			new Setting(containerEl)
				.setName('自动添加词汇到词汇库')
				.setDesc('分析文本时自动提取并添加词汇到对应的词汇库。')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.autoAddToVocab || false)
					.onChange(async (value) => {
						this.plugin.settings.autoAddToVocab = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('每日学习目标')
				.setDesc('设置每天计划学习的新单词数量。')
				.addSlider(slider => slider
					.setLimits(1, 50, 1)
					.setValue(this.plugin.settings.dailyGoal)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.dailyGoal = value;
						await this.plugin.saveSettings();
					}));
			
			// 复习间隔设置
			const intervalDesc = document.createDocumentFragment();
			intervalDesc.append(
				'设置间隔重复的天数序列，用逗号分隔。',
				intervalDesc.createEl('br'),
				'例如: 1,3,7,14,30,90,180 表示第一次复习在1天后，第二次在3天后，依此类推。'
			);
			
			new Setting(containerEl)
				.setName('复习间隔设置')
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
			const statsInfo = document.createDocumentFragment();
			statsInfo.append(
				`总词汇量: ${this.plugin.settings.learningStats.totalWords} 词`,
				statsInfo.createEl('br'),
				`总复习次数: ${this.plugin.settings.learningStats.totalReviews} 次`,
				statsInfo.createEl('br'),
				`学习连续天数: ${this.plugin.settings.learningStats.streakDays} 天`
			);
			
			new Setting(containerEl)
				.setName('学习统计')
				.setDesc(statsInfo);
			
			new Setting(containerEl)
				.setName('重置学习数据')
				.setDesc('警告：此操作将清除所有学习进度和统计数据，无法恢复。')
				.addButton(button => button
					.setButtonText('重置数据')
					.setWarning()
					.onClick(async () => {
						const confirmed = confirm('确定要重置所有学习数据吗？此操作无法撤销。');
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
							this.display();
							new Notice('学习数据已重置。');
						}
					}));
		}
		
		// 音频和翻译内容定制设置已移动到对应的标签页

	}

	private displayCacheSettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', {text: '缓存'});

		// 创建智能清理区域
		this.createSmartCleanupSection(containerEl);

		// 快速清理选项
		const quickCleanDiv = containerEl.createDiv({ cls: 'polyglot-quick-clean-section' });
		quickCleanDiv.createEl('h4', { text: '快速清理' });

		// 翻译缓存清理
		new Setting(quickCleanDiv)
			.setName('清理翻译缓存')
			.setDesc('清理所有翻译相关的缓存文件（保留音频文件）')
			.addButton(button => {
				button
					.setButtonText('📝 清理翻译缓存')
					.onClick(async () => {
						try {
							await this.plugin.clearTranslationCache();
						} catch (error) {
							new Notice(`清理失败: ${error.message}`);
						}
					});
			});

		// 音频缓存清理
		new Setting(quickCleanDiv)
			.setName('清理音频缓存')
			.setDesc('清理所有音频文件缓存（保留翻译缓存）')
			.addButton(button => {
				button
					.setButtonText('🎵 清理音频缓存')
					.onClick(async () => {
						try {
							await this.plugin.clearAudioCache();
						} catch (error) {
							new Notice(`清理失败: ${error.message}`);
						}
					});
			});

		// 全部清理
		new Setting(quickCleanDiv)
			.setName('清理所有缓存')
			.setDesc('⚠️ 清理所有缓存数据，包括翻译和音频文件')
			.addButton(button => {
				button
					.setButtonText('🗑️ 清理所有缓存')
					.setWarning()
					.onClick(async () => {
						const confirmed = confirm('确定要清理所有缓存吗？此操作不可撤销！');
						if (confirmed) {
							try {
								await this.plugin.clearAllCache();
							} catch (error) {
								new Notice(`清理失败: ${error.message}`);
							}
						}
					});
			});
	}

	private displayAdvancedSettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', {text: '高级'});

		new Setting(containerEl)
			.setName('启用调试模式')
			.setDesc('启用后会在控制台输出详细的调试信息')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugMode || false)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('自动保存设置')
			.setDesc('修改设置后自动保存')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSave || true)
				.onChange(async (value) => {
					this.plugin.settings.autoSave = value;
					await this.plugin.saveSettings();
				}));

		// 开发者信息
		const devInfo = containerEl.createDiv({ cls: 'polyglot-dev-info' });
		devInfo.createEl('h4', { text: '📋 插件信息' });
		devInfo.createEl('p', { text: `版本: ${this.plugin.manifest.version}` });
		devInfo.createEl('p', { text: `作者: ${this.plugin.manifest.author}` });
		devInfo.createEl('p', { text: `描述: ${this.plugin.manifest.description}` });
	}

	private createLanguagePathSettings(containerEl: HTMLElement, title: string, settingsKey: keyof Pick<PolyglotHelperSettings, 'japaneseOutputSettings' | 'englishOutputSettings' | 'quickTranslationOutputSettings'>) {
		containerEl.createEl('h5', {text: title});

		const settings = this.plugin.settings[settingsKey];

		new Setting(containerEl)
			.setName('新文件存放位置')
			.setDesc('当选择"创建新文件"时，此语言专用的文件夹路径。留空则使用通用设置。')
			.addText(text => text
				.setPlaceholder('例如: Japanese/')
				.setValue(settings.newFileLocation)
				.onChange(async (value) => {
					this.plugin.settings[settingsKey].newFileLocation = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('固定输出文件')
			.setDesc('当选择"固定文件"时，此语言专用的文件路径。留空则使用通用设置。')
			.addText(text => text
				.setPlaceholder('例如: Japanese/日语学习记录.md')
				.setValue(settings.fixedOutputFile)
				.onChange(async (value) => {
					this.plugin.settings[settingsKey].fixedOutputFile = value;
					await this.plugin.saveSettings();
				}));
	}

	private displayOpenAITTSSettings(containerEl: HTMLElement) {
		containerEl.createEl('h5', {text: 'OpenAI TTS 设置'});
		new Setting(containerEl).setName('TTS 接口地址 (Base URL)').addText(text => text.setValue(this.plugin.settings.openaiTtsBaseUrl || '').onChange(async (value) => { this.plugin.settings.openaiTtsBaseUrl = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('TTS API Key').setDesc("如果留空，将使用上面的 OpenAI API Key").addText(text => { text.inputEl.type = 'password'; text.setValue(this.plugin.settings.openaiTtsApiKey || '').onChange(async (value) => { this.plugin.settings.openaiTtsApiKey = value; await this.plugin.saveSettings(); }); });
		new Setting(containerEl).setName('TTS 模型名称').setDesc('例如: tts-1, tts-1-hd').addText(text => text.setValue(this.plugin.settings.openaiTtsModel || '').onChange(async (value) => { this.plugin.settings.openaiTtsModel = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('TTS 声音').setDesc('例如: alloy, echo, fable, onyx, nova, shimmer').addText(text => text.setValue(this.plugin.settings.openaiTtsVoice || '').onChange(async (value) => { this.plugin.settings.openaiTtsVoice = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('TTS 语速').setDesc('范围: 0.25 - 4.0 (默认: 1.0)').addText(text => text.setValue(String(this.plugin.settings.openaiTtsSpeed || 1.0)).onChange(async (value) => { const speed = parseFloat(value); if (!isNaN(speed)) { this.plugin.settings.openaiTtsSpeed = speed; await this.plugin.saveSettings(); } }));

		// 添加测试按钮
		new Setting(containerEl)
			.setName('测试 OpenAI TTS')
			.setDesc('测试 OpenAI TTS 配置是否正确')
			.addButton(button => button
				.setButtonText('测试')
				.onClick(async () => {
					button.setButtonText('测试中...');
					button.setDisabled(true);

					try {
						const testText = 'こんにちは';
						const audioBuffer = await this.plugin.testTtsAudio(testText);

						if (audioBuffer) {
							new Notice('OpenAI TTS 测试成功！');
						} else {
							new Notice('OpenAI TTS 测试失败，请检查配置和网络连接');
						}
					} catch (error) {
						new Notice(`OpenAI TTS 测试失败: ${error.message}`);
						this.plugin.logger.error('OpenAI TTS 测试失败', error);
					} finally {
						button.setButtonText('测试');
						button.setDisabled(false);
					}
				}));
	}

	private displayYoudaoTTSSettings(containerEl: HTMLElement) {
		containerEl.createEl('h5', {text: '有道 TTS 设置'});
		new Setting(containerEl).setName('有道应用 AppKey').addText(text => { text.inputEl.type = 'password'; text.setValue(this.plugin.settings.youdaoAppKey || '').onChange(async (value) => { this.plugin.settings.youdaoAppKey = value; await this.plugin.saveSettings(); }); });
		new Setting(containerEl).setName('有道应用 AppSecret').addText(text => { text.inputEl.type = 'password'; text.setValue(this.plugin.settings.youdaoAppSecret || '').onChange(async (value) => { this.plugin.settings.youdaoAppSecret = value; await this.plugin.saveSettings(); }); });

		// 添加测试按钮
		new Setting(containerEl)
			.setName('测试有道 TTS')
			.setDesc('测试有道 TTS 配置是否正确')
			.addButton(button => button
				.setButtonText('测试')
				.onClick(async () => {
					button.setButtonText('测试中...');
					button.setDisabled(true);

					try {
						const testText = 'こんにちは';
						const audioBuffer = await this.plugin.testTtsAudio(testText);

						if (audioBuffer) {
							new Notice('有道 TTS 测试成功！');
						} else {
							new Notice('有道 TTS 测试失败，请检查配置和网络连接');
						}
					} catch (error) {
						new Notice(`有道 TTS 测试失败: ${error.message}`);
						this.plugin.logger.error('有道 TTS 测试失败', error);
					} finally {
						button.setButtonText('测试');
						button.setDisabled(false);
					}
				}));
	}

	private displayGeminiTTSSettings(containerEl: HTMLElement) {
		containerEl.createEl('h5', {text: 'Gemini TTS 设置'});

		new Setting(containerEl)
			.setName('Gemini TTS Base URL')
			.setDesc('Gemini TTS API 的基础URL')
			.addText(text => text
				.setValue(this.plugin.settings.geminiTtsBaseUrl || '')
				.onChange(async (value) => {
					this.plugin.settings.geminiTtsBaseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Gemini TTS API Key')
			.setDesc('输入你的 Gemini API Key')
			.addText(text => {
				text.inputEl.type = 'password';
				text.setValue(this.plugin.settings.geminiTtsApiKey || '')
					.onChange(async (value) => {
						this.plugin.settings.geminiTtsApiKey = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Gemini TTS 模型名称')
			.setDesc('例如: tts-1, tts-1-hd')
			.addText(text => text
				.setValue(this.plugin.settings.geminiTtsModel || '')
				.onChange(async (value) => {
					this.plugin.settings.geminiTtsModel = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Gemini TTS 语音')
			.setDesc('选择 Gemini TTS 的语音类型')
			.addDropdown(dropdown => {
				// 添加图中显示的所有语音选项
				const voices = [
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
			.setName('Gemini TTS 语速')
			.setDesc('范围: 0.25 - 4.0 (默认: 1.0)')
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
			.setName('测试 Gemini TTS')
			.setDesc('测试 Gemini TTS 配置是否正确')
			.addButton(button => button
				.setButtonText('测试')
				.onClick(async () => {
					button.setButtonText('测试中...');
					button.setDisabled(true);

					try {
						const testText = 'こんにちは';
						const audioBuffer = await this.plugin.testTtsAudio(testText);

						if (audioBuffer) {
							new Notice('Gemini TTS 测试成功！');
						} else {
							new Notice('Gemini TTS 测试失败，请检查配置和网络连接');
						}
					} catch (error) {
						new Notice(`Gemini TTS 测试失败: ${error.message}`);
						this.plugin.logger.error('Gemini TTS 测试失败', error);
					} finally {
						button.setButtonText('测试');
						button.setDisabled(false);
					}
				}));
	}

	private async createSmartCleanupSection(containerEl: HTMLElement) {
		// 智能清理容器
		const smartCleanupDiv = containerEl.createDiv({ cls: 'polyglot-smart-cleanup-section' });
		smartCleanupDiv.createEl('h4', { text: '🧠 智能缓存清理' });

		// 加载缓存数据 - 使用动态导入以支持移动端
		const { CacheManager } = await import('./cache-manager');
		const cacheManager = new CacheManager(
			this.app,
			this.plugin.logger,
			this.plugin.manifest.dir || ''
		);

		let allItems: any[] = [];
		let filteredItems: any[] = [];
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
			text: '🔍 扫描缓存文件',
			cls: 'mod-cta'
		});

		const scanStatus = scanSection.createDiv({ cls: 'polyglot-scan-status' });

		scanButton.addEventListener('click', async () => {
			try {
				scanButton.disabled = true;
				scanButton.textContent = '⏳ 扫描中...';
				scanStatus.textContent = '';

				allItems = await cacheManager.scanAllCache();
				filteredItems = [...allItems];
				selectedItems.clear();

				scanButton.disabled = false;
				scanButton.textContent = '🔍 重新扫描';
				scanStatus.textContent = `✅ 扫描完成，找到 ${allItems.length} 个缓存文件`;

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
				scanButton.textContent = '🔍 扫描缓存文件';
				scanStatus.textContent = `❌ 扫描失败: ${error.message}`;
			}
		});
	}

	private createFilterAndPreviewSection(containerEl: HTMLElement, data: any) {
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

	private createInlineFilterSection(containerEl: HTMLElement, data: any) {
		const filterDiv = containerEl.createDiv({ cls: 'polyglot-inline-filter' });
		filterDiv.createEl('h5', { text: '📋 筛选条件' });

		const filterRow = filterDiv.createDiv({ cls: 'polyglot-filter-row' });

		// 类型筛选
		const typeSelect = filterRow.createEl('select', { cls: 'polyglot-filter-select' });
		typeSelect.createEl('option', { value: 'all', text: '🔄 所有类型' });
		typeSelect.createEl('option', { value: 'translation', text: '📝 翻译缓存' });
		typeSelect.createEl('option', { value: 'audio', text: '🎵 音频缓存' });

		// 时间筛选
		const timeSelect = filterRow.createEl('select', { cls: 'polyglot-filter-select' });
		timeSelect.createEl('option', { value: '', text: '🕐 所有时间' });
		timeSelect.createEl('option', { value: '1', text: '1天前' });
		timeSelect.createEl('option', { value: '7', text: '1周前' });
		timeSelect.createEl('option', { value: '30', text: '1个月前' });
		timeSelect.createEl('option', { value: '90', text: '3个月前' });

		// 大小筛选
		const sizeSelect = filterRow.createEl('select', { cls: 'polyglot-filter-select' });
		sizeSelect.createEl('option', { value: '', text: '📦 所有大小' });
		sizeSelect.createEl('option', { value: '1024', text: '> 1KB' });
		sizeSelect.createEl('option', { value: '10240', text: '> 10KB' });
		sizeSelect.createEl('option', { value: '102400', text: '> 100KB' });
		sizeSelect.createEl('option', { value: '1048576', text: '> 1MB' });

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

	private createInlinePreviewSection(containerEl: HTMLElement, data: any) {
		const previewDiv = containerEl.createDiv({ cls: 'polyglot-inline-preview' });
		previewDiv.createEl('h5', { text: '👀 预览结果' });

		// 统计信息
		const statsDiv = previewDiv.createDiv({ cls: 'polyglot-inline-stats' });

		// 全选控制
		const selectAllDiv = previewDiv.createDiv({ cls: 'polyglot-inline-select-all' });
		const selectAllCheckbox = selectAllDiv.createEl('input', { type: 'checkbox' });
		selectAllDiv.createEl('label', { text: '全选/取消全选' });

		selectAllCheckbox.addEventListener('change', () => {
			if (selectAllCheckbox.checked) {
				data.filteredItems.forEach((item: any) => data.selectedItems.add(item.path));
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

	private createInlineActionButtons(containerEl: HTMLElement, data: any) {
		const buttonDiv = containerEl.createDiv({ cls: 'polyglot-inline-actions' });

		// 清理按钮
		const cleanButton = buttonDiv.createEl('button', {
			text: '🗑️ 清理选中项',
			cls: 'mod-warning'
		});

		cleanButton.addEventListener('click', async () => {
			if (data.selectedItems.size === 0) {
				new Notice('请先选择要清理的文件');
				return;
			}

			const confirmed = confirm(`确定要删除 ${data.selectedItems.size} 个缓存文件吗？此操作不可撤销！`);
			if (!confirmed) return;

			try {
				cleanButton.disabled = true;
				cleanButton.textContent = '⏳ 清理中...';

				const selectedPaths = Array.from(data.selectedItems);
				await data.cacheManager.deleteItems(selectedPaths);

				// 重新扫描
				data.allItems = await data.cacheManager.scanAllCache();
				data.selectedItems.clear();
				this.applyInlineFilter(data);
				this.updateInlinePreview(data);

				cleanButton.disabled = false;
				cleanButton.textContent = '🗑️ 清理选中项';
				new Notice(`成功清理 ${selectedPaths.length} 个缓存文件`);

			} catch (error) {
				cleanButton.disabled = false;
				cleanButton.textContent = '🗑️ 清理选中项';
				new Notice(`清理失败: ${error.message}`);
			}
		});
	}

	private applyInlineFilter(data: any) {
		const { allItems, filter } = data;

		data.filteredItems = allItems.filter((item: any) => {
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

	private updateInlinePreview(data: any) {
		const { filteredItems, selectedItems, statsDiv, listDiv, selectAllCheckbox } = data;

		// 更新统计信息
		const totalSize = filteredItems.reduce((sum: number, item: any) => sum + item.size, 0);
		const selectedSize = filteredItems
			.filter((item: any) => selectedItems.has(item.path))
			.reduce((sum: number, item: any) => sum + item.size, 0);

		const formatSize = (bytes: number) => {
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		};

		statsDiv.innerHTML = `
			<div class="polyglot-stat-item">📊 筛选结果: ${filteredItems.length} 个文件 (${formatSize(totalSize)})</div>
			<div class="polyglot-stat-item selected">✅ 已选择: ${selectedItems.size} 个文件 (${formatSize(selectedSize)})</div>
		`;

		// 更新文件列表
		listDiv.innerHTML = '';

		if (filteredItems.length === 0) {
			listDiv.createEl('div', {
				text: '没有找到符合条件的缓存文件',
				cls: 'polyglot-empty-message'
			});
			return;
		}

		// 限制显示数量
		const displayItems = filteredItems.slice(0, 50);
		if (filteredItems.length > 50) {
			listDiv.createEl('div', {
				text: `显示前50个文件，共${filteredItems.length}个`,
				cls: 'polyglot-limit-message'
			});
		}

		displayItems.forEach((item: any) => {
			const itemDiv = listDiv.createDiv({ cls: 'polyglot-inline-item' });

			const checkbox = itemDiv.createEl('input', { type: 'checkbox' });
			checkbox.checked = selectedItems.has(item.path);

			const infoDiv = itemDiv.createDiv({ cls: 'polyglot-item-info' });
			infoDiv.createEl('div', { text: item.name, cls: 'polyglot-item-name' });
			infoDiv.createEl('div', {
				text: `${formatSize(item.size)} • ${new Date(item.lastModified).toLocaleDateString()}`,
				cls: 'polyglot-item-details'
			});

			const typeTag = itemDiv.createEl('span', {
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
