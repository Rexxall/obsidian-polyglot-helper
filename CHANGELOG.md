# Changelog

## 1.6.0

- **New glass design.** Every panel, dialog and the settings page were redone in the style of current macOS: content on solid grouped lists and cards, the lookup card and option panels on glass, one accent colour (yours from Obsidian), capsule buttons and switches. It follows light/dark mode and falls back to solid surfaces under the system's reduce-transparency and increase-contrast settings. The "Paper & ink style" option is gone.
- **Lookups are word cards.** The side panel no longer renders the raw Markdown: the word is large at the top, with phonetics, a play button and 加入生词本 on one line; parts of speech are capsules; senses are numbered and grouped by part of speech, with the dictionary named above its first group when there are several, with example translations in secondary text; the dictionary sources are one grey line at the bottom. Medical, slang, idiom and etymology sections start folded. Insert, copy, new note, fixed file and clear are in the card's ··· menu. Notes you insert still get the full Markdown.
- The language row is one segmented control (日语 · 英语 · 译日语) with an options button, plus a separate 翻译成中文 button. The row of small icons (force refresh, read aloud, voice options) and 跳到上次输出位置 and 设置 moved into the ··· menu next to the title. Where results go (side panel, replace selection, append, new note, fixed file) is a capsule picker inside the input box instead of a native dropdown.
- The 学习 page opens on one card with today's due, English and Japanese counts and 开始复习, followed by the list of words due today. 只复习英语／日语 and the vocabulary list are in the card's ··· menu.
- No more "Polyglot Helper is now active!" notice on every start.
- **Plugin ID is now `polyglot-helper`.** The Obsidian community directory does not allow "obsidian" in an ID. On first start the new version imports settings, API keys and both vocabulary lists from the old `obsidian-polyglot-helper` folder. See [Upgrading from 1.5 or earlier](#upgrading-from-15-or-earlier).
- **Export your vocabulary.** "导出词库为闪卡笔记" writes a `#flashcards/polyglot` note that the Spaced Repetition plugin can review (`word::reading · meaning`); exporting again keeps its review schedule. "导出词库为 Anki 导入文件" writes a tab-separated file with tags for Anki's File → Import. Folder in Settings → 学习与界面.
- **Due words in the status bar.** "待复习 N" appears when words are due; click it to start reviewing. Can be turned off.
- Settings use Obsidian's native section headings; floating panels and the review card use theme classes instead of inline styles; command names no longer start with emoji; the management panel's ribbon icon is a library, not a gear.
- Security: no HTML strings are inserted into the page any more; all panels are built with Obsidian's DOM helpers.
- Mobile: removed a Node.js `path` import that is not available on phones, and a regular expression that older iOS versions cannot run.
- Closing the plugin no longer closes its panes, so they reopen in place after an update.
- Passes the Obsidian community directory's automated review (eslint-plugin-obsidianmd recommended set) with no errors. Two bugs found on the way are fixed: the cache cleaner's "清理选中项" deleted nothing, and importing a vocabulary JSON file always failed.
- Upgrading from a manual install whose folder is not `obsidian-polyglot-helper` (for example `obsidian-polyglot-helper-release`): the old version is now found by its manifest id, so settings, both vocabulary lists and every review schedule move over.
- No lint warnings in the plugin source: delete and clear actions ask in an Obsidian dialog instead of the browser's confirm(); settings appear in Obsidian 1.13's settings search; speech settings are named 语音合成 instead of TTS.
- Phones and touch screens: the recent-lookup buttons stay visible and larger, dialogs keep their inner margins. With "increase contrast" on, cards and the input box get a solid outline.
- Requires Obsidian 1.8.7 or later.

## 1.5.0

- New look. The stylesheet was rewritten from scratch. By default it uses only Obsidian theme variables, so it follows your theme and light/dark mode. An optional "Paper & ink style" (Settings → 学习与界面) adds a paper texture, thin ink lines and serif headings, in light and dark.
- Lookup popover: select a word and run "查词小卡" (or right-click → 查词小卡). A small card opens next to the word with the reading, a short meaning, what the word means in this sentence, and one example. "收进生词本" saves it with the sentence and the note it came from; "完整词条" opens the full entry in the side panel.
- The side panel has two pages, 查词 and 学习. 学习 opens on today's due count; review shows one card at a time with three answers (忘了, 模糊, 记得), each labelled with when the word comes back. Keys: Space shows the answer, 1–3 grade.
- In the full entry, medical usage and slang start collapsed.
- Fix: reviews of English and Japanese words were saved to the old shared list and did not reschedule the word. They now update the right list.
- Fix: the management panel's due count only counted the old list.

## 1.4.0

- Fixed the default OpenRouter address, which did not resolve, and updated the default models. Saved settings with the old address are repaired on load.
- API keys are encrypted with a per-device key instead of a built-in one. Keys saved by older versions are read once and re-encrypted.
- Merriam-Webster keys are encrypted too.
- Cache file names use a longer hash, so two different lookups can no longer share a file. Old cache files are found and renamed on first use.
- Lookups are written to a log file only in debug mode.
- LLM requests time out instead of hanging; error replies reach the status handling.
- Multi-line "replace selection" output no longer drops text, and notes are written atomically.

## 1.3.0

- Management panel for the vocabulary list, learning statistics and cache.
- Jump to the output location.

## 1.2.0

- Japanese text-to-speech with audio cache.
- Learning progress tracking.
