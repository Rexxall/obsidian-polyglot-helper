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
- API keys are encrypted with AES-GCM (Web Crypto); the key is derived with PBKDF2 from a random value stored per device.

## Releases

The release tag must equal the `version` in `manifest.json`, and the release must contain `main.js`, `manifest.json` and `styles.css`. Update `package.json`, `manifest.json`, `versions.json` and `CHANGELOG.md` together. Do not commit `data.json`, logs or cache folders.
