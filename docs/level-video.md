# Level videos, production

The production spec for the level videos of the futarchy snake: what a finished
video is, how its story is found in the record, and how it sounds. The renderer and
its commands implement this; `docs/snake.md` "The level videos" says where the data
comes from and how a render is run.

A level video is a produced piece, not a screen recording. It tells the story of one
level: the market failing again and again, learning, the near misses, the big bets,
and the fill. Around the game it looks like a professional trading tool, a dashboard
of panels (below); it carries no link while it plays; the links come in the credits.

## Moments

The story is found in the record. A move is a **moment** when at least one of these
is true, and its **weight** is the sum of what applies:

| kind | when | weight |
|---|---|---|
| near miss | exactly one of the three options would not have killed the snake, the snake took it and lived, and it was at least 6 long | 5 |
| whale | at least 300 credits were traded on the move | log2(credits) minus 5 |
| crowd | at least 3 different traders traded on the move | 2 |
| tie | the two highest recorded prices are within 0.5 of each other and the third is at least 5 below them | 2 |
| new best | the move eats and reaches a length no earlier move of the level reached | 3 |
| record crash | the crash that ends a record attempt | 4 |
| milestone | the move eats and the new length is a multiple of 10 | 2 |
| fill | the move fills the grid | 10 |

An option kills the snake when its cell is outside the grid, or is taken by the
snake's body; the tail's cell counts as free unless the move eats, because the tail
moves away.

## Structure

Both cuts are 1920 by 1080 (the Short 1080 by 1920) at 30 frames a second, and carry no
link while the game plays.

**The full cut, at most five minutes:**

1. **Cold open, about 6 seconds.** The level's strongest near miss with trades plays as
   a decision beat in slow motion (below), freezes on the lock for three frames, and cuts
   hard to move 1. No logo and no title card.
2. **The rules by doing, until 0:30.** The first traded decision plays in full once, with
   one caption, `Traders bet. The highest price moves.` Nothing is explained again.
3. **The struggle.** The level runs at speed with the death counter on screen, dropping
   into slow motion on moments (below), never twice within three seconds. Each new record
   brings a lower third, `RECORD <length> · attempt <n>`.
4. **The winning attempt, its last 45 to 60 seconds.** Playback slows as the grid fills;
   the last eight moves each get a full decision beat; the fill plays at normal speed with
   a hit stop and `FILLED`.
5. **Credits, 15 to 20 seconds.** A stats card (moves, deaths, trades, traders, real
   time), the top traders by credits, then `telarchy.com/snake`. The last 10 seconds stay
   clean for YouTube's end screen.

**The Short, 45 seconds:** the final near miss in slow motion as the hook (0 to 2 s), the
record crashes at speed (to 20 s), the winning attempt with two or three decision beats
(to 40 s), the fill (to 45 s), and a last frame that matches the first so it loops. All
text sits inside 60 px at the sides, 180 px at the top and 390 px at the bottom, where
YouTube draws over the Short: the counters sit above the board (the hook's caption takes
their place), and the race bars, or the best-so-far bar at speed, sit under it.

## The dashboard (full cut)

Everything around the board reads as a high-end trading tool: flat dark panels with a
hairline border, a small uppercase mono label at each panel's top left, tabular figures,
and no decoration that carries no data. The board keeps its box on the left; the panels
stack in one column to its right, clear of the margin the push-in may grow into, and
are on screen in every frame of the game (never in the credits):

1. **The status line**: `SNAKE · LEVEL <n> · <size>×<size>`, the time into the level of the
   move on screen as `T+<span>`, and the speed badge at its right end.
2. **Four stat cells**: `LENGTH`, `BEST` (as `<best> / <cells>`, over a thin gold progress
   bar of the best length so far against the full grid), `DEATHS` (red) and `ATTEMPT`.
3. **The length chart**, `LENGTH · WHOLE LEVEL`: the snake's length at every move of the
   level as one line, each crash a fall to the floor, with the credits traded per stretch
   of moves as volume bars under it. A playhead marks the move on screen; the part of
   the level still to come is dimmed, the part played is bright.
4. **The market**, `MARKET · NEXT MOVE`: the race bars (below), in every frame. Outside a
   beat they show the recorded prices of the move on screen, with no chips.
5. **The tape**, `TRADES`: the five most recent trades made up to the move on screen,
   newest first, one row each: the trader's handle, the option's arrow in its hue (a dash
   when it cannot be named), `+<credits>` in gold or `−<credits>` in grey, and the price it
   moved `<from> → <to>`. **The tape never shows a trade of a move that has not yet
   been shown**; within a beat a trade shown as a chip enters the tape when its chip
   starts, and the move's smaller trades enter at the lock.

A record card shows on the board, at the end away from the snake's head (and away from a
caption, if one is up). The Short keeps its own layout (Structure, above).

## The game looks like a game

The production is around the game, never on it. Inside the board's box the video shows an
ordinary snake game, the kind anyone has played, and the produced look (type, race bars,
cards, captions) stops at the box's edge.

- **The board is a checkerboard** of two tones; two cells that share an edge differ, and
  there are no grid lines.
- **The body is blocks**, one square segment a cell, their shade alternating along the body so the
  snake reads as striped. A segment and the next are joined by a link half a segment wide,
  with board showing at both sides of it, so the snake's path can be followed even when
  the grid is nearly full.
- **The head is a block** in a darker green with two white eyes and dark pupils, on the
  side it faces.
- **The food is an apple**: a red fruit with a stem and a leaf.
- **The tail leaves as the head arrives.** On a glide that does not eat, the last segment
  slides into the one before it by the same fraction the head has travelled, so the snake
  keeps its length in every frame; on a move that eats it stays.

## The trades: race bars

The market is three horizontal **race bars**, one lane per option in a fixed order (turn
left, straight on, turn right), beside the board in the full cut, centred on it, and
under it in the Short. A lane is labelled with the arrow of the direction the option moves
the snake on screen, and the same arrow, larger and outlined, sits on the board in the
cell ahead; an option that runs into the wall keeps its arrow, pinned inside the head's
cell against that wall. Each option keeps one hue for the whole video (turn left cyan, straight on
violet, turn right magenta). Green belongs to the snake, red to death, gold to records.

- A bar's length is the option's price on an axis from 0 to the full grid; a price under
  1 is a thin sliver, never a round stub. The price is printed after the lane in large
  tabular figures and counts as it moves, with the credits traded on the option under it
  in small type.
- The chips are the decision's **three largest trades**, shown in the order they were
  made; every smaller trade rolls into `+N more`. A chip is the credits over the trader's
  handle: `+<credits>` on a gold chip when the trade raised its option's price, and
  `−<credits>` on a grey chip when it lowered it (a bet against the option). A chip travels inside its own lane, from the lane's start to the bar's tip in a quarter
  second, eased out, and never covers another lane; the bar then grows with a small
  overshoot. A trade whose option cannot be named lands in a small pot above the bars
  instead: its chip sits on the pot's line, beside the pot's total, never over the board or a lane. Chips never overlap: a chip waits until the one before it has landed.
  `+N more` and the pot share one line above the bars, clear of the counters. Every
  price, credit line and chip stays inside the frame's safe area.
- In the Short the race bars are hidden at speed; the board and the counters stay, with a
  progress bar of the best length so far against the full grid in their place. In the full
  cut they stay (the dashboard, above).
- The leading lane is fully saturated, the others at 60 percent. At the lock the losing
  lanes dim to 30 percent, the winner flashes once, its arrow on the board reaches into
  the next cell, and the snake moves.

## The timeline

The pipeline turns a level into a **timeline**: every output frame at 30 frames a
second says which part of the level it shows and what is drawn over it. The numbers
here are the contract the renderer and the tests share.

- **Runs.** A run plays a stretch of moves forward at a speed in moves a second from the
  ladder 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128. Next to a beat a run eases: its speed
  climbs from 4 moves a second to its own over its first 12 frames, and falls back to 4
  over its last 12, so the snake never jumps from slow to fast. A run's frames take it
  from its first entry to its last exactly, never backward.
- **Beats.** A beat is one decided move in slow motion: 20 frames for each chip it shows
  (up to three), 18 frames of the lock (its first 3 a hit stop, then the winner held while
  the losers dim), then 18 frames of the snake moving into the cell. A move nobody traded
  has a beat of the lock and the move alone. The cold open and the rules beat play at
  half speed, every phase twice as long, so their caption can be read; the Short's hook
  plays at normal speed.
- **Choosing beats.** The cold open uses the level's strongest near miss that was
  traded, from before the finale's last 8 moves, so the opening never gives away the
  fill. The first traded decision of the level is always a beat, carrying the caption
  `Traders bet. The highest price moves.`. Then the strongest moments (by weight) get
  beats, strongest first, as long as beats take at most half of the story's time and the
  full cut stays within five minutes with the runs at the slowest ladder speed that fits.
  Outside the finale, between two beats there are always at least 90 frames of run, so
  two beats are at least 13 moves apart.
- **The finale.** The winning attempt plays in runs split at each fifth of the grid
  filled, each run no faster than the one before (not counting a short run between two
  beats, which slows only itself), at a speed that falls as the grid
  fills, from the struggle's speed at its start to 4 moves a second at the end; its last
  8 moves are beats; the fill holds 4 frames of hit stop and then 90 frames of `FILLED`.
- **Credits** last 540 frames (18 seconds).
- **The Short** is at most 1,500 frames (50 seconds): the hook is a beat on the winning
  attempt's last near miss before its final 8 moves, with the caption
  `A market picks every move.`; then the last
  6 moves before each of the latest four record crashes, each a crash run at 16 moves a
  second; then the
  winning attempt as a run ending by frame 1,200 with beats on its two strongest moments;
  then the fill; the last 6 frames repeat the first frame so it loops.

## Frames

Every output frame is described before it is drawn: which point of the level it shows and
what sits over it. The renderer draws only what the description says.

- **Where the snake is.** In a run, the entry the run has reached at that frame (a
  fraction between two entries while the snake glides). In a beat, the entry before the
  decided move through the chips and the lock, then gliding into the move over its move
  phase, arriving on its final frame. In a hold, the level's last entry.
- **A beat's phases.** With `c` the chip length (20 frames, 40 in a half-speed beat), chip `k`
  (from 0) plays during frames `ck` to `ck + c - 1` of the beat, with its progress from 0 to
  1 across them; the lock is the next 18 frames (36 at half speed); the move is the rest.
- **The push-in.** The zoom is 1 outside beats. During a beat it eases up to 1.08 over
  its first 8 frames, holds, and eases back to 1 over its last 8; the renderer keeps the
  whole board in frame: the board may grow into the empty margin around its box (50 px in
  the full cut, 10 px in the Short), the push-in is cut short where it would grow further,
  and no edge of the board is ever cropped.
- **The speed badge** reads `x<speed / 4>` in a run faster than 4 moves a second, and is
  absent everywhere else.
- **Captions.** A beat that carries a caption shows it for the whole beat; no other
  frame has one.
- **Record cards.** When a run or a beat reaches the crash that ends a record attempt, a
  lower third `RECORD <length> · attempt <n>` shows for 60 frames; a later card replaces
  an earlier one.
- **Holds and credits** say which they are and how far through they are, from 0 to 1.

## Pacing

A **decision beat** is one move shown in slow motion: the race bars fill trade by trade,
the lock, then the move. A moment (above) gets a beat when its weight is among the
strongest of the level; everything between beats plays at speed, the speed shown as a
small badge only while it is not normal speed. Speed ramps ease over 8 to 15 frames into
slow motion and about 8 frames out of it. A crash and a lock hold for three frames (hit
stop), the fill for four. The camera is still by default, pushes in toward the snake's
head during a beat (at most 108 percent, and never so far that any of the board leaves the
frame) and eases back after it, and shakes only on a crash.

## Motion and type

The snake glides between cells at normal and slow speed: at a fractional position
`i + t` its head is drawn the fraction `t` of the way from entry `i`'s head to entry
`i + 1`'s, its body follows entry `i`'s cells, and at a whole position it is exactly that
entry. The head faces the way it is going: while it glides from entry `i` to entry `i + 1`
its eyes are entry `i + 1`'s heading, and at a whole position that entry's own; a respawn
is not a glide, so the snake keeps entry `i`'s heading until it jumps. Above eight moves a second it jumps cell to cell with a short fading trail on the
head. Entrances ease out, moves ease in and out, durations are 150, 300 or
600 ms. Type is Inter at 600 to 800 weight with tabular figures; handles in JetBrains
Mono. Counters are at least 48 px in the full cut and 96 px in the Short, and nothing in
the Short is under 40 px. A caption never covers the snake's head; in the Short the hook's
caption sits above the board, in place of the counters. Text is left-aligned; only a single-line title or a lone number
is centred.

## Sound

A cut carries its music and nothing else: no sound effects of any kind. The music plays
from the first frame, looped if the cut outlasts it, fades in over a second and out over
the last two. The finished mix is -14 LUFS integrated.

## The script

`npm run script -- <game>` prints the level's script: the level in one line (grid,
moves, attempts, deaths, trades, traders, real time), then every moment in order with
its move number, its real time into the level, its kinds and its weight, and the
strongest ten marked. A person reads the script to see what the video will dwell on.

## Encoding

The music is decoded to mono at 44.1 kHz, normalized to
-14 LUFS, limited, and encoded as AAC at 160 kbit/s beside the video. Each cut's sidecar
gives its duration as the timeline's frames over 30.

After the audio is encoded, the pipeline measures the file's true peak. Above -1 dBTP
it lowers the whole mix by the excess plus half a decibel and encodes the audio again,
at most three times, so a finished file never clips on a phone whatever the music.
