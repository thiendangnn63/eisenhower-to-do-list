---
name: font-template
description: >-
  Add a font, or a whole theme built around one, to Focus Board for the user. Covers getting
  the font file (woff2, bundled offline), the @font-face rule, the colour and type tokens for
  light and dark mode, the theme's words (quadrant names, motivational lines), the backgrounds
  folder, and checking the result. Use when the user asks for a new font, a new theme, a look
  based on a brand, album, film, place or object, or to change how an existing theme's type looks.
---

# font-template

Focus Board is plain HTML, CSS and JS opened from disk (`file://`). There's no build step,
no server, and it works offline, so fonts are bundled in `fonts/` and never loaded from a CDN
at runtime. A theme is three things that share one id: a token block in CSS, an entry in JS,
and a folder in `backgrounds/`.

## Where a new theme goes

| The theme is... | CSS goes in | JS goes in |
| --- | --- | --- |
| Personal to this user (their favourite band, a brand, an in-joke) | `themes-local.css` | `themes-local.js` |
| Meant to ship with the app for everyone | `themes.css` | `themes.js` |

Default to the local files. They're gitignored, `index.html` loads them only if they exist,
and a fresh clone runs fine without them. If they don't exist yet, create them using the
templates below. Fonts in `fonts/` and `fonts.css` are shared either way.

## Step 0: decide the look before writing CSS

Ask the user for a reference: an album cover, a poster, a website, a photo, a product. One
concrete reference settles colour, type and density at once. Then write down, in a comment
above the CSS block, what each choice comes from:

```css
/* Blue Note: 1960s jazz sleeves: off-white card, one loud colour block,
   tight condensed caps set big. */
```

Don't fall back to the usual defaults just because they look nice: Inter or Geist for UI,
Instrument Serif, Fraunces or Playfair for headings, a cream background with a sage green
accent, a purple-to-blue gradient. They're fine when the reference really calls for them
(a theme based on an old book jacket might well want Playfair). If the user has the
`unslop-ui` skill installed, run its scanner when you're done and mark deliberate choices with
`/* unslop-ignore: reason */` on that line.

## Step 1: get the font file

Check the licence first. Google Fonts are OFL or Apache and fine to bundle. For anything else,
ask the user whether they have the rights; don't download fonts from mirror sites.

Get the latin-subset woff2 from Google Fonts. The CSS API returns woff2 only to a modern
browser user agent:

```bash
curl -s -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap"
```

The response has one `@font-face` per subset, each preceded by a comment like `/* latin */`.
Take the URL from the `latin` block only and save it as `fonts/<Family>-<style>.woff2`, matching
the existing names (`Archivo-normal.woff2`, `PlayfairDisplay-italic.woff2`). Ask for the
variable range (`wght@300..700`, or `wdth,wght@62..125,400..900` for width) so one file covers
every weight. If the theme sets headings or quotes in italic, get the italic file too
(`ital,wght@1,400..700`). Without it the browser fakes a slanted version, and it looks wrong.

Add the face to `fonts.css`, copying the `unicode-range` from an existing entry:

```css
@font-face {
  font-family: 'Space Grotesk';
  font-style: normal;
  font-weight: 300 700;          /* the variable range you downloaded, or a single weight */
  /* font-stretch: 62% 125%; */  /* only if the file has a width axis */
  font-display: swap;
  src: url(fonts/SpaceGrotesk-normal.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
```

Before downloading anything, check whether the fonts already in `fonts/` can do the job.
Archivo has a width axis from 62% to 125% and weights 400 to 900, so it covers condensed,
normal and extended faces on its own. JetBrains Mono, Anton and Permanent Marker are there too.

## Step 2: the token block

Pick an id: lowercase, no spaces (`blue-note`). Every token falls back to the defaults at the top
of `themes.css`, so set only what the reference needs. Always set the colour tokens for both modes.

```css
/* <Name>: <reference and what each choice comes from> */
[data-theme="blue-note"] {
  /* colour: required */
  --bg: #f2efe9; --surface: #ffffff; --surface-2: #e6e2da;
  --ink: #111111; --muted: #6d6a64; --line: #d9d4ca;
  --accent: #1f4fd1;
  /* --accent-ink: #ffffff;   text on accent fills; set it if the accent is light */
  --d1: #c9c5bd; --d2: #9c978e; --d3: #6d6a64; --d4: #3a3834; --d5: #1f4fd1;  /* difficulty 1..5 */

  /* type */
  --font-display: "Archivo", "Arial Narrow", sans-serif;   /* headings, weekday, quadrant names, wordmark */
  /* --font-ui: "Instrument Sans", "Segoe UI", sans-serif; body text and buttons */
  --display-case: uppercase; --display-weight: 800; --display-stretch: 75%; --display-tracking: 0;
  --quote-style: normal;            /* the default is italic; use normal unless you bundled an italic */

  /* sizes: tune these so long words fit (see Step 5) */
  --day-size: 64px; --quote-size: 28px; --size-quad: 20px; --size-next: 26px;

  /* shape */
  --radius: 2px; --radius-sm: 2px; --pill: 2px; --check-radius: 2px;

  /* masthead band: also used for the theme picker card */
  --mh-bg: #1f4fd1; --mh-ink: #ffffff; --mh-muted: rgba(255, 255, 255, .75); --mh-mark: #ffffff;
}
[data-theme="blue-note"][data-mode="dark"] {
  --bg: #0e0e0f; --surface: #161618; --surface-2: #1f1f22;
  --ink: #ece9e3; --muted: #8e8a83; --line: #2a2a2e;
  --accent: #5b82ff; --accent-ink: #0e0e0f;
  --d1: #2e2e32; --d2: #4b4b50; --d3: #7b7b80; --d4: #c4c4c8; --d5: #5b82ff;
}
```

Other tokens worth knowing (all optional):

| Token | Controls |
| --- | --- |
| `--size-wordmark`, `--size-dayname`, `--size-title`, `--size-cheer`, `--size-art` | Wordmark, reminder day names, dialog title, "done" toast, theme picker card title |
| `--quote-weight`, `--quote-stretch`, `--quote-lh`, `--quote-rule` | The masthead line. `--quote-rule` draws a left bar of that width |
| `--display-style` | `italic` for slanted headings (needs an italic file) |
| `--nav-size`, `--btn-size`, `--btn-weight`, `--btn-case`, `--btn-tracking` | Tabs and buttons |
| `--line-strong` | Borders on the plane, cards and dialogs (defaults to `--ink`) |
| `--grid`, `--q-do` | Plane grid lines and the tint on the "do first" quadrant |
| `--chip-border`, `--chip-shadow`, `--chip-first-bg`, `--chip-first-ink`, `--chip-first-rank` | Task chips on the plane; "first" is the top-ranked one |
| `--shadow-lg` | Dialogs, popovers, dragged chips |
| `--next-top`, `--next-top-color`, `--next-deco` | The "Up next" card: top border width and colour, extra box-shadow |
| `--grain` | Film grain over the whole app, 0 to about .14 |

## Step 3: the words

In `themes-local.js` (or `themes.js`), add the theme to `THEMES`. Themes are grouped in the
picker by `artist`, which must be a key in `ARTISTS`. Use an existing one or add a new group.
The objects are declared with `const` in `themes.js`, so the local file adds to them with
`Object.assign` and must not redeclare them.

```js
'use strict';

Object.assign(ARTISTS, {
  jazz: {
    name: 'Jazz sleeves',                        // group heading in the picker; also names the custom-lines setting
    lines: ['Play the next note.'],              // shared by every theme in this group
    done: ['Take a bow.', 'Next tune.'],         // toast when a task is completed
  },
});

Object.assign(THEMES, {
  'blue-note': {
    artist: 'jazz', name: 'Blue Note', short: 'Blue Note', year: 1959,   // short shows in the top bar
    blurb: 'Off-white card, one blue block, condensed caps.',            // tooltip in the picker
    quadrants: { do: 'Solo', schedule: 'Rehearse', quick: 'Riff', later: 'Encore' },
    lines: [
      'Play the next note.',
    ],
  },
});
```

Write original lines in the spirit of the reference. Never paste song lyrics, film dialogue
or other quotes. Keep quadrant names short (one or two words), because they're set large in the
display font.

## Step 4: backgrounds folder

Create `backgrounds/<id>/`. It can stay empty. The user drops `page.jpg` and `plane.jpg`
in later (see `backgrounds/README.txt`). Git doesn't track empty folders, so this only matters
on the user's machine.

## Step 5: check it

Open `index.html`, pick the theme from the swatch button in the top bar, and check:

- Light and dark mode both look right (the Auto / Light / Dark switch is in the theme panel).
- The weekday name, the longest quadrant name and a long task title in "Up next" all fit.
  Wide or uppercase display faces overflow first, so lower the `--size-*` tokens if needed.
- Text on `--accent` fills (the "Mark done" button) and on `--mh-bg` is readable.
- Headings render in the new font, not a fallback (compare against the font's specimen).
- Nothing is fake-italic: if headings or quotes look slanted and you didn't bundle an italic,
  set `--quote-style: normal` and `--display-style: normal`.

If you can't open a browser, headless Chrome can take a screenshot. Seed the theme by
setting `localStorage['focusboard.v1']` to `{"settings":{"theme":"<id>","mode":"light"}}`
from a small HTML file that then redirects to `index.html`, and run Chrome with
`--headless=new --allow-file-access-from-files --virtual-time-budget=3000 --screenshot=out.png`.

Tell the user the theme's id, what it's based on, and which files you changed. If you
downloaded a font, say which one and its licence.
