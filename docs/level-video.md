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

## The script

`npm run script -- <game>` prints the level's script: the level in one line (grid,
moves, attempts, deaths, trades, traders, real time), then every moment in order with
its move number, its real time into the level, its kinds and its weight, and the
strongest ten marked. A person reads the script to see what the video will dwell on.

## Encoding

After the audio is encoded, the pipeline measures the file's true peak. Above -1 dBTP
it lowers the whole mix by the excess plus half a decibel and encodes the audio again,
at most three times, so a finished file never clips on a phone whatever the music.
