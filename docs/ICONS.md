# App icons — the family recipe

Every viewer needs a real Home Screen / PWA icon. The family standard is the **sport's
Google Noto Emoji ball/object on the app's dark background** — the same approach
`world-cup-viewer` uses for its soccer ball. It looks professional, scales cleanly, and
sidesteps the trademark problem below.

## The rule: never use the league logo

The official league logo (NBA silhouette, NFL shield, etc.) is a **registered trademark**.
Using it as the app's *own* icon brands an unofficial fan project as if it were the
league's official app on someone's phone — which contradicts the "not affiliated with…"
disclaimer and invites a takedown. Team logos shown *inside* the app to identify a matchup
are nominative use and fine; the **league mark as the app's identity is not**. Use the
emoji ball instead.

## Which emoji per sport

Noto Emoji filenames are `emoji_u<codepoint>.svg` (lowercase, no `U+`):

| Sport | Emoji | Codepoint | Noto file |
|---|---|---|---|
| Basketball (NBA, WNBA) | 🏀 | `1f3c0` | `emoji_u1f3c0.svg` |
| American football (NFL) | 🏈 | `1f3c8` | `emoji_u1f3c8.svg` |
| Soccer (World Cup) | ⚽ | `26bd` | `emoji_u26bd.svg` |
| Baseball (MLB) | ⚾ | `26be` | `emoji_u26be.svg` |
| Ice hockey (NHL) | 🏒 | `1f3d2` | `emoji_u1f3d2.svg` |

Source: <https://github.com/googlefonts/noto-emoji> — **Apache License 2.0**, so it's free
to use with attribution (leave the `<!-- … Google Noto Emoji (Apache License 2.0) -->`
comment in `icon.svg`). Two leagues sharing a sport (NBA/WNBA) get the *same* ball but
should differ elsewhere — background tint and, if one predates this recipe, its icon style.

## ImageMagick gotchas (why the recipe is what it is)

- **Don't hand-draw the ball with SVG strokes.** ImageMagick's SVG rasterizer drops
  `stroke`/`stroke` colour, so a stroke-based icon bakes out to a near-black square with
  nothing visible. (This is exactly how the NBA and NFL icons were broken before this.)
  Noto's balls are **filled paths**, which magick rasterizes correctly.
- **Don't try to render the color emoji font.** `magick … label:"🏀"` renders the glyph as
  a flat black shape (no colour) — the Apple/Noto color tables aren't supported. Use the
  **Noto SVG**, not the font.

## Recipe

```bash
SPORT=1f3c0                 # basketball; swap per the table above
BG='#0e1117'; TINT='#2c1622'   # app dark bg + a subtle accent-tinted inner glow
curl -sSL "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u${SPORT}.svg" -o ball.svg

# Extract the emoji's inner paths (its viewBox is 0 0 128 128).
PATHS=$(perl -0777 -ne 'print $1 if /<svg[^>]*>(.*)<\/svg>/s' ball.svg)

cat > public/icon.svg <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="36%" r="80%">
      <stop offset="0%" stop-color="${TINT}"/>
      <stop offset="62%" stop-color="${BG}"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <!-- <sport> — Google Noto Emoji (Apache License 2.0); padded for Android maskable cropping -->
  <g transform="translate(256,256) scale(2.7) translate(-64,-64)">
$PATHS
  </g>
</svg>
SVG

# scale 2.7 ⇒ the 128-unit ball fills ~68% of the 512 canvas: big, but inside the ~80%
# maskable safe zone so Android's circle/squircle crop never clips it.
magick -background none public/icon.svg -resize 512x512 public/icon-512.png
magick -background none public/icon.svg -resize 192x192 public/icon-192.png
magick -background none public/icon.svg -resize 180x180 public/apple-touch-icon.png
```

Use each app's own dark bg + accent for `BG`/`TINT` (NBA red `#2c1622`/`#0e1117`, NFL navy
`#16233d`/`#0b1220`, …). Always eyeball the 180px output — that's the real Home Screen size.

## Wiring

`index.html` (in `<head>`):

```html
<link rel="icon" type="image/svg+xml" href="./icon.svg" />
<link rel="apple-touch-icon" href="./apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="NBA Schedule" />
```

`public/manifest.webmanifest` icons — reference the **PNGs** (an SVG-only manifest isn't
enough for installability on every platform):

```json
"icons": [
  { "src": "./icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
  { "src": "./icon-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "./icon-512.png", "sizes": "512x512", "type": "image/png" },
  { "src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
```

**iOS note:** Safari caches the touch icon per URL, so after changing it you must *remove
and re-add* the site to the Home Screen to see the new one.

## Other options (if a plain emoji ball ever feels too generic)

- **A monogram** — the app's initials in the accent colour on the dark bg (clean, unique,
  zero trademark risk).
- **Emoji + a subtle accent ring/arc** for a bit more identity than the bare ball.
- **A different emoji set** (Twemoji, CC-BY 4.0; OpenMoji, CC-BY-SA 4.0) if a particular
  ball reads better — same recipe, different source + attribution.

Applied so far: `world-cup-viewer` (⚽, pre-existing), `the-nba-schedule` (🏀), and
`the-nfl-schedule` (🏈). `the-wnba-schedule` still uses its older flat-orange outline
basketball — fine to leave, or re-do with 🏀 on a distinct background if desired.
