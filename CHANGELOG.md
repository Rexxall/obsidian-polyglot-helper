# Changelog

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
