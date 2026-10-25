# Changelog

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
