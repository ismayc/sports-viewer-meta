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
comment in `icon.svg`).

**Two apps covering the same sport can't both wear the ball.** NBA/WNBA share 🏀 and are
told apart by background alone, which is the weakest form of the rule and only works
because the two are rarely installed side by side. Where a second app would be a true
duplicate, the later one takes a *different* mark instead: `world-cup-viewer` holds ⚽, so
`premier-league` uses a heraldic lion rather than a second identical soccer ball. A
non-emoji mark is fine — the rule that matters is the trademark one below, not the emoji.

The other lever is the **ground**. NBA and WNBA are both basketball and both shipped on
`#0e1117`, so no choice of ball could tell them apart: same sport, same colour, same
silhouette. `the-wnba-schedule` now uses a **rich teal `#0d4448`** ground with the ball in
its own orange `#ff7a29`. That is a deliberate break from "the app's dark background" —
the icon ground is an identity decision, and where two apps would otherwise collide the
later one takes a distinct ground even though its UI stays dark. Keep it dark enough to sit
with the family (luminance 0.047 against the others' ~0.006) and check the mark's contrast
against it: orange on `#0d4448` is 4.16:1.

Whatever the app's favicon is, the installed icon must match it. One app, one mark.

## ImageMagick gotchas (why the recipe is what it is)

- **Don't hand-draw the ball with SVG strokes.** ImageMagick's SVG rasterizer drops
  `stroke`/`stroke` colour, so a stroke-based icon bakes out to a near-black square with
  nothing visible. (This is exactly how the NBA and NFL icons were broken before this.)
  Noto's balls are **filled paths**, which magick rasterizes correctly.
- **Don't try to render the color emoji font.** `magick … label:"🏀"` renders the glyph as
  a flat black shape (no colour) — the Apple/Noto color tables aren't supported. Use the
  **Noto SVG**, not the font.
- **Don't fill the background with a gradient.** ImageMagick also drops a `fill` that
  references a gradient via `url(#id)` and paints it **pure black**. This is the nastiest
  of the three, because nothing looks wrong until you inspect a pixel: the SVG renders the
  gradient correctly in a browser, so `icon.svg` looks right while every PNG generated from
  it ships with a black background. Use a flat `<rect fill="#…">`.
- **Don't trust a thumbnail.** All three failures produce a plausible-looking icon at small
  size. Verify every PNG before committing:

  ```bash
  # must report the background colour, not srgba(0,0,0,1)
  magick public/icon-512.png -format "%[pixel:p{8,8}]" info:
  # must not be ~0, which means a blank square
  magick public/icon-512.png -format "%[fx:standard_deviation]" info:
  ```

## Recipe

```bash
SPORT=1f3c0                 # basketball; swap per the table above
BG='#0e1117'                # the app's dark background, as a FLAT fill (see gotchas)
curl -sSL "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u${SPORT}.svg" -o ball.svg

# Extract the emoji's inner paths (its viewBox is 0 0 128 128).
PATHS=$(perl -0777 -ne 'print $1 if /<svg[^>]*>(.*)<\/svg>/s' ball.svg)

cat > public/icon.svg <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
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
# iOS does not support transparency in a touch icon, so flatten the alpha away.
magick -background none public/icon.svg -resize 180x180 -alpha remove -alpha off public/apple-touch-icon.png
```

Use each app's own dark background for `BG` (NBA `#0e1117`, NFL `#0b1220`, World Cup
`#0f1420`, PL `#12121a`). Always eyeball the 180px output — that's the real Home Screen
size — and run the two verification commands above before committing.

Earlier revisions of this recipe wrapped the background in a `radialGradient` for a subtle
accent-tinted inner glow. It does not survive rasterization; see the gotchas. At icon scale
the glow was barely visible anyway, and a flat fill keeps `icon.svg` and the PNGs honest —
regenerating with the obvious `magick` one-liner then gives what the SVG shows.

## The favicon split (2026-07-21)

The browser-TAB icon and the home-screen icon are the same art on different grounds:

- **Tab (`favicon.svg`)**: the icon art **without** the background rect — transparent,
  like world-cup-viewer's ⚽. Ship it as `public/favicon.svg` (= `icon.svg` minus the
  `<rect width="512" …>` line) and point `<link rel="icon">` at it.
- **Home screen / PWA (`icon.svg` + the PNGs)**: keep the dark ground. iOS flattens
  transparency to black and Android's maskable crop needs a full-bleed ground, so the
  bare art is tab-only.
- **The hub's per-viewer PNGs** (`hub/public/icons/`) follow the tab: bare art via
  `magick -background none favicon.svg -resize 192x192` — **except the two March Madness
  icons, which keep their colored grounds** (dark red men's, purple women's). The net art
  is identical between them; the ground is the identifier.

## Wiring

`index.html` (in `<head>`):

```html
<link rel="icon" type="image/svg+xml" href="./favicon.svg" />
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

## Applied so far

| App | Mark | Background | State |
|---|---|---|---|
| `world-cup-viewer` | ⚽ Noto | flat `#0f1420` | ✅ correct |
| `premier-league` | heraldic lion (Lorc, game-icons.net, CC BY 3.0) in `#8b7bf0` | flat `#12121a` | ✅ correct |
| `the-nba-schedule` | 🏀 Noto | flat `#0e1117` | ✅ correct |
| `the-nfl-schedule` | 🏈 Noto | flat `#0b1220` | ✅ correct |
| `the-wnba-schedule` | 🏀 Material Symbols in `#ff7a29` | flat `#0d4448` (teal) | ✅ correct |

**NBA and NFL have been regenerated.** Both were originally built with the gradient
version of the recipe, so their PNGs shipped with a pure black background while their
`icon.svg` still showed the intended tint in a browser — which is exactly why it survived
two apps unnoticed. Their backgrounds are now flat, and every PNG verifies:

```
the-nba-schedule/public/icon-512.png  ->  srgba(14,17,23,1)   # #0e1117
the-nfl-schedule/public/icon-512.png  ->  srgba(11,18,32,1)   # #0b1220
world-cup-viewer/public/icon-512.png  ->  srgb(15,20,32)      # #0f1420
premier-league/public/icon-512.png    ->  srgb(18,18,26)      # #12121a
the-wnba-schedule/public/icon-512.png ->  srgba(13,68,72,1)   # #0d4448
```

`the-wnba-schedule` was the last app off the recipe and is now on it. The icon it carried
was stroke-based and pre-rounded, so it was unreproducible from the documented command and
its PNGs had white corners where the baked rounding had been flattened onto white.
