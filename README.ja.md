<div align="center">

# Polyglot Helper

**ノートで英語や日本語の単語を調べると、意味・読み・例文・音声をまとめた学習カードが返り、復習用の単語帳に入ります。**

[English](README.md) · [中文](README.zh-CN.md) · 日本語

<img src="docs/screenshots/hero.png" width="860" alt="左は例のノート、右はサイドパネルに表示された postpone の単語カード">

</div>

Obsidian が中国語以外の設定のとき、プラグインの画面は英語で表示されます。

## はじめかた

1. Polyglot Helper を有効にし、左のリボンの本のアイコンでサイドパネルを開きます。
2. **Load example** を押すと、例のノートが作られ、検索欄に “postpone” が入ります。
3. **Settings → Polyglot Helper → Translation and models** で AI のキーを一つ貼り付けます。既定は DeepSeek です。**Test** で確認できます。
4. **Look up** を押します。以後はノートで単語を選んで同じように調べ、**Add to word list** で単語帳に入れます。

## 必要なものと費用

- プラグイン：無料、アカウント不要。デスクトップとモバイルで使えます。
- AI サービス：OpenAI 互換のキーが一つ必要です（DeepSeek、Qwen、SiliconFlow、Kimi、Zhipu、OpenRouter、OpenAI など）。料金は各社の従量課金で、1 回の検索は短いリクエストです。
- 辞書と発音：無料の公開ソースを使い、キーは不要です。

## 1.5 以前からの更新

プラグイン ID が `polyglot-helper` に変わりました。旧版を無効にしてから新版を有効にすると、設定・API キー・単語帳が自動で引き継がれます。ショートカットキーは設定し直してください。

## プライバシー

API キーは暗号化して保存し、復号の鍵はこの端末にだけ残ります。調べた語は、有効にした辞書と AI サービスに送られます。作者のサーバーはありません。

## ライセンス

MIT
