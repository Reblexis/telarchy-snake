# Futarchy snake

A snake game steered by a Telarchy workspace. Every minute the market
decides the snake's next move: three proposals are posted, turn left,
turn right and continue forward, each priced by the workspace's own pair
markets on the snake's length, and the one the market expects to leave
the snake longest is approved. The game runs around the clock and a board
page shows it live.

It exists for four reasons, all Viktor's (record:
`viktor-cihal/projects/futarchy/snake-workspace.md`, decision log in the
telarchy umbrella `notes/futarchy-snake-proposal-38.md`):

- a fun workspace that surfaces bad UI choices in the product,
- a target that motivates people to write AI trading agents,
- marketing (a stream, a link),
- a performance test: one workspace posting thousands of proposals a day
  is a load the site has never carried, and it must carry it.

Everything below is the contract. Internals of the engine and the service
are free within it.

## The game

- The first game is on a grid 12 by 12; each later game is one cell
  wider and taller than the last (13 by 13, then 14 by 14, and so on).
  The snake starts at the centre with length 2, heading right, one food
  on a free cell. Classic rules: the snake moves one cell
  per step in its heading, eating food grows it by one and spawns new food
  on a random free cell, hitting a wall or its own body kills it.
- One step per minute, at the top of each UTC minute. The step's action
  is the approved proposal's action (below): **turn left** and **turn
  right** are relative to the snake's heading (a snake heading up that
  turns left moves left), **continue forward** keeps the heading. A snake
  cannot reverse, so no action runs it into its own neck.
- On death the snake respawns at once at length 2 in the starting state.
  Deaths are counted and shown, nothing else happens: the market prices
  the longest the snake gets, and a snake back at 2 is far from beating
  its record, so a death is its own penalty.
- A game ends when the snake fills the grid (length 144 on the first
  grid): it is **complete**, the operator posts no more proposals, keeps
  posting the full grid as the reading every minute, and the board
  shows the full snake and says so. After a **cooldown of one hour** the
  next game starts on the larger grid, at length 2, with the game number
  counted up. Until a game completes it runs without end.

## The workspace

One public Telarchy workspace named `Snake` (Telarchy derives the slug,
`snake`, from the name), owned by the snake operator account. One metric,
**Max length achieved**, the longest the snake has been in the current
game: an integer that starts at 2, never falls during a game (a death
does not lower it) and starts again at 2 when a new game begins on the
larger grid. Its market range is 0 to the full grid (144 on the first
grid), so a book can price any length the snake can reach; when a new
game starts on a larger grid the operator raises the range to the new
full grid first. Telarchy refuses that while an open book on the metric
has trades, so the operator retries every minute until it goes through,
and the cooldown lasts that long. The operator posts a reading after
every step, so the metric's chart is the record minute by minute.

The metric is priced on one rolling horizon, a one-minute period on
Telarchy's clock sixty minutes out (`+60min`): the record after **60
moves**. A book for a minute settles on the last reading whose timestamp
falls inside that minute; the operator's reading at the top of each
minute, posted right after the move, is that minute's fixing, so the
book for minute M+60 settles on the record after sixty more moves. No
other horizon and no calendar horizon is priced.

A rolling minute cell exists only once the workspace's rolling markets
are refreshed, so the operator forces that refresh at every step, before
posting the three proposals; the baseline book for the step's cell is
then open and every proposal gets its pair.

Liquidity: every pair book a proposal opens is funded by the workspace
owner through the metric's proposal credits on the 60-move horizon (40
credits a book, so a five-credit trade is an opinion and a twenty-credit
one does not pin the book),
never by the proposer; the operator posts
with no subsidy of its own. The workspace's decision window is one minute,
the minimum. The workspace has no charter, so a decline needs no reason.

The workspace is **muted**: `notificationsMuted` is on, so nothing it does
reaches anyone by email, push or the bell, owner included. Three proposals
and three decisions a minute would otherwise mail the owner and the
proposer thousands of times a day. It stays muted until Viktor says
otherwise.

## The step

At second 0 of each minute the operator posts three proposals at once,
titled `Game G, attempt A, move N: Turn left`, `Game G, attempt A, move
N: Turn right` and `Game G, attempt A, move N: Continue forward`, where G
is the game number, A the current attempt (the deaths so far in this game
plus one: the snake's first life is attempt 1, and every respawn starts
the next) and N the move the proposals decide counted within that attempt
(the first move after a start or a respawn is move 1), so a proposal
names its place in the game wherever Telarchy lists it and a reader can
tell one minute's `Turn left` from the thousand others. The action is the
part after the colon, exactly one of the three. Each
carries the same deadline, the top of the next minute, so the books
close together and the deadline a trader sees is the real one. The
description names the step, the state including the current heading,
the current length and record, and the compass direction each action
would take, the cell the proposal is priced on (as a clock minute, UTC),
the rule, and the board's address, in one line.

During the minute the operator re-reads the proposals' pairs every five
seconds and publishes them on `/state`, so the board and any bot see the
live prices and the current leader, not only the decision.

At second 58, two seconds before the deadline, the operator reads each
proposal's pair one last time and decides: a direction's score is its
predicted impact, the approved-branch price minus the declined-branch
price. Then:

- the proposal with the highest score is **approved**; its declined
  branch voids and its approved branch stays open to settle on the
  record at its minute;
- the other two are **declined with refund**: both their branches void
  and every stake in them returns;
- ties go to the current heading, then to up, right, down, left in that
  order;
- if no price can be read, or the API fails, the snake continues in its
  current heading and the three proposals are declined with refund; the
  step is logged as undecided.

The approved action is applied at the next top of minute. So the board
shows: proposals for step N open during minute N, decision at N:58, move
at N+1:00, and the next three proposals posted the same second.

Nothing about the game is decided by the operator except through this
rule. The operator account never trades.

## The board

The service serves one page, the board, at `/`. It is meant to be fun to
watch and to tell a visitor, at a glance, what the market is doing to the
snake right now. It polls the service's own `/state` JSON every two
seconds and shows nothing that is not in it.

The board has two tabs, **Live** and **Replay**, switched by one small
row of two links above the content and nowhere else; Live is the default
and the page never opens on Replay by itself. Live is the first screen
below. Replay is "The replay" below. The tab row is the only thing shown
above the first screen, and it is also shown in the embed.

The board shows the most important thing first and as little else as
possible. The first screen (what a visitor sees without scrolling, at
1280 wide, at phone width and in the 16:9 embed) holds, under the tab
row, exactly these five elements, in this order, and nothing else:

1. **The grid**, large and clean: a near-black board with soft grid
   lines, the snake as rounded green segments, its head clearly marked
   with its heading (an eye or wedge on the side it moves towards, a soft
   glow around the head), the food as a rounded red dot. The cell size
   follows `grid` on `/state`, so a larger game draws smaller cells.
   Source: `game`, `grid`.
2. **The next move**, one big line: the arrow of the resulting compass
   direction and the action, `→ Turn left`, with the seconds to the
   decision as a clock beside it, `0:31`. Before the decision it is the
   current leader, the action with the highest live 60-move impact
   (forward when no price is readable, per the rule), in the accent
   colour; once decided the clock goes and the line reads as decided,
   in the snake's green, held until the move at the top of the minute.
   Source: `next` on `/state` (`action`, `direction`, `decided`,
   `seconds`).
3. **Three choice tiles**, Continue, Left, Right, each showing only its
   compass arrow, its name and its live 60-move impact (`+1.4`) as a large
   tabular number; the leader in the accent colour. Each tile links to
   its proposal on telarchy.com. Source: `open.quotes`,
   `open.directions`, `open.proposals`.
4. **One status line**, four facts and no more: `Length 7 · Record 9 ·
   Game 1 · 12x12`. Source: `game.length`, `bestLength`, `gameNumber`,
   `grid`.
5. **One quiet line** at the bottom: the newest trade (`philipp-gl bet
   5 on Turn left`), or, when there is none, the commentary. Never both.
   Source: `recentTrades[0]`, else `commentary`.

Everything else lives below the fold in one collapsed **More** section
(a `details` element, closed by default) that holds, in this order: the
approved and declined prices per action, the current traders (with the
counts this step and today), the last 30 trades, the leaderboard, the
last ten decisions, the counters (best length this game, deaths today,
step) and the rule in words. Source: `open.quotes`, `traders`,
`tradersThisStep`, `tradersToday`, `recentTrades`, `leaderboard`,
`recentDecisions`, `bestLength`, `deathsToday`, `game.step`, `rule`.
Under More comes one short footer line with the workspace link, the
stream link and `/state`.

Visual language: calm and modern, one accent colour (yellow) for the
leader and the next move, green snake, red food, near-black background,
large tabular numbers, generous spacing, no box inside a box. Body text
is left-aligned; only a title or a single number may be centred. The
page is one static HTML file with inline CSS and JS; its only external
asset is the Inter typeface from Google Fonts, with a system fallback.
At 1280 wide the grid sits left and the move, tiles and lines sit
right; at phone width the grid fills the width and the rest stacks
below it.

The board also renders inside Telarchy: the workspace's live-view
setting points at the board's embed form (`/?embed=1`), and the public
floor shows it above the owner's text. The embed is the first screen
alone, sized for a 16:9 frame: the More section and the footer are not
rendered at all. A visitor of telarchy.com/snake sees the game without
leaving the floor.

### The replay

The Replay tab shows the game itself, move by move, and follows it live.
It holds, in this order and nothing else: the grid (drawn exactly as on
Live, at the frame the timeline points to), a **timeline** (a slider
over every recorded move of the chosen game, a play/pause control that
plays at ten moves a second, and a game picker when more than one game
is recorded), and **one caption line**, `Game 1 · attempt 30, move 3 · Turn
left → · length 7`, the move the frame shows (the attempt and the move
within it, as the proposal titles count them), the action the market
approved for it (`undecided` when the step was), the resulting compass
arrow and the length after it. Deaths show as the frame after them: the
snake back at the start, length 2.

While the slider sits at the newest move the tab is live: every new move
arrives within two seconds and the frame advances with it, so the tab
is the game in real time with the whole game behind it. Dragging the
slider back stops following; dragging it to the end, or pressing play
through the end, resumes it. A game that is complete replays to its full
grid and stops. The embed shows the Replay tab the same way, sized to the
frame.

The replay is rebuilt on the page from `/replay` (below): the start
frame and the list of moves, each replayed through the game's rules
(one cell in the recorded direction, growth on the food, respawn on a
death), so the page never stores a frame the service did not record.
Recording starts when this version of the service first runs: a game
that was already under way is recorded from that step on, its start
frame is the state at that moment, and the caption's first move is the
attempt's move at that step, not 1.

### The feed

`/state` is public and is the whole of the board's data and a bot's feed:
the game state, the workspace and metric ids, the open step with its
three proposals, and for each action the approved and declined market
ids and their live prices, the cell key, the decide instant and
the next step instant, the decision rule in words, recent decisions and
counters. A bot needs one read of `/state` per step to know what to
trade.

The activity fields on `/state`, all read from Telarchy's public
workspace endpoints, never from the operator's own books:

- `next`: `{ action, direction, decided, seconds }`, the next move as
  defined above.
- `commentary`: the one-line commentary.
- `bestLength`: the longest the snake has been in this game, which is
  the metric's current reading.
- `traders`: the positions in the open step's books, each
  `{ handle, action, horizon, branch, side, shares, cost, worth }`;
  `tradersThisStep` the number of distinct handles in it; `tradersToday`
  the number of distinct handles seen trading or holding a position in any
  snake book since midnight UTC (a counter that survives a restart).
- `recentTrades`: the last 30 trades across the snake's books, newest
  first, each `{ id, at, handle, step, action, horizon, branch, side, kind,
  shares, cost, marketId, price }` where `price` is the book's consensus
  when the trade was first seen, or null.
- `leaderboard`: the top five `{ rank, handle, profit, trades }` of this
  workspace, or an empty list when Telarchy reports nobody.
- `activityAt`: when the activity was last read.

`/replay` is public too and is the whole of the Replay tab's data:
`GET /replay?game=G&from=I` returns `{ games, gameNumber, size,
complete, start, moves }`: `games`, the numbers of every recorded game,
oldest first; `start`, the recorded start frame `{ step, snake, heading,
food, deaths, attemptStep }` of game G (the newest game when `game` is absent);
`moves`, the recorded moves of that game from index I on (all of them
when `from` is absent), oldest first, each `{ step, at, action,
direction, undecided, food, died }` where `food` is the food's cell after
the move, present only when it changed, and `died` is true when the move
killed the snake. A page that already holds I moves asks for
`from=I` and appends, so following a game live costs one small read
every two seconds however long the game is. An unknown game is 404.

The operator records every move it applies, in the state file with the
rest of its state, and keeps every game since recording began.

The operator reads activity on its own timer, apart from the quotes: the
six books of the open step (approved and declined per action) every ten
seconds and the workspace leaderboard once a minute. That is about forty
public reads a minute on top of the step's own calls; it never walks a
book's history.
The operator account still never trades.

## The stream

The board rendered as a 1280 by 720 frame in-process and pushed to Twitch
as a continuous stream, from the fleet box. The channel is
https://www.twitch.tv/telarchy (account agents@telarchy.com; credentials
and the stream key in the keyring, `telarchy/twitch.env`). The stream is
a link on the board and the floor; it is not expected to find viewers on
its own.

The frame is the board's first screen and nothing more: the grid on the
left, filling the frame's height, and in the right column, top to
bottom, the next move with its clock, the three choice tiles, the status
line, the quiet line (newest trade, else commentary), and in small muted
type `Trade at telarchy.com/snake`. No traders, no trades list, no
leaderboard, no decisions, no counters and no rule text are drawn. The
same visual language as the board applies (accent for the leader and the
next move, green snake with a marked head, red food, near-black ground).

Text is set in Inter, bundled in the repo under `fonts/` with its OFL
licence and registered at render time; the frame never depends on a
system font. Every line is readable at 720p: nothing is drawn smaller
than the trade line.

## Operation

The service is one process: engine, operator loop, board, `/state`. It
persists its state (grid, step, counters, decision log) to a JSON file on
every step so a restart continues the game. Configuration by environment:
the Telarchy base URL, the operator API key, the workspace id, the port,
the state file path, the liquidity per book.

It runs first against the beta store for at least one full day, and the
site's query times under that load are recorded in the umbrella notes
before it moves to production. On production it is a systemd unit on the
fleet box.

## What must hold

- Exactly three proposals per minute while running, never more.
- A decision is made every minute before the deadline; the undecided
  path leaves nothing pending.
- A reading is posted after every step, timestamped at the step, and it
  is the record of the game, never the current length: a death leaves it
  where it was, a new game puts it back at 2.
- The operator never trades.
- The board never shows a price the workspace did not report.
