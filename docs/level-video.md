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

**The full cut, at most two and a half minutes:**

1. **The opening: game, screen, game, screen, game.** The video starts on the game and the
   explanation pops up between stretches of it, never laid over it:
   - **The hook**: the level's strongest near miss that was traded, from before the
     finale's last 8 moves, plays as a decision beat at half speed, with no caption.
   - **Screen 1, 135 frames**, over the hook's last frame: label `FUTARCHY SNAKE · LEVEL <n>`,
     lines `Nobody is playing this.` and `A prediction market decides every move.`
   - **The game from move 1** up to the rules beat (below).
   - **Screen 2, 240 frames**: label `HOW IT WORKS · 1`, lines `Traders bet on each
     direction the snake can go.` and `Each price is their forecast of how long the snake
     will get.`
   - **The rules beat**: the first traded decision from move 13 on whose three prices were
     recorded plays in full at half speed, with no caption. The game before it plays at 4
     moves a second when it is 40 moves or fewer, so at least 90 frames of game separate
     screen 1 from screen 2.
   - **Screen 3, 120 frames**: label `HOW IT WORKS · 2`, lines `The highest price is the
     move.` and `Nobody steers.`
   - Then the game, to the end. A level with no such near miss opens on screen 1 over move
     0; a level with no rules beat shows screens 2 and 3 straight after screen 1.
   **A screen is animated and full screen.** It pops out of the frozen game: a gold line
   across the middle of the frame opens to the full frame over 8 frames with a small
   overshoot, the label and the first line rise 40 px into place and fade in (6 frames apart, 10
   frames each) and every further line follows 36 frames after the one before, so each
   can be read before the next arrives; a screen stays long enough to be read at three
   words a second with a second to spare, the words that carry the idea (`prediction market`,
   `forecast`, `highest price`) turn gold once their line has landed, and over its last 8
   frames the screen closes back to the line and the game goes on from where it froze.
   While it is fully open nothing of the game shows. Type is large (title lines 84 px),
   left aligned on one margin. The screens say nothing about how the level went.
3. **The struggle.** The level runs at speed with the death counter on screen, dropping
   into slow motion on moments (below), never twice within three seconds. Each new record
   brings a lower third, `RECORD <length> · attempt <n>`.
4. **The winning attempt.** Playback slows as the grid fills;
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
their place), and under the board, in every frame of the game, sit **the market and the
bets**: the price ladder in a compact form (one row per option: its arrow and name in its
hue, its price in large figures, the credits traded on it, over its depth bar; no column
heads, no tag, no verdict), and under it a tape of the two most recent trades (handle,
arrow, `+<credits>` or `−<credits>`). Both follow the full cut's rules: chips fly along a
row in a beat, the lock dims the losing rows, the tape never shows a trade of a move not
yet shown, and nothing reaches past the move on screen. In the Short a trade whose option
cannot be named has no chip and no pot line; it shows on the tape with a dash.

## The terminal (full cut)

Everything around the board reads as a professional trading terminal: no boxes, one grid
ruled by hairlines, small uppercase mono labels, tabular figures, and nothing on screen
that carries no data. The grid is on screen in every frame of the game (never in the
credits) and the board sits in its left cell, clear of every rule even at full push-in:

1. **The ticker**, across the top: `SNAKE/L<n>`, then `<size>×<size> · T+<span>` (the time
   into the level of the move on screen), and at the right `LEN`, `BEST` (as `<best>` with
   `/<cells>` in grey), `DEATHS` (red), `ATTEMPT`, `MOVE` (the number of the move on
   screen, alone) and the speed badge.
2. **The price ladder**, `WHERE SHOULD THE SNAKE GO?`: one row per option in the fixed order,
   under the column heads `OPTION`, `FORECAST LENGTH`, `Δ`, `CREDITS`, `TRADES` (a price is
   the market's forecast of how long the snake gets if it goes that way, and the head says so). A row is the option's
   arrow and name in its hue, its price in large figures, the change the move's trades
   made to it (green up, red down, grey when none), the credits traded on it as
   `<credits> cr`, and the count of its trades, over a depth bar in the option's hue whose
   length is the price on the axis from 0 to the full grid. The ladder is the full cut's
   form of the race bars (below): chips fly along a row to its depth bar's tip, and the
   lock dims the losing rows. Outside a beat it shows the settled figures of the move on
   screen, with no chips. Once a move is locked its played row carries the tag `PLAYED`, and
   under the rows a verdict line reads `Market says <way> · <lead> ahead`, the lead being
   the played price less the next highest (`Market has no price` when none was recorded,
   `Market is tied · <way> played` when the lead is under 0.05).
   A move whose prices were not recorded shows a dash for its price
   and its change and no depth bar, never a zero.
3. **The price chart**, `FORECASTS · LAST 40 MOVES`: the three options' prices as three lines
   in their hues over the forty moves up to the one on screen, on an axis fitted to them
   and labelled at the right, each line ending in a dot at its latest price (while a beat's trades are still arriving
   the lines stop at the move before), with a gold
   diamond on a line where at least 300 credits were traded on that option in one move.
4. **The tape**, `TAPE`: the nine most recent trades made up to the move on screen,
   newest first, one row each: the trade's clock time, the trader's handle, the option's
   arrow in its hue (a dash when it cannot be named), `+<credits>` in gold or `−<credits>`
   in grey, and the price it moved `<from> → <to>`. Within a beat a trade shown as a chip
   enters the tape when its chip starts, and the move's smaller trades enter at the lock.

5. **The narrator line**, under the board, one plain sentence about the move on screen, the
   first of these that applies:
   - in a run faster than 16 moves a second, `Attempt <n> · best so far <best> of <cells>`;
   - while a beat's trades are still arriving, `Traders are pricing the next move`;
   - when only one of the three ways would not kill the snake, `One way out: <way>`;
   - when one trade of at least 300 credits was made on the move, `<handle> put <credits>
     on <way>` (the largest such trade);
   - when the two highest prices are within 0.5 of each other but not tied (a lead of at
     least 0.05), `Traders split: <way> leads by <lead>`;
   - otherwise `Attempt <n> · <length> long`.

**Nothing on screen gives away how the level goes on or when it ends**: no progress
through the level, no count of its moves, no chart or list reaching past the move on
screen. A frame of the game is drawn from the record up to the move it shows and the
move being decided, and would look the same if the level's record stopped there.

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
the snake on screen. The board itself carries no option arrows: nothing is drawn next to
the snake's head. Each option keeps one hue for the whole video (turn left cyan, straight on
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
- In both cuts the race bars take the form of the price ladder and stay on screen at every
  speed (the terminal, above; the Short's compact form, Structure).
- The leading lane is fully saturated, the others at 60 percent. At the lock the losing
  lanes dim to 30 percent, the winner flashes once, and the snake moves.

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
  has a beat of the lock and the move alone. The rules beat plays at half speed, every phase twice as long, so the
  first decision can be followed; the Short's hook plays at normal speed.
- **Choosing beats.** The hook (Structure, 1) replays a moment of the story and is no part
  of it. The first traded decision from move 13 on whose three prices were
  recorded is always a beat, the rules beat; it carries no caption, the cards having said
  it. Then the strongest moments (by weight) get
  beats, strongest first, as long as beats take at most half of the story's time and the
  full cut stays within two and a half minutes with the runs at the slowest ladder speed that fits.
  Outside the finale, between two beats there are always at least 90 frames of run, so
  two beats are at least 13 moves apart.
- **Big deaths.** A death is **big** when the snake had reached at least 40 percent of the
  grid in that attempt. Every big death is a beat on the move that kills it, so the run
  before it eases down to 4 moves a second, the fatal decision plays in slow motion, and
  the crash lands in red; every other death stays inside its run at speed. Big deaths come
  before the strongest moments when beats are chosen; should they alone take more than
  half of the story's time, the ones that reached the furthest are kept. A big death that
  set no record shows the card `DIED AT <length> · attempt <n>` the way a record crash
  shows its record card.
- **The finale.** The winning attempt plays in runs split at each fifth of the grid
  filled, each run no faster than the one before (not counting a short run between two
  beats, which slows only itself), at a speed that falls as the grid
  fills, from the struggle's speed at its start to 4 moves a second at the end; its last
  8 moves are beats; the fill holds 4 frames of hit stop and then 90 frames of `FILLED`.
- **Credits** last 540 frames (18 seconds).
- **The Short** is at most 1,500 frames (50 seconds): the hook is a beat on the winning
  attempt's last near miss before its final 8 moves, with the caption
  the hook's caption (Structure, above); then the last
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
  phase, arriving on its final frame. In a hold, the entry it holds.
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
- **Captions.** A beat that carries a caption shows it for the whole beat; no other frame
  has one.
- **Screens.** A screen's frames say which screen it is, the entry the game is frozen on
  under it, and how many frames in and how many from its end the frame is.
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
Mono. Counters are at least 36 px in the full cut and 96 px in the Short, and nothing in
the Short is under 40 px. A caption too long for its band at the frame's smallest type size breaks into two lines
at the space nearest its middle. A caption never covers the snake's head; in the Short the hook's
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
