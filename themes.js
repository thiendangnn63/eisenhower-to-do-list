'use strict';

/* =========================================================
   Themes: colours/fonts live in themes.css under [data-theme="…"];
   this file holds each theme's words.
   Personal themes go in themes-local.js (not in git), which adds to
   ARTISTS, THEMES and THEME_ALIASES. Users add their own lines in
   Settings; those are shared by every theme of the same artist.
   ========================================================= */

const ARTISTS = {
  paper: {
    name: 'Focus Board',
    lines: [],
    done: ['Nicely done.', 'Crossed off.', 'One less thing.', 'That’s handled.', 'Onward.'],
  },
};

const THEMES = {
  paper: {
    artist: 'paper', name: 'Paper', short: 'Paper', year: '',
    blurb: 'Graph paper, graphite and a red pen.',
    quadrants: { do: 'Do first', schedule: 'Schedule', quick: 'Quick hits', later: 'Later' },
    lines: [
      'Small steps, taken daily, look like magic from the outside.',
      'Do the thing you keep moving to tomorrow.',
      'You’ll figure it out faster once you start.',
      'Give one task your full attention, then move on.',
      'Cut the list in half and see what still matters.',
      'Start rough and fix it later.',
      'Today’s effort is tomorrow’s easy.',
      'The second task always goes quicker than the first.',
      'Pick one thing off the list and begin.',
    ],
  },
};

// Old theme ids, mapped to their replacements (local theme files can add more)
const THEME_ALIASES = {};
