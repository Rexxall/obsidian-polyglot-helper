export interface EnglishSections {
    definitions: boolean;
    example: boolean;
    usage: boolean;
    etymology: boolean;
    medical: boolean;
    slang: boolean;
    tatoeba: boolean;
    idioms: boolean;
}

export interface JapaneseSections {
    vocabAnalysis: boolean;
    relatedVocab: boolean;
    sentences: boolean;
    exercise: boolean;
    jisho: boolean;
}

export interface ApiConfig {
    name: string;
    apiKey: string;
    baseUrl: string;
    model: string;
    enabled: boolean;
}

export interface PolyglotHelperSettings {
    debugMode?: boolean;
    autoSave?: boolean;
    voiceSynthesis?: { rate?: number; voice?: string };
	// General Settings
	outputDestination: 'replace' | 'appendCurrent' | 'newFile' | 'sidebar' | 'fixedFile';
	newFileLocation: string;
	fixedOutputFile: string;

	// 语言特定路径设置（仅用于固定文件和新文件模式）
	japaneseOutputSettings: {
		newFileLocation: string;
		fixedOutputFile: string;
	};
	englishOutputSettings: {
		newFileLocation: string;
		fixedOutputFile: string;
	};
	quickTranslationOutputSettings: {
		newFileLocation: string;
		fixedOutputFile: string;
	};

	// 快速翻译选项
	quickTranslationOptions?: {
		showRomaji: boolean; // 在日语快速翻译结果中标注罗马音
		playAudio: boolean; // 是否播放音频
		outputDestination: 'replace' | 'appendCurrent' | 'newFile' | 'sidebar' | 'fixedFile'; // 快速翻译的专属输出位置
	};

	queryHistory: HistoryItem[];
	forceRefresh: boolean;

	// UI Settings
	autoAddToVocab?: boolean;
	reviewReminder?: boolean;
	theme?: 'auto' | 'light' | 'dark';
	lastSelectedMode?: 'japanese' | 'english' | 'quick_to_japanese' | 'quick_english'; // 记住上次选择的模式
	wordSelectionMode?: boolean; // 选词模式：开启后鼠标选择的词汇直接加入文本框
	showDueInStatusBar?: boolean; // 状态栏显示待复习数，点一下进复习
	vocabExportFolder?: string; // 词库导出（闪卡笔记、Anki 文本）所在文件夹

	// Audio Settings
	enableTTS?: boolean;
	audioQuality?: 'standard' | 'high' | 'premium';
	speechRate?: number;
	audioStoragePath?: string;
	enableAudioCache?: boolean;
	autoPlayAudio?: boolean;

	// API配置管理
	apiConfigs: ApiConfig[];

	// 功能API选择器
	apiSelectors: {
		quickTranslation: string; // 快速翻译使用的API配置名称
		englishAnalysis: string;  // 英语分析使用的API配置名称
		japaneseAnalysis: string; // 日语分析使用的API配置名称
	};

	// English Processor Settings
	englishLlmApiKey: string; // This might be the same as openaiApiKey
	englishLlmBaseUrl: string;
	englishModelName: string;
	mwThesaurusKey: string;
	mwMedicalKey: string;
	englishSections: EnglishSections;
	japaneseSections: JapaneseSections;

	// Japanese Processor Settings
	// LLM Provider for Japanese
	llmProvider: 'openai' | 'ollama';
	openaiApiKey?: string;
	openaiLlmBaseUrl?: string;
	ollamaUrl?: string;
	ollamaModel?: string;

	// TTS Engine for Japanese
	ttsEngine: 'openai' | 'youdao' | 'gemini';
	
	// OpenAI TTS Settings
	openaiTtsApiKey?: string; // This might be the same as openaiApiKey
	openaiTtsBaseUrl?: string;
	openaiTtsModel?: string;
	openaiTtsVoice?: string;
	openaiTtsSpeed?: number;

	// Youdao TTS Settings
	youdaoAppKey?: string;
	youdaoAppSecret?: string;

	// Gemini TTS Settings
	geminiTtsApiKey?: string;
	geminiTtsBaseUrl?: string;
	geminiTtsModel?: string;
	geminiTtsVoice?: string;
	geminiTtsSpeed?: number;

	// Japanese Processor Settings
	japaneseAudioPath: string;
	autoSaveAudio: boolean;
	forceRefreshAudio: boolean;
	disableJapaneseVoiceDuringAnalysis: boolean;

	// 学习进度追踪设置
	enableLearningTracker: boolean;
	learningStats: LearningStats;

	// 分离的词库
	japaneseVocabItems: Record<string, JapaneseVocabularyItem>;
	englishVocabItems: Record<string, EnglishVocabularyItem>;
	vocabItems: Record<string, VocabularyItem>; // 保留兼容性
	
	// 简化的词汇库（新的简化系统）
	simpleVocabulary?: Record<string, SimpleVocabularyItem>;

	dailyGoal: number;
	reviewIntervals: number[];

	// 云同步设置
	cloudSync: {
		enabled: boolean;
		endpoint: string;
		apiKey: string;
		autoSync: boolean;
		syncInterval: number; // 分钟
		lastSync: number;
	};

	// 语音识别和学习计划功能已移除
}

export interface DictionaryInfo {
	phonetics: string;
	meanings: string[];
	examples: string[];
	synonyms: string[];
	antonyms: string[];
}

export interface UrbanDictionaryInfo {
	slang_meaning: string;
	slang_example: string;
	tags: string[];
}

export interface MerriamWebsterInfo {
	medical_definitions?: string[];
	definitions?: string[];
	partOfSpeech?: string;
	synonyms?: string[];
	antonyms?: string[];
}

export interface EtymologyInfo {
	etymology: string;
}

export interface IdiomsInfo {
	idioms: string[];
}

export interface LlmInfo {
	definitions?: { en: string; cn: string }[];
	example_sentence?: { en: string; cn: string };
	etymology?: { en: string; cn: string };
	context_usage?: { en: string; cn: string };
	related_idioms?: { en: string; cn: string }[];
}

export interface HistoryItem {
	query: string;
	type: 'english' | 'japanese' | 'quick_english' | 'quick_to_japanese';
	timestamp?: number;
	sections: EnglishSections | JapaneseSections | Record<string, never>;
	translation?: string; // 用于存储翻译结果
	romaji?: string; // 快速日语翻译的罗马音（可选）
	outputLocation?: {
		destination: 'replace' | 'appendCurrent' | 'newFile' | 'sidebar' | 'fixedFile';
		filePath?: string; // 如果是文件输出，记录文件路径
		fileName?: string; // 如果是新文件，记录文件名
		heading?: string; // 保存标题中的词语部分，用于精确定位
	};
}

// 学习进度追踪相关接口
export interface LearningStats {
	dailyStats: Record<string, DailyRecord>;
	totalWords: number;
	totalReviews: number;
	streakDays: number;
	lastStudyDate: string;
}

export interface DailyRecord {
	date: string;
	newWords: number;
	reviewedWords: number;
	correctCount: number;
	incorrectCount: number;
}

export interface VocabularyItem {
	word: string;
	translation: string;
	notes?: string;
	examples?: string[];
	tags?: string[];
	createdAt: number;
	lastReviewed?: number;
	nextReview?: number;
	reviewCount: number;
	difficulty: number; // 0-4, 0最简单，4最难
	reviewHistory: ReviewRecord[];
	phonetics?: string;
	partOfSpeech?: string;
	masteryLevel?: number;
	addedAt?: number;
}

export interface ReviewRecord {
	timestamp: number;
	performance: number; // 0-5, 0表示不认识，5表示非常熟悉
	timeSpent?: number; // 毫秒
}

// 日语词汇项 - 标题使用原文（中文），日文作为复习单词
export interface JapaneseVocabularyItem {
	originalText: string; // 原文（中文）- 用作标题
	japaneseText: string; // 日文 - 用作复习单词
	reading?: string; // 读音
	translation: string; // 翻译
	notes?: string;
	examples?: string[];
	tags?: string[];
	createdAt: number;
	reviewCount: number;
	difficulty: number; // 0-4, 0 = mastered
	reviewHistory: ReviewRecord[];
	lastReviewed?: number;
	nextReview?: number;
	isFavorite?: boolean;
}

// 英语词汇项
export interface EnglishVocabularyItem {
	word: string; // 英文单词
	translation: string; // 中文翻译
	phonetics?: string; // 音标
	partOfSpeech?: string; // 词性
	definitions?: string[]; // 定义
	notes?: string;
	examples?: string[];
	tags?: string[];
	createdAt: number;
	reviewCount: number;
	difficulty: number; // 0-4, 0 = mastered
	reviewHistory: ReviewRecord[];
	lastReviewed?: number;
	nextReview?: number;
	isFavorite?: boolean;
}

// 简化的词汇项（新的简化系统）
export interface SimpleVocabularyItem {
	word: string;
	translation: string;
	notes: string;
	createdAt: number;
	lastReviewed: number;
	reviewCount: number;
	isFavorite: boolean;
}
