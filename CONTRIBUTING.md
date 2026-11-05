# Contributing

## Build

```bash
npm install
npm run build
npm test
npm run lint
```

Copy `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/polyglot-helper/` to try a build.

## How it works

- `english-processor.ts` and `japanese-processor.ts` run a lookup: check the cache, query the enabled sources in parallel, ask the model for one JSON entry, render Markdown.
- Model and dictionary requests go through Obsidian's `requestUrl` with a timeout; an error reply is shown, not swallowed.
- API keys live in Obsidian's secret storage (`app.secretStorage`); settings keep only each key's name. `secrets.ts` moves keys from older settings there and turns the old key fields into getters that read storage when used and are never saved.

## Releases

The release tag must equal the `version` in `manifest.json`, and the release must contain `main.js`, `manifest.json` and `styles.css`. Update `package.json`, `manifest.json`, `versions.json` and `CHANGELOG.md` together. Do not commit `data.json`, logs or cache folders.

Before a release, check startup time: reload Obsidian with the plugin enabled and time its `onload`. It should stay under 50 ms on a vault with a year of data. Anything that reads many files, calls the network or renders waits for `onLayoutReady` or runs on first use.
