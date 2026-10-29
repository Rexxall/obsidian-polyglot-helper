<div align="center">

# Polyglot Helper

**Look up an English or Japanese word in your note and get back a study card — meaning, reading, examples and audio — that goes into a word list you review.**

English · [中文](README.zh.md)

<img src="docs/screenshots/hero.png" width="860" alt="An example note on the left; on the right the side panel shows the word card for “postpone”">

</div>

## Start here

1. Install and enable Polyglot Helper, then click the book icon in the left ribbon to open the side panel.
2. Press **Load example**. It writes a short note marked as a demo (delete it whenever you like) and puts “postpone” in the lookup box.
3. Paste one AI key: **Settings → Polyglot Helper → Translation and models**. DeepSeek is preset; press **Test** to check it.
4. Press **Look up**. Next time, select any word in a note and look it up the same way; **Add to word list** keeps it for review.

## What you need and what it costs

| | |
|---|---|
| The plugin | Free, no account. Works on desktop and mobile. |
| An AI service | One OpenAI-compatible key. Presets: DeepSeek (default), Qwen (通义千问), SiliconFlow (硅基流动), Kimi, Zhipu GLM (智谱), OpenRouter, OpenAI, or any compatible endpoint. Billed by that provider per use; one word lookup is a short request. **Test** costs a tiny fraction of a cent. SiliconFlow refuses even its free models while the account balance is zero. |
| Dictionaries and pronunciation | Free public sources, no key. Optional keys: Merriam-Webster (thesaurus and medical sections) and OpenAI, Gemini or Youdao for Japanese speech. |

## What is sent where

| What | Goes to | Stored |
|---|---|---|
| The word or sentence you look up | The dictionaries you enable and your AI service | Lookup cache in the plugin folder |
| Your API keys | Only to the service they belong to | Encrypted in the plugin's `data.json`. The decryption key stays in this device's local storage for this vault, so a synced or copied `data.json` does not expose your keys, and on another device or in a copied vault you enter them once more. |
| Vocabulary list and review history | Nowhere | `data.json` in the plugin folder |
| Debug log | Nowhere | Written only when debug mode is on; keys and looked-up text are left out |

## Screens

<table>
<tr>
<td width="50%"><img src="docs/screenshots/first-open.png" alt="Side panel before any AI service is set up"><br>Before setup, the panel says what is missing and offers the AI settings or an example.</td>
<td width="50%"><img src="docs/screenshots/ai-settings.png" alt="AI configuration with provider, key, endpoint, model and a successful connection test"><br>Provider, key, endpoint and model are separate fields; <b>Test</b> says exactly what is wrong.</td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/learn.png" alt="Learn page with today's due words"><br>Words you add come back on the Learn page when they are due.</td>
<td width="50%"><img src="docs/screenshots/review.jpg" alt="Review card"><br>Review one card at a time and grade how well you knew it.</td>
</tr>
</table>

## Why

Looking up one word while studying means five browser tabs: a dictionary for the meaning, another site for examples, a third for the reading, and then copying it all back into your notes. Polyglot Helper does the lookup and the note in one step, inside Obsidian, and keeps every word you looked up in a list you can review.

## Features

<img src="docs/screenshots/review.jpg" width="860">

### Lookup popover

- Select a word and run "查词小卡" (or right-click → 查词小卡). A small card opens next to the word: reading, a short meaning, what it means in this sentence, one example. Save it to the vocabulary list with the sentence it came from, or open the full entry.

### English

- One command on a selected word or phrase: definitions and part of speech, phonetics, example sentences, collocations, etymology, idioms, slang, and medical usage if you turn it on.
- Sources are queried in parallel — Free Dictionary, Cambridge, Merriam-Webster (thesaurus and medical, with your own key), Urban Dictionary, Etymonline, TheFreeDictionary idioms, Tatoeba — and an LLM merges them into one entry. The prompt tells the model to stay with what the dictionaries say and only fill gaps.
- Choose which sections to include.

### Japanese

- Reading in kana, meaning, example sentences (Jisho, Tatoeba), related words.
- Text-to-speech with OpenAI, Gemini or Youdao. Audio is cached locally, so a sentence is only generated once.

### Quick translation

- Translate a selection into Chinese or Japanese with one command.

### Where the result goes

- Side panel, replace the selection, append to the current note, a new note, or a fixed file — with separate paths for English, Japanese and quick translations.

### Vocabulary and review

- Add any lookup to a vocabulary list with one click, from the side panel or the lookup popover (English and Japanese kept apart), with search, tags, import and export.
- Spaced review on a schedule you can change (default 1, 3, 7, 14, 30, 90, 180 days). The side panel's 学习 page opens on today's due count; each card has three answers, labelled with when the word comes back.

### Export and reminders

- Export the vocabulary as a Spaced Repetition flashcard note (`#flashcards/polyglot`, one `word::reading · meaning` card per line) or as an Anki import file. Re-exporting keeps Spaced Repetition's schedule comments.
- A "待复习 N" status bar item shows how many words are due; click it to review.

### Look

- A clean glass look in the style of current macOS: grouped settings, capsule buttons and switches, a glass lookup card. It takes its accent colour and light/dark mode from Obsidian, and turns solid when the system asks for reduced transparency or more contrast.

<img src="docs/screenshots/review.jpg" width="860">

### Cache

- Text and audio results are cached inside the plugin folder, so the same lookup costs nothing the second time. The cleanup panel shows sizes and removes old entries; it only touches the plugin's own cache folders.

## Quick start

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Rexxall/obsidian-polyglot-helper/releases/latest) into `<your vault>/.obsidian/plugins/polyglot-helper/`. (Once the plugin is listed, install it from **Settings → Community plugins → Browse** instead.)
2. In Obsidian, open **Settings → Community plugins** and enable **Polyglot Helper**.
3. In the plugin settings, pick a provider, paste its key and press **Test** (see below).
4. Select a word and look it up in the side panel, or run **英语分析** or **日语分析** from the command palette. Assign hotkeys if you use it often.

## Upgrading from 1.5 or earlier

Earlier versions used the ID `obsidian-polyglot-helper` and lived in `.obsidian/plugins/obsidian-polyglot-helper/`. From 1.6.0 the ID is `polyglot-helper`, so Obsidian keeps it in `.obsidian/plugins/polyglot-helper/`.

1. Install 1.6.0 into the new folder (or from the community directory once listed).
2. In **Settings → Community plugins**, turn the old Polyglot Helper off, then turn the new one on. Do not run both at once; they register the same panes.
3. On first start the new version copies the old `data.json` — settings, API keys and the English and Japanese vocabulary lists with their review history — and shows a notice. The old folder is left untouched.
4. Check your words in the 学习 page, then remove the old plugin. Custom hotkeys are stored under the plugin ID, so assign them once more in **Settings → Hotkeys**.

Not carried over: the lookup cache (the first lookup of each word is fetched again). API keys move with `data.json` and still decrypt, because the device key is kept per vault, not per plugin.

## API setup

The plugin talks to any OpenAI-compatible chat API. Pick a provider in **Settings → Translation and models** and the endpoint and model are filled in; you paste the key. A base URL ending in `/v1` is fine; the plugin adds `/chat/completions`.

| Provider | Endpoint | Default model | Key |
|---|---|---|---|
| DeepSeek (default) | `https://api.deepseek.com/chat/completions` | `deepseek-flash` | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| Qwen (通义千问) | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | `qwen-plus` | [Bailian console](https://bailian.console.aliyun.com/?apiKey=1) |
| SiliconFlow (硅基流动) | `https://api.siliconflow.cn/v1/chat/completions` | `deepseek-ai/DeepSeek-V4.1-Flash` | [cloud.siliconflow.cn](https://cloud.siliconflow.cn/account/ak) |
| Kimi | `https://api.moonshot.cn/v1/chat/completions` | `kimi-k3` | [platform.kimi.com](https://platform.kimi.com/console/api-keys) |
| Zhipu GLM (智谱) | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-5.3` | [bigmodel.cn](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `google/gemini-2.5-flash` | [openrouter.ai](https://openrouter.ai/keys) |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Custom | Any endpoint that accepts the OpenAI chat format | | |

**Test** tells these apart, each with what to do: no key yet; key rejected (401/403); no balance or quota; unknown model name; no answer in time; endpoint unreachable.

Optional: a Merriam-Webster key for the thesaurus and medical sections, and an OpenAI, Gemini or Youdao key for Japanese speech.

## Privacy

| What | Where it lives |
|---|---|
| Settings, vocabulary list, review history | `data.json` in the plugin folder |
| API keys | `data.json`, encrypted with a key kept in this device's local storage, not in `data.json` |
| Cached results and audio | `.cache/` in the plugin folder |
| The word or sentence you look up | Sent to the dictionaries and the AI service you enabled |
| Log file | Written only when **Debug mode** is on |

Network use: lookups go to the AI service you configure (one of the providers above or a custom OpenAI-compatible endpoint) and, depending on the sections you enable, to dictionaryapi.dev, Cambridge Dictionary, Etymonline, Merriam-Webster (with your key), Jisho, Tatoeba, YourDictionary, WordHippo, The Free Dictionary idioms and an unofficial Urban Dictionary API. Speech uses the OpenAI, Gemini or Youdao TTS service you pick. All requests use Obsidian's `requestUrl`. Some of these services need your own API key and may charge for use.

There is no account and no server of our own. Because the decryption key stays on the device, a synced or committed `data.json` does not expose your API keys; on a new device you enter them once more.

## How it works

- TypeScript, bundled with esbuild into one `main.js`.
- `english-processor.ts` and `japanese-processor.ts` run a lookup: check the cache, query the enabled sources in parallel, ask the LLM for one JSON entry, render Markdown.
- LLM requests go through Obsidian's `requestUrl` with a timeout; an error reply is shown, not swallowed.
- API keys are encrypted with AES-GCM (Web Crypto). The key is derived with PBKDF2 from a random value stored per device.

Build from source:

```bash
npm install
npm run build
npm test
```

## Known limits

- Some sources are web pages, not APIs (Cambridge, Etymonline, idioms). If a site changes its layout, that section comes back empty.
- An entry is only as good as the model you pick; check unusual words against a dictionary.
- Works on mobile, but speech and large vocabulary lists are slower on phones.

## Changelog

**1.7.0** — AI settings as provider, key, endpoint and model with DeepSeek, Qwen, SiliconFlow, Kimi and Zhipu presets; Test connection with plain-language errors; an example note and clear empty states on first open; English interface when Obsidian is not in Chinese; words keep their source note and sentence and merge instead of overwriting. Full list in [CHANGELOG.md](CHANGELOG.md).

**1.6.0** — New glass design; new plugin ID `polyglot-helper` with automatic import from the old folder; vocabulary export to Spaced Repetition flashcards and Anki; due count in the status bar; native settings headings; no HTML strings; mobile fixes. Full list in [CHANGELOG.md](CHANGELOG.md).

**1.5.0** — New look that follows your theme, optional paper & ink style; lookup popover next to the selected word; 查词 / 学习 pages in the side panel with a three-answer review; reviews now reschedule English and Japanese words correctly.

**1.4.0**

- Fixed the default OpenRouter address, which did not resolve, and updated the default models. Saved settings with the old address are repaired on load.
- API keys are encrypted with a per-device key instead of a built-in one. Keys saved by older versions are read once and re-encrypted.
- Merriam-Webster keys are encrypted too.
- Cache file names use a longer hash, so two different lookups can no longer share a file. Old cache files are found and renamed on first use.
- Lookups are written to a log file only in debug mode.
- LLM requests time out instead of hanging.

**1.3.0** — Management panel for vocabulary, statistics and cache; jump to the output location.

**1.2.0** — Japanese speech, learning progress, cache management.

---

## 中文说明

见 [README.zh.md](README.zh.md)。

## 日本語

**概要：** 英語・日本語の学習に使う Obsidian プラグインです。ノートで単語を選んでコマンドを実行すると、複数の辞書を同時に調べ、AI が意味・読み・例文・語源を一つの学習メモにまとめます。調べた単語は単語帳に入り、間隔反復で復習できます。

**使い方：** Releases の zip をプラグインフォルダに展開して有効にし、設定で API キーを一つ入力します。単語を選び、「英语分析」または「日语分析」を実行してください。1.5 以前から更新する場合、プラグイン ID が `polyglot-helper` に変わります。旧版を無効にしてから新版を有効にすると、設定・API キー・単語帳が自動で引き継がれます。

**プライバシー：** API キーは暗号化して保存し、復号の鍵はこの端末にだけ残ります。調べた語は、有効にした辞書と AI サービスに送られます。

## License

MIT
