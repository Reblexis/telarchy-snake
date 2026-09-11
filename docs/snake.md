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
  A death ends an **attempt**: the attempt's reached length is now known,
  so every open book on the metric settles at it, right then (below).
  Deaths are counted and shown.
- A game ends when the snake fills the grid (length 144 on the first
  grid): it is **complete**, the attempt's reached length is the full grid
  and every open book settles at it, the operator posts no more proposals,
  keeps posting the full grid as the reading every minute, and the board
  shows the full snake and says so. After a **cooldown of one hour** the
  next game starts on the larger grid, at length 2, with the game number
  counted up. Until a game completes it runs without end.

## The workspace

One public Telarchy workspace named `Snake` (Telarchy derives the slug,
`snake`, from the name), owned by the snake operator account. One metric,
**Reached length**, the length the current attempt has reached: an
integer that starts at 2 with every attempt and, since a snake never
shrinks while it lives, is the snake's length until the attempt ends.
Its market range is 0 to the full grid (144 on the first
grid), so a book can price any length the snake can reach; when a new
game starts on a larger grid the operator raises the range to the new
full grid first. Telarchy refuses that while an open book on the metric
has trades, so the operator retries every minute until it goes through,
and the cooldown lasts that long. The operator posts a reading after
every step, so the metric's chart is the length minute by minute, back
to 2 at every death.

The metric is priced on **one book at a time, fixed for the attempt**.
When an attempt starts the operator sets the metric's only horizon to the
one-minute cell sixty minutes ahead (an absolute `YYYY-MM-DDTHH:MM` in
`customHorizons`, not a rolling `+60min`, so the cell does not move with
the clock) and refreshes the workspace's markets, which opens that cell's
baseline book. Every proposal of the attempt is priced on that same cell:
the question on the floor is "what length will this attempt have reached
at HH:MM", asked once, not a new question every minute. The book settles
on the last reading inside its minute if the attempt is still alive then,
or at the attempt's end (below), whichever comes first. When the cell's
minute has passed with the attempt alive, the next step sets the next
cell, sixty minutes ahead again, and the attempt carries on under it.
No other horizon and no calendar horizon is priced.

**When the attempt ends the answer is known.** Right after the move that
kills the snake (or fills the grid), before it posts the new attempt's
reading, the operator settles the metric
(`POST /api/metrics/:id/settle`, Telarchy's early settlement, see the
app's `docs/market-integrity.md`) at the length the attempt reached,
with the reason `Game G, attempt A ended at length L`. That settles every
open book on the metric at once, the attempt's baseline book and the
approved branches of its proposals alike, so a trader is paid the moment
the question is answered rather than an hour later on a number from the
next attempt. The next step sets the new attempt's cell and opens its
book. If the call fails the operator logs it and carries on; those books
then settle on the readings inside their own minute.

The operator forces the workspace's market refresh at every step, before
posting the three proposals, so the attempt's baseline book exists and
every proposal gets its pair. If setting the cell fails the step still
runs (the undecided path covers a missing pair) and the next step tries
again.

Liquidity: every pair book a proposal opens is funded by the workspace
owner through the metric's proposal credits on the 60-move horizon (1,000
credits a branch, so a five-credit trade is an opinion and a hundred-credit
one does not pin the book), never by the proposer; the operator posts
with no subsidy of its own. A step therefore puts 6,000 credits out and
gets 5,000 back within the minute (the two declined proposals and the
approved one's declined branch void and refund); the approved branch's
1,000 stays out until that book settles, at its minute or at the attempt's
end, so at most 61 steps' worth, 66,000 credits, is ever out at once. The
operator's float must stay above that or Telarchy refuses the proposals
(`Insufficient balance for forecast subsidy`); what traders win off the
approved books is the only thing that draws it down. The workspace's decision window is one minute,
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
description is the proposal in the snake's own first person, one line
per action (Viktor, 2026-09-11: it "is supposed to say something like
'I will move right at move X'"): "I will turn right at move 2 of attempt
55, game 1: from (9,6) heading right, that is down." Then the state a
trader prices on (length, record, food), the cell the proposal is priced
on (the length this attempt reaches by a clock minute, UTC), and the rule
in one clause (the highest impact at :58 is approved, the rest declined
with refund, ties continue forward). No board address: the game is on
the floor itself.

During the minute the operator re-reads the proposals' pairs every five
seconds and publishes them on `/state`, so the board and any bot see the
live prices and the current leader, not only the decision.

At second 58, two seconds before the deadline, the operator reads each
proposal's pair one last time and decides: a direction's score is its
predicted impact, the approved-branch price minus the declined-branch
price. Then:

- the proposal with the highest score is **approved**; its declined
  branch voids and its approved branch stays open to settle on the
  reached length, at its minute or when the attempt ends;
- the other two are **declined with refund**: both their branches void
  and every stake in them returns;
- ties go to the current heading, then to up, right, down, left in that
  order;
- if no price can be read, or the API fails, the snake continues in its
  current heading and the three proposals are declined with refund; the
  step is logged as undecided, and the record says why
  (`undecidedReason` on the decision, shown on `/state`): which action
  had no price and what was missing (no pair on the cell, no consensus,
  no answer from Telarchy), or the error the approval returned.

No call to Telarchy waits without limit. The app can stall for minutes
at a time, and a loop stuck in one read past the deadline is how a step
whose proposals were posted on time still lapses undecided (Telarchy
lapses an undecided proposal at its deadline, `lapsed`, and refuses the
approval after that). So: a poll read is abandoned after ten seconds and
counts as unreadable for that poll; no poll starts in the last ten
seconds before the decision, so a slow poll can delay nothing past :58;
the decision's own read is abandoned after two seconds, and the decision
then falls on the prices last polled during the minute; the decision
calls, the settlement, the reading and the proposals wait at most twenty
seconds each. A call that takes longer than five seconds is logged with
its path and duration.

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
   glow around the head), the food as a rounded red dot, and the next
   direction as an arrow: a short chevron in the accent colour drawn from
   the head into the cell the snake moves to next (`next.direction`; the
   heading itself while `next` is absent, forward being the default),
   faint while the step is open and solid once `next.decided`; when that
   cell is off the grid the chevron is pressed against the head's edge
   pointing out, so a wall crash is visible before the move. The replay
   draws the same chevron for the replayed move's direction, solid. The
   cell size follows `grid` on `/state`, so a larger game draws smaller
   cells. Source: `game`, `grid`, `next`.
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

The service's data is three public JSON endpoints, `/state`, `/games`
and `/history`, each answered with `access-control-allow-origin: *` and
`cache-control: no-store`, so any page (telarchy.com's floor first) can
read them from the browser and never sees a stale copy. `/state` is the
present, `/games` and `/history` are the record; together they are what
a page needs to show the game live and replay any of it.

`/state` is the whole of the board's data and a bot's feed: the game
state, the workspace and metric ids, the open step with its three
proposals, and for each action the approved and declined market ids and
their live prices, the cell key, the decide instant and the next step
instant, the decision rule in words, recent decisions (each with its
`undecidedReason`, null when the step was decided) and counters. A
bot needs one read of `/state` per step to know what to trade.

The activity fields on `/state`, all read from Telarchy's public
workspace endpoints, never from the operator's own books:

- `next`: `{ action, direction, decided, seconds }`, the next move as
  defined above.
- `commentary`: the one-line commentary.
- `bestLength`: the longest the snake has been in this game.
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

`GET /games` lists every recorded game, oldest first, the running game
last: `{ "games": [ { "number": 1, "size": 12, "startedAt": ISO,
"endedAt": ISO|null, "steps": N, "bestLength": n, "deaths": n } ] }`.
`steps` is the number of moves made in the game (the `step` of `/state`),
`endedAt` is null until the game completes, `bestLength` the record and
`deaths` the count so far. A game whose log began mid-game (below)
carries `"partial": true`; the others carry no `partial` field.

`GET /history?game=N&from=S&limit=L` returns one game's steps:
`{ "game": { "number", "size", "startedAt", "endedAt" }, "total", "from",
"steps": [ ... ] }`. `game` is a number or `current`, the newest recorded
game (absent means `current`). Each step is the state **after** the move
of that step: `{ "step", "at", "snake": [{x,y}...] (head first), "food":
{x,y}, "heading", "action": "forward"|"left"|"right", "direction",
"undecided", "impact": { "forward": n|null, "left": n|null, "right":
n|null }, "length", "deaths" }`, where `action` is the action the market
approved (`forward` with `undecided: true` when the step was undecided),
`direction` the compass direction moved, `impact` the 60-move impact of
each action as read at the decision (approved minus declined, null when
unreadable), and a death shows as the state after it: length 2, `deaths`
counted up. Step 0 is the starting position, recorded when the game
starts; it has no move, so its `action` is `null`, its `direction` the
starting heading and its `impact` all null. `total` is the number of
entries recorded for the game, `from` the index of the first entry
returned (0-based within the recording; for a game recorded from its
start the index is the step number) and `steps` runs from it in order.
`from` defaults to `max(0, total - limit)`, the newest window; `limit`
defaults to 300, is at least 1 and is capped at 2000. So `/history?game=current` is the
last 300 moves and `/history?game=current&from=0&limit=2000` the first
2000. An unknown game is 404 with `{ "error": "no such game" }`.

The record is kept on disk, not in memory: one JSON line per step
appended to `state/games/<number>.jsonl` (the starting position first,
then every move the operator applies, right after it applies it), and
`state/games/index.json` with the games list, rewritten whole after each
step. A crash mid-write loses at most the last line: a torn last line is
skipped by the reader and closed off at the next start so the next line
is whole. A history page is served by streaming the game's file and
keeping only the requested window, never by loading the whole file: a
game can run to tens of thousands of lines and the process's memory does
not follow it. The log starts when this version of the service first
runs: a game already under way is recorded from that moment on, its
first entry the state as it stands at step `game.step`, and the game is
marked `partial` in the index because its earlier steps are not
available. A game that starts later, on a fresh process or after the
cooldown, is recorded from step 0 and its file and index entry are
created at that instant.

The Replay tab's `/replay` is the same record in the board's own shape
(the start frame and the moves, replayed on the page), kept in the state
file; `/history` is the frame-by-frame shape a page draws without
replaying anything.

The operator reads activity on its own timer, apart from the quotes: the
six books of the open step (approved and declined per action) every ten
seconds and the workspace leaderboard once a minute. That is about forty
public reads a minute on top of the step's own calls; it never walks a
book's history.
The operator account still never trades.

## The stream

The board rendered as a 1280 by 720 frame in-process and pushed to Twitch
as a continuous stream, from the snake's own server. The channel is
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
next move, green snake with a marked head, red food, near-black ground),
including the next-direction chevron on the grid: in the accent, in the
cell ahead of the head in `next.direction`, faint while open and solid
once decided, pressed against the head's edge when that cell is a wall.

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

The snake runs on a server of its own (Hetzner `telarchy-snake`,
167.233.147.90, 2 vCPU, 4 GB, user `telarchy`): nothing else runs there, so
a decision always falls inside its minute. It shared the fleet box first
and was starved by that box's benches (load above 100 on two cores, steps
lapsing, the site's proxy answering 502 for the feed), which is why it
moved. The operator and the stream are the two `systemd --user` units of
`deploy/`, installed by `deploy/install.sh`; Caddy on the same server
serves the board on `snake.telarchy.com` (an A record pointing at the
server) and on the server's nip.io name, `deploy/Caddyfile.snake`. The
site reaches the feed through the workspace's `liveFeed` url, which names
whichever of the two hosts resolves.

It ran first against the beta store for a full day, and the site's query
times under that load are recorded in the umbrella notes, before it moved
to production.

## What must hold

- Exactly three proposals per minute while running, never more.
- A decision is made every minute before the deadline; the undecided
  path leaves nothing pending.
- A reading is posted after every step, timestamped at the step, and it
  is the snake's length: 2 again after a death or a new game.
- The move that ends an attempt settles the metric at the length the
  attempt reached, before the new attempt's reading is posted, and never
  otherwise.
- One cell per attempt: the metric's horizon is set when an attempt
  starts and when its cell's minute has passed, never in between; every
  proposal of a step is priced on the current cell.
- The operator never trades.
- The board never shows a price the workspace did not report.
