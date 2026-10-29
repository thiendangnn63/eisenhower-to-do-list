# Focus Board

A personal to-do list laid out on an urgency/importance plane, plus reminders. Plain HTML, CSS and JS, so there's nothing to install and no server.
Fonts are bundled in `fonts/` so it works offline.

## Open it
- Double-click **Focus Board** on the Desktop (opens in its own Chrome app window), or open `index.html` in any browser.
- Recreate the shortcut any time: `powershell -ExecutionPolicy Bypass -File .\Create-Desktop-Shortcut.ps1`

## Tasks
- The plane: X is urgency, Y is importance (0 to 10 each). Drag chips around, click an empty spot to add a task there,
  or add from the side panel and then drag it in / click it and click a spot. Drag a chip back to "To place" to remove it.
  Arrow keys nudge a focused chip (Shift = bigger steps).
- Difficulty runs from 1 (trivial) to 5 (very hard) and sets the colour of the rank dot.
- The score (tweak it in Settings):
  `score = w·importance·10 + (1−w)·urgency·10 + bias·(3 − difficulty)/2`
  Defaults: w = 55% importance, bias = +10 (easy tasks nudged up, hard ones down; set negative for "eat the frog").
- A due date (optional, in the task editor or next to Add) makes the task's urgency drift from where you placed it to 10,
  starting when the date is set and reaching 10 at the start of the due day. Importance sets the pace,
  `multiplier = 0.5 + importance/10` (0.5× to 1.5×):
  `pull = min(1, progress × m)` if m ≥ 1, else `progress^(1/m)`, and `urgency = placed + (10 − placed) × pull`.
  Example: a 3-week task at importance 10 is maxed after 2 weeks; at importance 5 it moves steadily;
  at importance 0 it starts slowly and catches up at the end. Only urgency moves. The dashed trail shows the drift.
  Dragging a drifted chip sets where it *shows*. Changing the date restarts the drift, and Clear removes it.

## Themes
Pick one from the swatch button in the top bar, plus Auto / Light / Dark. The repo ships with one theme,
Paper (an engineering graph pad: white sheet, blue-grey grid, one red pen).

Each theme has its own fonts, colours, quadrant names and motivational lines (the header line changes daily; ↻ shuffles).
Add your own lines in Settings → Motivation, one per line. Write `text -- credit` to show a credit. Your lines are shared by
every theme in the same group.

### Adding your own
Personal themes go in `themes-local.css` and `themes-local.js`. Both are gitignored, and `index.html` loads them only if
they exist, so a fresh clone runs without them. A theme is a `[data-theme="x"]` token block in the CSS, an entry in the JS,
and a `backgrounds/x/` folder. Fonts are bundled in `fonts/` and declared in `fonts.css`.

The step-by-step version, with templates and a token reference, is the `font-template` skill in
`.claude/skills/font-template/SKILL.md`. Claude Code picks it up automatically in this folder, so you can ask it to
"add a theme based on <something>" or "use <font> for headings".

## Backgrounds
Put images in `backgrounds/<theme>/` named `page.*` (whole app) and `plane.*` (the plane). jpg, png, webp, gif and avif all work.
`backgrounds/default/` covers every theme without its own. The picture icon in the top bar shows what's in use,
sets how faded each image is (saved per theme), and copies the folder path. New files are picked up when the window regains focus.

## Reminders
Grouped Overdue / Today / Tomorrow / Next 7 days / Later. Repeat daily, weekdays, weekly or monthly.
Completing a repeating reminder rolls it to the next occurrence. Overdue ones can be snoozed.
Alerts (toast + chime, plus a Windows notification if enabled in Settings) only fire while the app is open or minimized.

## Checklists
In the Board sidebar. Each checklist has weekdays, a time and a list of items (one per line). At that time it pops up
with the chime and a Windows notification; if the app was closed then, it pops the next time you open it that day.
Boxes start empty on every scheduled day. The streak counts scheduled days finished in a row, and the strip under each
checklist shows the last seven scheduled days (filled = done, faded = partly done, empty = missed).

## Data
Stored in the browser's localStorage (for `index.html` opened via the shortcut, that's Chrome's profile).
Use Settings → Export JSON for backups. Clearing browser site data will erase it.
