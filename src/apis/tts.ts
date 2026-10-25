import { requestUrl, Notice } from 'obsidian';
import OpenAI from 'openai';
import { PolyglotHelperSettings } from '../types';
import { Logger } from '../logger';

// 辅助函数：截断文本用于有道API签名
function truncate(q: string): string {
    const len = q.length;
    if (len <= 20) return q;
    return q.substring(0, 10) + len + q.substring(len - 10, len);
}

// SHA256签名函数 - 移动端兼容版本
async function sha256(str: string): Promise<string> {
    try {
        // 优先使用 Web Crypto API（移动端支持）
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const encoder = new TextEncoder();
            const data = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
            // 降级方案：使用简单的哈希（仅用于有道API）
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // 转换为32位整数
            }
            return Math.abs(hash).toString(16);
        }
    } catch (error) {
        // 如果所有方法都失败，返回简单哈希
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }
}

async function getOpenaiTtsAudioTS(
    text: string,
    settings: PolyglotHelperSettings,
    logger: Logger,
    customSpeed?: number
): Promise<ArrayBuffer | null> {
    if (!settings.openaiTtsApiKey || !settings.openaiTtsBaseUrl) {
        logger.info("OpenAI TTS API 密钥或 Base URL 未提供。");
        return null;
    }
    try {
        const openai = new OpenAI({
            apiKey: settings.openaiTtsApiKey,
            baseURL: settings.openaiTtsBaseUrl,
            dangerouslyAllowBrowser: true,
        });

        // 使用语音合成设置或默认值
        const voiceSettings = settings.voiceSynthesis;
        const speed = customSpeed || voiceSettings?.rate || settings.openaiTtsSpeed || 1.0;
        const clampedSpeed = Math.max(0.25, Math.min(4.0, speed));

        // 选择语音类型
        let voice = settings.openaiTtsVoice || 'alloy';
        if (voiceSettings?.voice && voiceSettings.voice !== 'default') {
            voice = voiceSettings.voice;
        }

        const response = await openai.audio.speech.create({
            model: settings.openaiTtsModel || 'tts-1',
            voice: voice as any,
            input: `「${text}」`,
            speed: clampedSpeed,
        });

        return await response.arrayBuffer();
    } catch (error) {
        logger.error("OpenAI TTS API (SDK) 调用失败", error);
        new Notice(`OpenAI TTS API 调用失败: ${error.message}`);
        return null;
    }
}

async function getYoudaoTtsAudioTS(
    text: string,
    settings: PolyglotHelperSettings,
    logger: Logger,
    customSpeed?: number
): Promise<ArrayBuffer | null> {
    if (!settings.youdaoAppKey || !settings.youdaoAppSecret) {
        logger.info("有道 TTS AppKey 或 AppSecret 未提供。");
        new Notice("有道 TTS 配置不完整，请检查 AppKey 和 AppSecret");
        return null;
    }

    // 检查文本长度限制 - 根据官方文档，UTF-8编码长度不能超过2048
    const textBytes = new TextEncoder().encode(text).length;
    if (textBytes > 2048) {
        logger.error(`有道 TTS 文本UTF-8编码长度超过限制 (${textBytes}/2048字节)`);
        new Notice("文本过长，有道TTS限制为2048字节");
        return null;
    }

    // 根据官方文档的参数设置
    const salt = Date.now().toString();
    const curtime = Math.round(Date.now() / 1000).toString();

    // 有道TTS的正确签名算法 - 使用SHA256
    const input = truncate(text);
    const signStr = settings.youdaoAppKey + input + salt + curtime + settings.youdaoAppSecret;
    const sign = await sha256(signStr);

    const speed = customSpeed || 1.0;
    const clampedSpeed = Math.max(0.5, Math.min(2.0, speed));

    // 构建POST请求体参数 - 根据官方文档使用POST方式
    const formData = new URLSearchParams({
        q: text,
        appKey: settings.youdaoAppKey,
        salt: salt,
        sign: sign,
        signType: 'v3', // 官方文档要求
        curtime: curtime,
        format: 'mp3',
        speed: clampedSpeed.toString(),
        voiceName: 'youkejiang' // 有道日语女声
    });

    try {
        logger.info(`有道TTS请求参数: appKey=${settings.youdaoAppKey}, salt=${salt}, sign=${sign.substring(0, 8)}..., curtime=${curtime}`);
        logger.info(`有道TTS请求文本: "${text}"`);
        logger.info(`有道TTS input: "${input}"`);
        logger.info(`有道TTS签名字符串: ${settings.youdaoAppKey}${input}${salt}${curtime}${settings.youdaoAppSecret.substring(0, 4)}...`);
        logger.info(`有道TTS完整请求体: ${formData.toString()}`);

        const response = await requestUrl({
            url: 'https://openapi.youdao.com/ttsapi',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            body: formData.toString()
        });

        // 根据官方文档：需要根据Content-Type的值来确定合成是否成功
        const contentType = response.headers['content-type'] || '';
        logger.info(`有道TTS响应类型: ${contentType}, 状态码: ${response.status}`);

        if (contentType.includes('audio/mp3')) {
            // 如果合成成功，正常返回为二进制语音文件，具体header信息 Content-type: audio/mp3
            logger.info("有道TTS成功返回音频数据");
            return response.arrayBuffer;
        } else if (contentType.includes('application/json')) {
            // 如果合成出现错误，则会返回json结果，具体header信息为：Content-type: application/json
            let errorInfo;
            try {
                errorInfo = response.json;
                logger.error("有道 TTS API 返回JSON错误:", errorInfo);
            } catch (e) {
                const textResponse = response.text || '';
                logger.error("有道 TTS API 返回文本错误:", textResponse);
                errorInfo = { errorCode: 'unknown', text: textResponse };
            }

            logger.error("有道 TTS API 错误详情:", {
                status: response.status,
                contentType: contentType,
                headers: response.headers,
                errorInfo: errorInfo
            });

            // 根据官方文档提供详细的错误信息
            const errorMessages: Record<string, string> = {
                '101': '缺少必填的参数，首先确保必填参数齐全，然后，确认参数书写是否正确',
                '102': '不支持的语言类型',
                '103': '翻译文本过长',
                '104': '不支持的API类型',
                '105': '不支持的签名类型',
                '106': '不支持的响应类型',
                '107': '不支持的传输加密类型',
                '108': '应用ID无效，注册账号，登录后台创建应用和实例并完成绑定',
                '109': 'batchLog格式不正确',
                '110': '无相关服务的有效实例，应用没有绑定服务',
                '111': '开发者账号无效',
                '112': '请求服务无效',
                '113': 'q不能为空',
                '201': '解密失败，可能为DES,BASE64,URLDecode的错误',
                '202': '签名检验失败',
                '203': '访问IP地址不在可访问IP列表',
                '206': '因为时间戳无效导致签名校验失败',
                '207': '重放请求(接口salt+curtime来防重放)',
                '301': '辞典查询失败',
                '302': '翻译查询失败',
                '303': '服务端的其它异常',
                '401': '账户已经欠费停',
                '411': '访问频率受限,请稍后访问',
                '412': '长请求过于频繁，请稍后访问',
                '2004': '合成字符过长',
                '2005': '不支持的音频文件类型',
                '2006': '不支持的发音类型',
                '2008': '不支持的语速范围',
                '2009': '服务权限异常',
                '2011': '合成音频语速不在参数范围内',
                '2013': 'voiceName参数错误',
                '2201': '解密失败',
                '2301': '服务的异常',
                '2411': '访问频率受限,请稍后访问',
                '2412': '超过最大请求字符数',
                '2413': '包含不合时宜词汇'
            };

            const errorCode = errorInfo?.errorCode || 'unknown';
            const errorMessage = errorMessages[errorCode] || `未知错误 (${errorCode})`;

            new Notice(`有道 TTS 错误 [${errorCode}]: ${errorMessage}`);
            return null;
        } else {
            // 其他类型的响应
            logger.error("有道 TTS API 返回未知类型响应:", {
                status: response.status,
                contentType: contentType,
                headers: response.headers
            });
            new Notice(`有道 TTS 错误: 服务器返回未知响应类型 (${contentType})`);
            return null;
        }
    } catch (error) {
        logger.error("请求有道 TTS API 失败", error);
        new Notice(`请求有道 TTS API 失败: ${error.message}`);
        return null;
    }
}

async function getGeminiTtsAudioTS(
    text: string,
    settings: PolyglotHelperSettings,
    logger: Logger,
    customSpeed?: number
): Promise<ArrayBuffer | null> {
    if (!settings.geminiTtsApiKey || !settings.geminiTtsBaseUrl) {
        logger.info("Gemini TTS API Key 或 Base URL 未提供。");
        return null;
    }

    // 文本清理和验证
    const cleanedText = text.trim();
    if (!cleanedText) {
        logger.warn("Gemini TTS: 文本为空，跳过生成");
        return null;
    }

    // 文本长度限制（避免过长文本导致API错误）
    if (cleanedText.length > 4000) {
        logger.warn(`Gemini TTS: 文本过长 (${cleanedText.length} 字符)，截断处理`);
        const truncatedText = cleanedText.substring(0, 4000);
        return getGeminiTtsAudioTS(truncatedText, settings, logger, customSpeed);
    }

    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // 完全复制OpenAI TTS的实现，只是使用Gemini的配置
            const openai = new OpenAI({
                apiKey: settings.geminiTtsApiKey,
                baseURL: settings.geminiTtsBaseUrl,
                dangerouslyAllowBrowser: true, // 允许在浏览器环境中使用
            });

            const voice = settings.geminiTtsVoice || 'Zephyr';
            const model = settings.geminiTtsModel || 'tts-1';
            const speed = customSpeed || settings.geminiTtsSpeed || 1.0;

            logger.info(`Gemini TTS请求 (尝试 ${attempt}/${maxRetries}): model=${model}, voice=${voice}, speed=${speed}, text="${cleanedText.substring(0, 50)}..."`);

            const mp3 = await openai.audio.speech.create({
                model: model,
                voice: voice as any,
                input: cleanedText,
                speed: speed,
            });

            // 移动端兼容性：使用 ArrayBuffer 而不是 Buffer
            const arrayBuffer = await mp3.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);
            logger.info(`Gemini TTS成功生成音频 (尝试 ${attempt}/${maxRetries})`);
            return buffer;

        } catch (error) {
            lastError = error;
            logger.warn(`Gemini TTS生成失败 (尝试 ${attempt}/${maxRetries})`, error);

            // 如果是最后一次尝试，记录错误并返回null
            if (attempt === maxRetries) {
                logger.error("Gemini TTS生成失败，已达到最大重试次数", error);

                // 提供更友好的错误信息
                let errorMessage = "未知错误";
                if (error.message) {
                    errorMessage = error.message;
                } else if (error.error?.message) {
                    errorMessage = error.error.message;
                }

                // 只在最后一次失败时显示通知，避免重复通知
                new Notice(`Gemini TTS 错误: ${errorMessage}`);
                return null;
            }

            // 等待一段时间后重试（指数退避）
            const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            logger.info(`等待 ${waitTime}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    return null;
}

export async function getTtsAudioTS(
    text: string,
    settings: PolyglotHelperSettings,
    logger: Logger,
    customSpeed?: number
): Promise<ArrayBuffer | null> {
    logger.info(`为文本生成 TTS 音频: "${text}"`);

    switch (settings.ttsEngine) {
        case 'openai':
            return getOpenaiTtsAudioTS(text, settings, logger, customSpeed);
        case 'youdao':
            return getYoudaoTtsAudioTS(text, settings, logger, customSpeed);
        case 'gemini':
            return getGeminiTtsAudioTS(text, settings, logger, customSpeed);
        default:
            logger.info(`未知的 TTS 引擎: ${settings.ttsEngine}`);
            new Notice(`未知的 TTS 引擎: ${settings.ttsEngine}`);
            return null;
    }
}

/**
 * 批量生成TTS音频
 */
export async function getBatchTtsAudioTS(
    texts: string[],
    settings: PolyglotHelperSettings,
    logger: Logger,
    onProgress?: (current: number, total: number) => void,
    customSpeed?: number
): Promise<Map<string, ArrayBuffer>> {
    const results = new Map<string, ArrayBuffer>();

    for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        if (onProgress) {
            onProgress(i + 1, texts.length);
        }

        try {
            const audio = await getTtsAudioTS(text, settings, logger, customSpeed);
            if (audio) {
                results.set(text, audio);
            }

            // 添加延迟以避免API限制
            if (i < texts.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (error) {
            logger.error(`批量TTS生成失败: ${text}`, error);
        }
    }

    return results;
}

/**
 * 获取支持的语音列表
 */
export function getSupportedVoices(engine: string): string[] {
    switch (engine) {
        case 'openai':
            return ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
        case 'youdao':
            return ['youkejiang', 'youkexiaomei', 'youkexiaoyun'];
        default:
            return [];
    }
}

/**
 * 获取支持的语速范围
 */
export function getSpeedRange(engine: string): { min: number; max: number; default: number } {
    switch (engine) {
        case 'openai':
            return { min: 0.25, max: 4.0, default: 1.0 };
        case 'youdao':
            return { min: 0.5, max: 2.0, default: 1.0 };
        default:
            return { min: 1.0, max: 1.0, default: 1.0 };
    }
}