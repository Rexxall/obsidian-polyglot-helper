Copy the prompt for your problem into your AI coding assistant (Claude, Codex or ChatGPT), replacing `<vault>` with your vault folder.

## AI key test fails or lookup returns nothing

```text
Polyglot Helper's AI key test fails, or a lookup returns nothing. Help me find and fix the cause.
You may inspect and change only <vault>/.obsidian/plugins/polyglot-helper/. If needed, read only the note I name. Do not access other plugins or notes, or change any note. Stop and ask before deleting anything.
Check the provider, endpoint, model and selected key name in the plugin's configuration. Ask me for the exact Test or lookup error. Distinguish a missing or rejected key, no balance or quota, an unknown model, a timeout and an unreachable endpoint. Keys live in this device's Obsidian Keychain; ask me to select the key in settings, without sharing its value. For an empty dictionary section, check whether its source is enabled and whether its parser still matches the response.
To confirm the fix, have me press Test in Settings → Polyglot Helper → Translation and models; it should show “Works” and a response time. Then have me look up “postpone” with output set to Side panel; a word card with a meaning should appear. These requests use my provider's quota. If either check fails, report the remaining error.
```

## Saved words are not underlined

```text
Words saved in Polyglot Helper are not underlined in reading view. Help me find and fix the cause.
You may inspect and change only <vault>/.obsidian/plugins/polyglot-helper/. If needed, read only the note I name. Do not access other plugins or notes, or change any note. Stop and ask before deleting anything.
Check Mark saved words while reading under Learning and interface, the saved word in data.json, its mastery status, and the plugin's reading-view matcher and styles. Mastered words and common English words such as “the” are deliberately excluded. Use a saved, unmastered word that is not one of those common words. Do not reset my word list or review history.
To confirm the fix, have me reopen the named note in reading view. The chosen word should be underlined, and hovering over it should show its reading and meaning without another lookup. Check the same note again after restarting Obsidian.
```

## Sending to Anki fails

```text
Polyglot Helper's Send word list to Anki command fails. Help me find and fix the cause.
You may inspect and change only <vault>/.obsidian/plugins/polyglot-helper/. If needed, read only the note I name. Do not access other plugins or notes, or change any note. Stop and ask before deleting anything.
Check that the plugin's word list has cards, its Anki deck setting, its ankiConnectUrl (default http://127.0.0.1:8765), and the exact error. Ask me to confirm that Anki is running with AnkiConnect installed (add-on code 2055492159). Inspect the plugin's request and response handling. Do not edit Anki's files or add-ons; tell me if the fix requires action there.
To confirm the fix, have me run Send word list to Anki and check the added, updated and unchanged counts. Have me find a sent card in Anki and check its front and back. Then have me send the unchanged word list again: it should report zero added cards, with no duplicates. I will run these checks because sending creates or updates cards in Anki.
```

## The side panel does not open

```text
Polyglot Helper's side panel does not open when I click its book icon. Help me find and fix the cause.
You may inspect and change only <vault>/.obsidian/plugins/polyglot-helper/. If needed, read only the note I name. Do not access other plugins or notes, or change any note. Stop and ask before deleting anything.
Ask me to confirm that Polyglot Helper is enabled and Obsidian is version 1.11.4 or later. Check manifest.json, main.js and styles.css in the allowed folder, the view registration and any startup error I provide. Ask me to try Open the helper panel from the command palette. If I upgraded from 1.5 or earlier, ask whether the old plugin is still enabled; tell me to disable it myself, without accessing its folder. Do not reset my workspace or data.json.
To confirm the fix, have me open the panel with the book icon and then with Open the helper panel. Both should reveal a panel with the lookup input and the Learn tab. Repeat after restarting Obsidian.
```

Still stuck? [Open an issue](https://github.com/Rexxall/obsidian-polyglot-helper/issues/new/choose).
