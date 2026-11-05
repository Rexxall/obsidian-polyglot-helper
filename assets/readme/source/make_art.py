"""Render the README hero and the three cards, light and dark, English and Chinese.

    python3 make_art.py        writes ../hero-*.svg and ../cards-*.svg
"""
from pathlib import Path

THEMES = {
    "light": dict(bg="#F7F6FB", fg="#1D1B26", muted="#6B6780", line="#E4E1EE", card="#FFFFFF",
                  accent="#7A5AF0", accent_soft="#EEE9FF", under="#B9A6F7"),
    "dark": dict(bg="#15141B", fg="#EEECF5", muted="#9C98AF", line="#2C2A36", card="#1E1D26",
                 accent="#A48BFF", accent_soft="#2C2643", under="#6E5BB8"),
}
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'PingFang SC', sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"

TEXT = {
    "en": dict(
        eyebrow="OBSIDIAN PLUGIN · ENGLISH AND JAPANESE",
        line1="Look up a word where you read.", line2="Keep it, and meet it again.",
        small="free dictionaries · no account · Anki",
        desc="Polyglot Helper: a word card for 蔵書 (ぞうしょ, collection of books) opens next to the sentence, with Add to word list; saved words are underlined when you read.",
        add="Add to word list", meaning="collection of books; (personal) library",
        cards=[("Look up in place", "Reading, meaning and an example."),
               ("Japanese first", "Knows 食べた is 食べる."),
               ("Review anywhere", "Due reviews here, or send to Anki.")],
        cards_title="What Polyglot Helper does",
    ),
    "zh": dict(
        eyebrow="OBSIDIAN 插件 · 英语和日语",
        line1="在读的地方查词，", line2="存下来，下次读到还认得。",
        small="免费词典 · 不用注册 · 可送进 Anki",
        desc="Polyglot Helper：在句子旁边弹出 蔵書（ぞうしょ，藏书）的词卡，可以加入生词本；存过的词在阅读时会加下划线。",
        add="Add to word list", meaning="collection of books; (personal) library",
        cards=[("就地查词", "读音、意思和一条例句。"),
               ("日语优先", "存了 食べる，读到 食べた 也认得。"),
               ("随处复习", "到期复习，或者一键送进 Anki。")],
        cards_title="Polyglot Helper 能做什么",
    ),
}

HERO = """<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400" role="img" aria-labelledby="t d">
  <title id="t">Polyglot Helper</title>
  <desc id="d">{desc}</desc>
  <rect width="1200" height="400" rx="28" fill="{bg}"/>
  <g font-family="{sans}">
    <text x="64" y="118" font-family="{mono}" font-size="17" letter-spacing="2" fill="{accent}">{eyebrow}</text>
    <text x="62" y="196" font-size="64" font-weight="700" letter-spacing="-1.5" fill="{fg}">Polyglot Helper</text>
    <text x="64" y="252" font-size="29" fill="{fg}">{line1}</text>
    <text x="64" y="292" font-size="29" fill="{muted}">{line2}</text>
    <text x="64" y="346" font-family="{mono}" font-size="17" fill="{muted}">{small}</text>
  </g>
  <g font-family="{sans}">
    <rect x="700" y="48" width="436" height="304" rx="20" fill="{card}" stroke="{line}"/>
    <text x="728" y="98" font-size="22" fill="{fg}">月の予定で、<tspan font-weight="600">蔵書</tspan>は約十二万冊。</text>
    <rect x="861" y="106" width="44" height="3" rx="1.5" fill="{under}"/>
    <rect x="724" y="128" width="388" height="200" rx="16" fill="{bg}" stroke="{line}"/>
    <text x="748" y="178" font-size="34" font-weight="700" fill="{fg}">蔵書</text>
    <text x="830" y="176" font-size="18" fill="{muted}">ぞうしょ</text>
    <circle cx="930" cy="169" r="14" fill="{accent_soft}"/>
    <path d="M926 162 L926 176 L937 169 Z" fill="{accent}"/>
    <text x="748" y="224" font-size="19" fill="{fg}">{meaning}</text>
    <rect x="748" y="244" width="340" height="1" fill="{line}"/>
    <rect x="748" y="262" width="168" height="40" rx="20" fill="{accent}"/>
    <text x="832" y="288" font-size="17" font-weight="600" text-anchor="middle" fill="#FFFFFF">{add}</text>
    <text x="1088" y="288" font-size="15" text-anchor="end" fill="{muted}">Jisho</text>
  </g>
</svg>
"""


def glyph(i, x, y, c):
    if i == 0:  # magnifier over a word
        return (f'<circle cx="{x+21}" cy="{y+21}" r="9" fill="none" stroke="{c["accent"]}" stroke-width="3"/>'
                f'<path d="M{x+28} {y+28} L{x+35} {y+35}" stroke="{c["accent"]}" stroke-width="3" stroke-linecap="round"/>')
    if i == 1:  # あ
        return f'<text x="{x+24}" y="{y+33}" font-size="24" font-weight="700" text-anchor="middle" fill="{c["accent"]}">あ</text>'
    return (f'<rect x="{x+11}" y="{y+13}" width="22" height="16" rx="4" fill="none" stroke="{c["muted"]}" stroke-width="2.5"/>'
            f'<rect x="{x+15}" y="{y+19}" width="22" height="16" rx="4" fill="{c["accent_soft"]}" stroke="{c["accent"]}" stroke-width="2.5"/>')


def cards(t, c):
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="190" viewBox="0 0 1200 190" role="img" aria-labelledby="t d">',
             f'<title id="t">{t["cards_title"]}</title>',
             '<desc id="d">' + " ".join(f"{a}: {b}" for a, b in t["cards"]) + '</desc>',
             f'<g font-family="{SANS}">']
    for i, (title, body) in enumerate(t["cards"]):
        x = 24 + i * 392
        parts.append(f'<rect x="{x}" y="16" width="368" height="158" rx="22" fill="{c["bg"]}" stroke="{c["line"]}"/>')
        parts.append(f'<rect x="{x+28}" y="44" width="48" height="48" rx="14" fill="{c["accent_soft"]}"/>')
        parts.append(glyph(i, x + 28, 44, c))
        parts.append(f'<text x="{x+96}" y="78" font-size="27" font-weight="700" fill="{c["fg"]}">{title}</text>')
        parts.append(f'<text x="{x+28}" y="138" font-size="20" fill="{c["muted"]}">{body}</text>')
    parts.append('</g></svg>\n')
    return "\n".join(parts)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent
    for lang, t in TEXT.items():
        suffix = "" if lang == "en" else "-zh"
        for name, c in THEMES.items():
            fields = {k: v for k, v in t.items() if isinstance(v, str)}
            (out / f"hero{suffix}-{name}.svg").write_text(HERO.format(sans=SANS, mono=MONO, **fields, **c), encoding="utf-8")
            (out / f"cards{suffix}-{name}.svg").write_text(cards(t, c), encoding="utf-8")
    print("wrote", sorted(p.name for p in out.glob("*.svg")))
