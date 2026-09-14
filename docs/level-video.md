# Level videos, production

The production spec for the level videos of the futarchy snake: what a finished
video is, how its story is found in the record, and how it sounds. The renderer and
its commands implement this; `docs/snake.md` "The level videos" says where the data
comes from and how a render is run.

A level video is a produced piece, not a screen recording. It tells the story of one
level: the market failing again and again, learning, the near misses, the big bets,
and the fill. It carries no site chrome while it plays; the links come in the credits.

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
site chrome, no link and no panel while the game plays.

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
text sits inside 60 px at the sides, 180 px at the top and 390 px at the bottom.

## The trades: race bars

The market is three horizontal **race bars**, one lane per option in a fixed order,
`↰ LEFT`, `↑ STRAIGHT`, `↱ RIGHT`, beside the board in the full cut and under it in the
Short. Each option keeps one hue for the whole video (left cyan, straight violet, right
magenta), and the option's arrow on the board uses the same hue. Green belongs to the
snake, red to death, gold to records.

- A bar's length is the option's price on an axis from 0 to the full grid, with a faint
  tick at the snake's current length. The price is printed at the bar's end in large
  tabular figures and counts as it moves.
- Each trade is a chip, `+<credits>` over the trader's handle, that flies from the lane's
  start to the bar's tip in a quarter second, eased out; the bar then grows with a small
  overshoot. A thin strip under the lane adds up the credits traded on the decision. At
  most three chips fly per decision; the rest roll into `+N more`.
- The leading lane is fully saturated, the others at 60 percent. At the lock the losing
  lanes dim to 30 percent, the winner flashes once, its arrow on the board reaches into
  the next cell, and the snake moves.

## Pacing

A **decision beat** is one move shown in slow motion: the race bars fill trade by trade,
the lock, then the move. A moment (above) gets a beat when its weight is among the
strongest of the level; everything between beats plays at speed, the speed shown as a
small badge only while it is not normal speed. Speed ramps ease over 8 to 15 frames into
slow motion and about 8 frames out of it. A crash and a lock hold for three frames (hit
stop), the fill for four. The camera is still by default, pushes in to 108 percent on the
snake's head during a beat and eases back after it, and shakes only on a crash.

## Motion and type

The snake glides between cells at normal and slow speed (the head and tail interpolated
along the body), and above eight moves a second it jumps cell to cell with a short fading
trail on the head. Entrances ease out, moves ease in and out, durations are 150, 300 or
600 ms. Type is Inter at 600 to 800 weight with tabular figures; handles in JetBrains
Mono. Counters are at least 48 px in the full cut and 96 px in the Short, and nothing in
the Short is under 40 px. Text is left-aligned; only a single-line title or a lone number
is centred.

## Sound

The music is the bed, about -18 LUFS. Small sounds (a trade's coin, an eat) sit 4 to 8 dB
under it and play only at normal or slow speed; only a crash, a record and the fill rise
above it, by at most 6 dB, with the music ducking 3 to 5 dB under them. Every sound has
three or four variants with a small random pitch and level, never the same variant twice
in a row. At speed there are no per-event sounds. The finished mix is -14 LUFS integrated.

## The script

`npm run script -- <game>` prints the level's script: the level in one line (grid,
moves, attempts, deaths, trades, traders, real time), then every moment in order with
its move number, its real time into the level, its kinds and its weight, and the
strongest ten marked. A person reads the script to see what the video will dwell on.

## Encoding

After the audio is encoded, the pipeline measures the file's true peak. Above -1 dBTP
it lowers the whole mix by the excess plus half a decibel and encodes the audio again,
at most three times, so a finished file never clips on a phone whatever the music.
