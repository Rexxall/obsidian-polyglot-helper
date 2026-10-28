const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const esbuild = require('esbuild');

function load(entry) {
  const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}), console });
  return module.exports;
}

const { parseWordCards } = load('src/word-card.ts');

const english = `## deliberate - 故意的

<audio controls src="https://dict.youdao.com/dictvoice?audio=deliberate&type=2" style="height: 30px;"></audio>

> [!info] 核心释义
> - **视觉助记**: [查看图片](https://dict.youdao.com/search?q=deliberate)
> - **音标**: UK: /dɪˈlɪb.ər.ət/ | US: /dɪˈlɪb.ɚ.ət/
> - **词性**: adjective

> [!abstract] 详细释义
> - **Dictionary API**:
>   - _verb_: To consider carefully; to weigh well in the mind.
>   - _adjective_: Done on purpose; intentional.
>   - _adjective_: Formed with deliberation.
> 
> - **剑桥词典**:
>   - (often of something bad) intentional or planned:

> [!example] 例句用法
> - It was a deliberate attempt to mislead.
>   - 这是故意误导。

> [!note] 俚语
> - **俚语含义**: on purpose`;

test('English result becomes a card with headword, audio, phonetic and part of speech', () => {
  const [card] = parseWordCards(english);
  assert.equal(card.headword, 'deliberate');
  assert.equal(card.gloss, '故意的');
  assert.match(card.audio, /dictvoice\?audio=deliberate/);
  assert.equal(card.phonetic, 'UK: /dɪˈlɪb.ər.ət/ · US: /dɪˈlɪb.ɚ.ət/');
  assert.equal(card.pos.join(), '形容词');
  assert.match(card.image, /youdao/);
});

test('definitions are grouped by part of speech and source labels go to the footer', () => {
  const [card] = parseWordCards(english);
  const defs = card.sections.find((s) => s.title === '详细释义');
  assert.equal(JSON.stringify(defs.groups.map((g) => [g.pos, g.lines.length])), JSON.stringify([['动词', 1], ['形容词', 2], [null, 1]]));
  assert.equal(defs.groups[2].lines[0].text, '(often of something bad) intentional or planned');
  assert.equal(card.sources.join(), 'Free Dictionary,Cambridge Dictionary');
  assert.ok(!JSON.stringify(card).includes('Dictionary API'));
  assert.ok(!card.sections.some((s) => s.title === '核心释义'));
});

test('examples keep the translation as secondary text and slang starts folded', () => {
  const [card] = parseWordCards(english);
  const example = card.sections.find((s) => s.title === '例句用法').groups[0].lines[0];
  assert.equal(JSON.stringify([example.text, example.sub]), JSON.stringify(['It was a deliberate attempt to mislead.', '这是故意误导。']));
  assert.equal(card.sections.find((s) => s.title === '俚语').folded, true);
});

test('Japanese result keeps ruby, labels and line audio; several words make several cards', () => {
  const japanese = `## 我喜欢猫 - 好き

> [!success] 翻译结果
> - **敬语型:** <ruby>猫<rt>ねこ</rt></ruby>が**好き**です <audio src="Polyglot/Audio/a.mp3" controls style="height: 20px;"></audio>
> - **口语型:** <ruby>猫<rt>ねこ</rt></ruby>が**好き**`;
  const cards = parseWordCards(japanese + '\n\n---\n\n' + english);
  assert.equal(cards.length, 2);
  const line = cards[0].sections[0].groups[0].lines[0];
  assert.equal(line.label, '敬语型');
  assert.equal(line.text, '<ruby>猫<rt>ねこ</rt></ruby>が**好き**です');
  assert.equal(line.audio, 'Polyglot/Audio/a.mp3');
});

test('text without a heading is left to the plain renderer', () => {
  assert.equal(parseWordCards('just some text').length, 0);
});
