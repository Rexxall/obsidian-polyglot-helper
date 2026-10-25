export function cleanFileName(text: string, maxLength = 30): string {
    // 移除HTML标签
    const withoutHtml = text.replace(/<[^>]*>/g, '');
    // 替换特殊字符为下划线，但保留中文、日文、英文字符
    const cleaned = withoutHtml.replace(/[\\/:*?"<>|\s.，。！？、]+/g, '_');
    // 限制长度
    return cleaned.substring(0, maxLength) || "audio";
}

export function generateUniqueFileName(text: string): string {
    const cleanText = text.replace(/<ruby>.*?<rt>.*?<\/rt><\/ruby>/g, '$1');
    const baseName = cleanFileName(cleanText, 20); // 减少基础名称长度
    const hash = Array.from(text).reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 0).toString(16).substring(0, 5);
    const timestamp = Date.now().toString().slice(-4);
    return `${baseName}_${hash}_${timestamp}.mp3`;
}

/**
 * 为相同文本生成相同的文件名（用于音频缓存）
 */
export function generateConsistentFileName(text: string): string {
    const cleanText = text.replace(/<ruby>.*?<rt>.*?<\/rt><\/ruby>/g, '$1');
    const baseName = cleanFileName(cleanText, 30); // 增加长度限制
    // 使用文本内容的哈希值作为唯一标识，而不是时间戳
    const hash = Array.from(text).reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 0).toString(16);
    return `${baseName}_${hash}.mp3`;
}