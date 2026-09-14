# Futarchy snake

A snake game steered by a Telarchy workspace. Every minute the market
decides the snake's next move: one proposal is posted with three options,
continue forward, turn left and turn right, each option priced by its own
conditional market on the snake's length, and the option the market
expects to leave the snake longest is chosen. The game runs around the clock and a board
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

- The first game is on a grid 4 by 4; each later game is two cells wider
  and taller than the last (6 by 6, then 8 by 8, and so on). Two, not one,
  so every grid keeps an even number of cells: a grid graph has a
  Hamiltonian cycle exactly when its cells are even in number, and a
  player following one eats every food and fills the board, so finishing
  is always possible in principle. An odd-sided grid has no such cycle and
  no strategy could guarantee filling it. `tests/fillable.test.ts` is the
  proof: it builds the cycle and fills each of the first four grids with
  the real engine.
  The snake starts at the centre with length 2, heading right, one food
  on a free cell. Classic rules: the snake moves one cell
  per step in its heading, eating food grows it by one and spawns new food
  on a random free cell, hitting a wall or its own body kills it.
- One step per minute, at the top of each UTC minute. The step's action
  is the chosen option of the step's proposal (below): **turn left** and **turn
  right** are relative to the snake's heading (a snake heading up that
  turns left moves left), **continue forward** keeps the heading. A snake
  cannot reverse, so no action runs it into its own neck.
- On death the snake respawns at once at length 2 in the starting state.
  A death ends an **attempt**: the attempt's reached length is now known,
  so every open book on the metric settles at it, right then (below).
  Deaths are counted and shown.
- A game ends when the snake fills the grid (length 16 on the first
  grid): it is **complete**, the attempt's reached length is the full grid
  and every open book settles at it, the operator posts no more proposals,
  keeps posting the full grid as the reading every minute, and the board
  shows the full snake and says so. After a **cooldown of five minutes** the
  next game starts on the larger grid, at length 2, with the game number
  counted up. Until a game completes it runs without end. **The cooldown is
what the loop does between games**, the way a step is what it does during
one: a complete game has no open step, so the minute belongs to the
cooldown and the loop never asks for a step the operator would refuse.

## The workspace

One public Telarchy workspace named `Snake` (Telarchy derives the slug,
`snake`, from the name), owned by the snake operator account. One metric,
**Reached length**, the length the current attempt has reached: an
integer that starts at 2 with every attempt and, since a snake never
shrinks while it lives, is the snake's length until the attempt ends.
Its market range is 0 to the full grid (16 on the first grid), so a book can price any length the snake can reach; when a new
game starts on a larger grid the operator raises the range to the new
full grid first. **The metric's description names the grid being played**
and the length that fills it, and the operator rewrites it whenever a game
starts, so the sentence a trader reads is never the grid before this one;
a refusal there costs a stale sentence, never the new game. Telarchy refuses that while an open book on the metric
has trades, so the operator retries every minute until it goes through,
and the cooldown lasts that long. The operator posts a reading after
every step, so the metric's chart is the length minute by minute, back
to 2 at every death.

The metric is priced on **one book per attempt, with no clock**. The
metric's only horizon is Telarchy's `until-settled` date (the app's
`docs/guides/time-preference.md`, "A date that settles when you settle
it"), titled `this attempt` in `horizonTitles`, so the question on the
floor is "what length will this attempt reach", asked once per attempt,
with one answer per option, and answered only when the attempt ends: the
book never settles at a clock minute, so it trades for the whole attempt
however long the snake lives, and the market's chart of it spans the
attempt. The operator writes that horizon at its first step and whenever
the metric does not carry it (a refusal is retried at the next step), never
per attempt and never on the clock, and refreshes the workspace's markets
at every step, which opens the attempt's baseline book. No other horizon and
no calendar horizon is priced.

**When the attempt ends the answer is known.** Right after the move that
kills the snake (or fills the grid), before it posts the new attempt's
reading, the operator settles the metric
(`POST /api/metrics/:id/settle`, Telarchy's early settlement, see the
app's `docs/market-integrity.md`) at the length the attempt reached,
with the reason `Game G, attempt A ended at length L`. That settles every
open book on the metric at once, the attempt's baseline book and the
chosen options of its proposals alike, so a trader is paid the moment
the question is answered rather than an hour later on a number from the
next attempt. Telarchy opens the new attempt's book at the next step's
refresh, after the new attempt's reading, so it opens at length 2. If the
call fails the operator logs it, counts it in `settleFailures` and carries
on, never retrying it (a late retry would settle the next attempt's books
at the last attempt's length); those books then stay open and the next
attempt is priced on them until the next settlement.

The operator forces the workspace's market refresh at every step, before
posting the proposal, so the attempt's baseline book exists and the
proposal gets its three option books. If writing the horizon fails the
step still runs (the undecided path covers a missing book) and the next
step tries again.

**The floor is closed to outside proposals.** The workspace setting
`externalProposalsDisabled` is true (set 2026-09-14): only the operator,
which holds manage on its floor, posts proposals, and anyone else's
`POST /api/proposals` is refused with 403 `external_proposals_disabled`.
Trading is open to everyone as before. The floor draws no propose
control for a visitor.

Liquidity: every option book a proposal opens is funded by the workspace
owner through the metric's proposal credits on the attempt's date (1,000
credits an option, so a five-credit trade is an opinion and a
hundred-credit one does not pin the book), never by the proposer; the
operator posts with no subsidy of its own. A step opens three books, one
per option, so it puts 3,000 credits out and gets 2,000 back within the
minute (the two options not chosen void and refund); the chosen option's
1,000 stays out until the attempt ends, so an attempt N moves long has
N thousand credits out by its last move, plus the open step's three. The
operator's float must stay above the longest attempt's or Telarchy refuses
the proposal (`Insufficient balance for forecast subsidy`); what traders
win off the chosen books is the only thing that draws it down. The attempt's main book, the one book on its date that is
not an option (the price every option book opens from), opens with 3,000
credits, always: the operator writes 3,000 for the book whenever it
writes the horizon, whatever the metric carried before, so a main book that sits below
the snake's length is worth correcting. The workspace's decision window is one minute,
the minimum. The workspace has no charter, so a decline needs no reason.

The workspace is **muted**: `notificationsMuted` is on, so nothing it does
reaches anyone by email, push or the bell, owner included. A proposal and a
decision a minute would otherwise mail the owner and the proposer
thousands of times a day. It stays muted until Viktor says
otherwise.

## The step

At second 0 of each minute the operator posts one proposal titled
`Game G, attempt A, move N`, where G is the game number, A the current
attempt (the deaths so far in this game plus one: the snake's first life
is attempt 1, and every respawn starts the next) and N the move the
proposal decides counted within that attempt (the first move after a
start or a respawn is move 1), so a proposal names its place in the game
wherever Telarchy lists it. The proposal carries three **options**, in
this fixed order and with these ids: `forward` "Continue forward",
`left` "Turn left", `right` "Turn right" (Telarchy's proposals with
options, its `docs/guides/proposals.md`, "More than two options"). The
action is the option's id, exactly one of the three. Telarchy opens one
conditional market per option on the attempt's book, so the three books
close together at the proposal's one deadline, the top of the next
minute, and the deadline a trader sees is the real one. The description
is the proposal in the snake's own first person, one line per option
(record: the telarchy umbrella's `notes/futarchy-snake-proposal-38.md`):
"I will turn right at move 2 of attempt 55, game 1: from (9,6) heading
right, that is down." Then the state a trader prices on (length, record,
food), what the proposal is priced on (the length this attempt reaches,
settled when it ends), and the rule in one clause (the option
with the highest price at :58 is chosen, the others void with refund,
ties continue forward). No board address: the game is on the floor
itself.

During the minute the operator re-reads the proposal every five seconds
and publishes each option's price and lead on `/state`, so the board and
any bot see the live prices and the current leader, not only the
decision.

At second 58, two seconds before the deadline, the operator reads the
proposal one last time and decides: an option's score is its **price**,
the consensus of its own book (the length the market expects this
attempt to reach if the snake takes that option). Then:

- the option with the highest price is **chosen**: the operator approves
  the proposal naming that option (`POST /api/proposals/:id/approve
  { option }`); its book stays open to settle on the reached length when
  the attempt ends, and Telarchy voids the other two
  options' books and refunds every stake in them;
- ties (prices within a billionth of each other) go to the current
  heading, then to the option whose direction comes first in up, right,
  down, left;
- **if the market did not price the step, the snake pauses.** When
  Telarchy answered but no option has a price (no book on the cell, no
  options on the proposal, no consensus), when the decision's read gets no
  answer and nothing was read during the minute, or when the approval
  fails, the market did not decide and neither does the operator: the
  proposal is **declined with refund**
  (`POST /api/proposals/:id/decline { refund: true }`), which voids all
  three books; the step is logged undecided and `held`, the record says
  why (`undecidedReason` on the decision, shown on `/state`: which option
  had no price and what was missing (no book on the attempt's date, no
  options on the proposal, no consensus, no answer from Telarchy), or the
  error the approval returned); the snake does not move that minute, and
  the next minute posts the same move again. A reading is still posted.
  Nothing stays pending past the deadline. The snake never walks on
  without a market behind the step (owner decision 2026-09-16, the
  telarchy umbrella's `notes/snake-through-publishes-2026-09-16.md`: the
  games pause when they cannot reach the server or trades are not working).
- **the snake moves only on a step it posted.** A minute whose proposal
  could not be posted (the operator could not reach Telarchy) leaves the
  snake where it is; the next minute tries to post the move again. Before
  this, a failed post left the previous, already-applied decision on the
  loop, which moved the snake straight on with no proposal behind it.

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

The chosen action is applied at the next top of minute. So the board
shows: the proposal for step N open during minute N, decision at N:58,
move at N+1:00, and the next proposal posted the same second.

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
   current leader, the option with the highest live price (forward when
   no price is readable, per the rule), in the accent colour; once decided the clock goes and the line reads as decided,
   in the snake's green, held until the move at the top of the minute.
   While `paused` is set the line reads `Paused` with the reason in the
   clock's place, in the muted colour, until the market prices a step
   again. Source: `next` and `paused` on `/state` (`action`,
   `direction`, `decided`, `seconds`).
3. **Three choice tiles**, Continue, Left, Right, each showing only its
   compass arrow, its name, its live price (`7.4`, the length the market
   expects if the snake takes it) as a large tabular number, and on the
   leader alone its lead over the best other option (`+1.4`); the leader
   in the accent colour. Each tile links to the step's proposal on
   telarchy.com. Source: `open.quotes`, `open.directions`,
   `open.proposal`.
4. **One status line**, four facts and no more: `Length 7 · Record 9 ·
   Game 1 · 4x4`. Source: `game.length`, `bestLength`, `gameNumber`,
   `grid`.
5. **One quiet line** at the bottom: the newest trade (`philipp-gl bet
   5 on Turn left`), or, when there is none, the commentary. Never both.
   Source: `recentTrades[0]`, else `commentary`.

Everything else lives below the fold in one collapsed **More** section
(a `details` element, closed by default) that holds, in this order: the
price and lead per option, the current traders (with the
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
chose for it (`undecided` when the step was), the resulting compass
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

The service's data is four public JSON endpoints, `/state`, `/replay`,
`/games` and `/history`, each answered with
`access-control-allow-origin: *` and `cache-control: no-store`, so any
page (telarchy.com's floor first) can read them from the browser and
never sees a stale copy. `/state` is the present, the rest are the
record; together they are what a page needs to show the game live and
replay any of it.

**Every answer is JSON, and the surface says no in JSON too.** A path the
service does not serve answers `404 { "error": "not found" }` with the
same headers, never plain text, so a cross-origin bot reads a 404 rather
than an opaque failure. Any method other than `GET` or `HEAD` answers
`405 { "error": "method not allowed" }` with `allow: GET, HEAD, OPTIONS`;
an `OPTIONS` request answers `204` with the allow headers, so a
preflighted request works. The data endpoints are capped **per reader**
(600 reads a minute, `429 { "error": "too many requests" }` with
`retry-after`), because the HTTP server shares its event loop with the
decision at `:58` and no one reader may push that late.

**The reader is the client, not the proxy.** Every public read arrives
from Caddy on this same host, so the socket address is the proxy's for all
of them; the reader is the first entry of `x-forwarded-for`, believed only
when the socket is loopback, since otherwise anyone could lift their own
limit by claiming to be a proxy. A loopback socket with no forwarded
header is the host's own stream, polling once a second forever, and is not
counted at all. The cap is set to stop one client hammering and never to
ration ordinary reading: a single board tab polls its state and its replay
every two seconds, so a minute of one open tab is around 120 reads.


**The feed never blanks between steps.** The step the operator has just
ruled on stays on `/state` until the next step's proposal is posted, so
a watcher never sees the board without a step for the seconds that post
takes. The ruled step keeps its one `open.proposal` and its `open.quotes`
as they stood at the ruling until the next step replaces both. `phase`
says which moment it is: `open` while the step is trading,
`decided` from its ruling until the next step replaces it, `idle` only
when there is no step at all (a complete game's cooldown).

**`paused` says when the market is not moving the snake.** It is null
while the game is being played, and `{ since, reason, held }` once a step
was held: `since` the instant of the first held ruling in the run,
`reason` that ruling's `undecidedReason` in words a visitor reads
("Telarchy unreachable", "forward: no book on the cell"), `held` the
number of consecutive held steps. It clears on the first step the market
prices and the snake moves on. A visitor or a bot reads it as "the snake
is standing still because the market cannot price it", never as a
decision of the operator.

`/state` is the whole of the board's data and a bot's feed: the game
state, the workspace and metric ids, the open step with its one proposal
(`open.proposal: { id, number, url }`), and for each action its option's
market id and live price and lead (`open.quotes: { forward | left |
right: { m60: { price, lead, marketId, reason? } } }`, where `price` is
the option book's consensus, `lead` the price minus the best other
option's price, positive for the leader and negative for the rest, both
null while unpriced, and `reason` says what is missing when `price` is
null), the date key, the decide instant and the next step instant, the
decision rule in words, recent decisions (each with the chosen option,
every option's price at the close in `prices`, and its `undecidedReason`,
null when the step was decided) and counters. A bot needs one read of
`/state` per step to know what to trade.

**What a bot trades on is never dropped.** An option's `marketId` is
published from the moment the proposal is posted and kept for the life of
the step: a price poll that fails leaves the last price and the id
standing rather than blanking them. Before the first poll of a step the
prices are null and each quote carries `reason: "not polled yet"`, which
is what distinguishes "no price yet" from "this option has no book".
`quotesAt` says when the prices were last read, so a bot can tell a fresh
price from one held through a failed poll or through the last ten seconds
before the ruling, when polling stops.

**`open.tradeable`** is true only while the step is open and its deadline
is still ahead. The feed deliberately keeps a ruled step on screen until
the next one is posted, and a restart can restore a step whose deadline
has passed; `tradeable` is how a bot tells a step it can still bet on
from one that is only being shown. A restored step whose deadline has
already passed is dropped rather than served.

**The instants are instants.** `cell` is the key of the date the attempt
is priced on, `until-settled`, and `cellEndsAt` is null, because that date
has no clock: nothing on the feed names a moment the book settles at, and a
bot learns the settlement from the metric's `market:resolved` event or from
the attempt ending. `attempt` is the attempt number the
step belongs to, as a number, beside `game.attemptStep`.

**The rule in machine form.** `rule` stays the sentence a person reads;
`rules` carries the same thing for a program:
`{ "decideSecond": 58, "moveSecond": 0, "horizon": "until-settled",
"tieBreak": ["forward", "left", "right"], "voidRefund": true,
"settlesEarlyOnDeath": true }`.

**Where to trade it.** `trade` names the platform, not just the market
ids: `{ "base": "https://telarchy.com/api", "endpoint":
"POST /api/predictions/trade", "auth": "X-Agent-Key", "workspaceHeader":
"X-Workspace-Id", "workspaceId": "<id>", "rangeMin": 0, "rangeMax": <the
full grid> }`, so one read of `/state` tells a bot what is open, what it
is worth and how to bet on it.

**`schema`** is the feed's version, an integer, raised whenever a field
changes meaning or leaves. A bot that reads a `schema` it does not know
should keep reading the fields it recognises and say so, not guess. It is
3: `rules.horizonMinutes` left for `rules.horizon`, and `cell` and
`cellEndsAt` now name the attempt's clockless date (above).

The activity fields on `/state`, all read from Telarchy's public
workspace endpoints, never from the operator's own books:

- `next`: `{ action, direction, decided, seconds }`, the next move as
  defined above.
- `paused`: null, or `{ since, reason, held }` while the market is not
  moving the snake (above, "The feed never blanks between steps").
- `commentary`: the one-line commentary.
- `bestLength`: the longest the snake has been in this game.
- `traders`: the positions in the open step's three books, each
  `{ handle, action, horizon, side, shares, cost, worth }`;
  `tradersThisStep` the number of distinct handles in it; `tradersToday`
  the number of distinct handles seen trading or holding a position in any
  snake book since midnight UTC (a counter that survives a restart).
- `recentTrades`: the last 30 trades across the snake's books, newest
  first, each `{ id, at, handle, step, action, horizon, side, kind,
  shares, cost, marketId, price }` where `price` is the book's consensus
  when the trade was first seen, or null.
- `leaderboard`: the top five `{ rank, handle, profit, trades }` of this
  workspace, or an empty list when Telarchy reports nobody.
- `attemptStartedAt`: when the current attempt began, the minute of the
  move that ended the previous attempt, or the game's start for its first
  attempt; null when neither is known. A start derived from the recorded
  moves never reaches back past the start of the current game.
- `levels`: the games as the games list records them, oldest first, at
  most the newest ten, each `{ number, size, startedAt, endedAt }`
  (`endedAt` null while the game runs).
- `restingOrders`: the limit orders still resting on the open step's
  books, newest first, at most ten, each `{ id, at, handle, action,
  horizon, side, level, credits, marketId }` where `level` is the order's
  limit in the metric's units and `credits` its budget. They are read with
  the activity from Telarchy's public actions log (`GET
  /api/data-room/actions?workspace=<slug>&kinds=order&limit=50`): an order
  rests when its `placed` row is there and no later row closed it. A
  failed read keeps the last list; a new step starts it empty. Adding
  fields does not raise `schema`; only a field that changes meaning or
  leaves does.
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
"undecided", "prices": { "forward": n|null, "left": n|null, "right":
n|null }, "length", "deaths" }`, where `action` is the option the market
chose (`forward` with `undecided: true` when the step was undecided),
`direction` the compass direction moved, `prices` the price of each
option as read at the decision (null when unreadable), and a death shows
as the state after it: length 2, `deaths` counted up. Step 0 is the
starting position, recorded when the game starts; it has no move, so its
`action` is `null`, its `direction` the starting heading and its `prices`
all null. `total` is the number of
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
three books of the open step (one per option) every ten seconds and the
workspace leaderboard once a minute. That is about twenty public reads a
minute on top of the step's own calls; it never walks a book's history.
The operator account still never trades.

## The stream

The board rendered as a 1280 by 720 frame in-process and pushed to Twitch
as a continuous stream, from the snake's own server. The channel is
https://www.twitch.tv/telarchy (account agents@telarchy.com; credentials
and the stream key in the keyring, `telarchy/twitch.env`). The stream is
a link on the board and the floor; it is not expected to find viewers on
its own.

**The channel takes one stream.** While another game streams on it
(telarchy-chess `docs/chess.md`, "The stream"), this unit is disabled
(`systemctl --user disable --now telarchy-snake-stream.service`). A disabled
stream is off on purpose: nothing starts it again until it is enabled.

**The stream never dies of one bad read.** A poll whose payload carries no
game is not drawn: the last good frame stays on screen and the read is
logged. A frame that throws is skipped, not fatal. A stream that exits
takes a restart delay and comes back into the same payload, so a held frame
is the only behaviour that recovers on its own. It holds a bounded amount of
memory however long it runs.

**The frame is Telarchy's floor in its dark theme**, so a viewer who opens
the link lands on a page that looks like what they watched. The ground is
`#101013`. The grid fills the frame's height on the left: the board's
ground `#17171c` with a 1px `#2a2a32` border and hairline cells, the snake
one green (`#4ade80`) band through the cell centres at 0.78 of a cell with
round joins, the head a circle of the same green with two eyes in the
board's ground on the side it moves towards, the food a red (`#f87171`)
dot, and the next direction a chevron in the accent (`#f59e0b`) in the cell
ahead of the head, at 0.7 opacity while the step is open and solid once
decided, a bar along the wall when that cell is a wall. Nothing is drawn
outside the board.

The right column (from x 736, 520 px wide) holds, top to bottom:

1. the Telarchy lockup, small (18 px tall, its own aspect ratio, never
   stretched);
2. "Snake" in Fraunces 700 and the question "What length will I reach on
   this attempt?" in Fraunces 500, muted;
3. three cells between hairlines, each a small mono uppercase label over a
   large mono number: `NOW · ATTEMPT N` over the length, `THIS ATTEMPT`
   over the time since the attempt started (`attemptStartedAt`, `-` when
   unknown), and `NEXT MOVE <arrow>` over the countdown in the accent
   ("decided" in green once the move is ruled);
   under them one mono line for the levels: `LEVEL 6X6` and the time the
   current game has run (stopped at its end once it completes), then each
   earlier game newest first as its grid and how long it took (`4x4 3h
   22m`), as many as fit the column. Every timer here uses one clock:
   `mm:ss` under an hour, then `3h 22m`, and ticks every second. The timers
   are the stream's alone; telarchy.com does not draw them;
4. the three options as pills, each its label and its price to one
   decimal; the leader outlined and lettered in green, the others in a
   quiet outline. A price of 0 draws `0.0`, because it is a real price (a
   move that ends the attempt); only an option with no price draws `-`;
5. one panel that turns every 15 seconds between two pages, with two
   small dots saying which page is on: **Log**, the newest activity first,
   up to five rows, the limit orders resting on the open step's books
   before the trades (`12s  vi0  bought higher on Continue at 30.0
   259 cr`; an order row reads `limit higher on Continue at 0.05` and its
   credits are in the accent), from `restingOrders` and `recentTrades` on
   `/state`; and **Top traders**, the five rows of `leaderboard` (rank,
   handle, profit in credits, green when positive). A page with nothing to
   show gives its turn to the other;
6. at the foot, the link alone: `telarchy.com/snake` in a bone (`#f2ecdc`)
   pill button, Inter 600, the widest thing in the column. No other words
   invite the viewer anywhere.

A complete game draws "The snake filled the grid." and the next grid in
place of the pills. Text is set in Inter, Fraunces and JetBrains Mono,
bundled in the repo under `fonts/` with their OFL licences and registered
at render time, and the logo is bundled under `assets/`; the frame never
depends on a system font or a network read. Every line is readable at
720p.

## The level videos

One video per complete game (a **level**), for the Telarchy YouTube
channel (account agents@telarchy.com, the login in the keyring,
`telarchy/google-agents.env`). It is marketing: a level took the market
hours or days, and the video shows the whole of it in minutes, every move
with the prices and the trades that chose it.

**Made by one command, from public reads only.** `npm run video -- <game>`
(`node dist/video.js <game>`) reads the snake's own feed (`SNAKE_FEED_URL`,
default `https://snake.telarchy.com`): `/games` for the game's row and
`/history` paged from index 0 with the largest window until `total` entries
are read; and Telarchy's public actions log
(`GET /api/data-room/actions?workspace=snake&kinds=trade&after=<startedAt>&before=<endedAt>`,
following `next` until it is null). It needs no credential and can run on
any machine with ffmpeg. It writes `videos/snake-level-<game>.mp4` and
`videos/snake-level-<game>.json` in the working directory. A game that is
not complete, or whose log is `partial`, is refused with a message and a
non-zero exit, and nothing is written: a level video shows a whole level
or does not exist.

**Every frame is the stream frame** ("The stream"), drawn from the record
instead of `/state`:

- the board is the entry's snake, food and heading, and the chevron is the
  direction of the next entry's move, solid (every recorded move was
  decided or ruled undecided); the last entry draws no chevron;
- `NOW · ATTEMPT N` is the entry's length and attempt (`deaths + 1`);
  `THIS ATTEMPT` is the time from the attempt's first entry to this one's
  `at`; the next-move cell reads `decided`, or `undecided` in muted mono for
  an undecided move; no countdown is drawn;
- the level line is the game's grid and the time from `startedAt` to the
  entry's `at`, then the earlier complete games from `/games` as the stream
  draws them;
- the pills are the next move's options with the prices recorded at its
  decision (`prices` of the next entry); the chosen option is the one
  outlined in green, whatever the prices say, and an undecided move
  outlines none;
- the panel is one page, labelled `TRADES ON THIS MOVE`, with no dots and no
  Top traders page (the leaderboard is not recorded): the trades whose
  `at` falls after this entry's `at` and at or before the next entry's,
  newest first, at most five, each row as the stream's log row with its age
  counted back from the next entry's `at`. A trade row names its option
  only when its book's last trade on that move left a call equal (to one
  decimal) to exactly one option's recorded price; otherwise the row names
  no option (`bought higher at 2.3`). A move nobody traded shows one muted
  line, `No trades on this move`;
- the link is the stream's link.

The last frame is the full grid: the complete game's line, "The snake
filled the grid.", in place of the pills, and a second line with the level's
facts, `<moves> moves · <deaths> deaths · <trades> trades · <span>`. No move
follows it, so it draws no trades panel.

**Encoding.** 24 frames a second, H.264, yuv420p, AAC audio, `+faststart`.
A render holds a bounded amount of memory however long the level, so it fits
beside everything else on the machine.
How long each entry is held is each cut's pace ("The fun cuts").

**The sidecar** `snake-level-<game>.json` is `{ game, size, title,
description, moves, deaths, trades, traders, startedAt, endedAt,
durationSeconds }`, where `traders` counts distinct handles in the level's
trades and `durationSeconds` is the video's. The title is
`Futarchy snake, level <game> (<size>x<size>): a market chose every move`.
The description is, line by line:

```
A prediction market played this game of snake. Every minute three options (continue, turn left, turn right) were priced by traders on telarchy.com, and the highest price was the move.
Level <game> on a <size>x<size> grid: <moves> moves over <span>, <deaths> deaths, <trades> trades by <traders> traders.
Trade the next move: https://telarchy.com/snake
Watch it live: https://www.twitch.tv/telarchy
```

### The fun cuts

A level video is made to be watched for fun, with music, in two cuts from
the same record: the **full cut** (1280 by 720, the frame above) and the
**Short** (1080 by 1920, at most 59 seconds). `npm run video -- <game>
[--music <audio file>] [--credit "<line>"]` writes both,
`videos/snake-level-<game>.mp4` and `videos/snake-level-<game>-short.mp4`,
each with its sidecar.

**Both cuts open on the game, not a title card.** The first frame is the board
with the snake already moving, and `A market picks every move.` sits in one line
across the top of the board for the first two and a half seconds while the first
moves play under it. There is no logo sting and no static hold. (Measured on
snake-game videos: an intro chapter goes with a third of the views per
subscriber; record in the telarchy umbrella's `notes/youtube-channel-proposal-44.md`.)

**A viewer sees that a market is playing.** The frame says it in words: in
the full cut the question line reads `Traders bet on every move. The highest
price wins.`, and in the Short the first bet beat of the winning attempt carries
that sentence as `Traders bet. The highest price wins.` across the top of the
board, at the moment the chips pop. And the market is on the board,
where the eye is: while a move is being decided, each cell the snake could
move into carries a **tag** with that option's price as recorded at the
decision, so the choices and their prices sit in front of the snake's head.
An option that runs into the wall has no tag, since there is no cell to put it
on; the pills still list it with its price.
The chosen option's tag is green, the others quiet. An option with no
recorded price has no tag. **Tags never collide and never cover the head**:
tags that would overlap are moved apart, no tag covers the centre of the head's
cell, and every tag stays inside the board. The tags replace the
next-move chevron, which the fun cuts do not draw.

**Trades land before the snake moves.** A move with trades, shown at normal
pace, first plays its **bet beat** on the position before the move: its
trades in the order they were made, at most three, each popping a chip above
its option's tag (`+<credits> cr` over the trader's handle) with a coin sound
while the tag's price counts from the trade's call before to its call after.
A trade whose option is not named pops its chip above the snake's head. A chip
is solid and large (in the Short at least 52 px), stays fully visible for half a
second before it fades, and stays inside the board. More
than three trades add `+N more` after the third. Each shown trade takes a
third of a second, then the chosen tag flashes for a quarter second and the
snake moves. Sped-up stretches play no beat; their tags stand still.

**A death is seen as a crash.** A move that kills the snake is drawn from the
position before it: the head lunges toward the wall or the body it hits, a
red burst marks the spot (inside the board, however close the wall), the board
flashes red and shakes, a low buzz plays,
and the death counter counts it. The respawn follows. On a move that eats,
the head pops and a `+1` rises from the eaten cell, with a short rising blip.
When the grid fills, confetti bursts over the board, `FILLED` is drawn large,
and a fanfare plays. The sound effects are synthesized by the renderer, so
the video owns every sound in it except the music.

**The music** is the file given with `--music`: a royalty-free track whose
license allows it in YouTube videos without a Content ID claim (the
`level-video` skill picks it and keeps its license beside the video). It is
looped to the cut's length when shorter, faded in over the first second and
out over the last two, and mixed under the effects at a quarter of its level. The
effects are kept moderate: each peaks at about 40 percent of full scale, so a blip
or a coin is heard over the music without jumping out. The
finished mix is normalized to YouTube's loudness, -14 LUFS integrated with the
true peak at -1.5 dBTP, with a limiter after it set low enough that the finished
file's peak stays under 0 dBFS once the audio is encoded, so every video plays at the same level whatever the
track. Without `--music` the cuts carry the sound effects alone and the
command says so. `--credit "<line>"` gives the track's credit, and each
sidecar's description then ends with that line; a track whose license asks
for attribution is never used without it.

**A sound effect never stutters.** In a sped-up stretch many moves eat or
die close together; a sound plays only when the last sound of the same kind
started at least a fifth of a second earlier.

**The full cut runs five minutes at most, and the boring parts go fast.** Every
move gets an **interest score** from what happened on it:

- the move that fills the grid, and the crash that ends a record attempt (one that
  reached a length above every earlier attempt), are always kept;
- a move that eats scores 3;
- the credits traded on the move score log2(1 + credits), so a 1-credit trade adds
  1, 100 credits about 6.7, 1,000 credits about 10;
- options whose recorded prices are 5 or more apart (the market disagreed) score 2;
- a move of a record or filling attempt scores 2, and a move of the winning attempt
  2 more.

The cut keeps the highest-scoring moves at four moves a second, each traded one
with its bet beat, as many as fit in three fifths of the five minutes (ties go to
the earlier move). Every other move is **boring**: it plays in a run at one speed
for the whole cut, the slowest of x3, x6, x12, x24 and x48 at which the whole cut
fits in five minutes, with that badge on the board. A run at xS shows every
(S/6)-th move for one frame (x3 shows every move for two frames, x6 every move for
one), and a crash shown in a run draws its burst without the board's flash. The
opening, the always-kept moves and the fill are never cut; if x48 still does not
fit, fewer high-scoring moves stay at normal pace until it does. A level short
enough to play whole at normal pace plays whole, without a badge.

`npm run cut-report -- <game>` prints where a level's full cut spends its time (by
kind of shot, kept and boring moves, the chosen speed), which is how a person checks
what the cut calls boring.

**The Short** is vertical, built for a phone, and tells one story in this
order:

1. the struggle, opening the Short under its caption: the crashes that ended the record attempts before the
   winning one, the latest four at most, a second each, the death counter
   showing the real count as it jumps;
2. the winning attempt, from its first move to the fill: bet beats on its
   moves with the most trades, as many as the time allows, and every move at
   the pace that fits (never slower than four moves a second);
3. the fill, three seconds of confetti and `FILLED`, then the end card,
   three seconds: `Bet on the next move` and `telarchy.com/snake`.

The Short's frame is the board full width at the top, with its tags, chips
and effects; under it in large type the length and the death counter, the
three options with their prices (the chosen one outlined) and the move's
newest trade; nothing smaller than 40 px is set. Its sidecar title is
`A prediction market played snake (level <game>) #shorts`, and its
description is the full cut's.

**Publishing is a person's step.** The file is uploaded in YouTube Studio
as public, with the sidecar's title and description, on the channel above.
The YouTube Data API keeps uploads from an unaudited project private, so
uploading is not automated.

## Operation

The service is one process: engine, operator loop, board, `/state`. It
persists its state (grid, step, counters, decision log) to a JSON file on
every step so a restart continues the game.

A watchdog (`scripts/watchdog.sh`, a systemd timer every minute on the
host) runs `scripts/health.sh`, which asks the one question that matters:
can somebody trade the snake right now. It checks that the step is moving
(and, between games, that the next game is not more than a minute past
`nextGameAt`, because there the step is meant to stand still),
that the feed carries an open proposal, that the floor's own proxy is
within three steps of the feed, that telarchy.com/snake serves, and that
the open proposal carries its three option books. A stalled operator is
restarted, at most once in five minutes; a stopped stream is started unless its unit is disabled; a
fault on the floor's side is logged and left alone, because the host
cannot fix it. **A fault that heals itself is not answered with a
restart.** The book of a new attempt exists a beat after the settlement
that ended the last one, so the first step of an attempt can read as unplayable and be well
again the next minute; a missing book and a missing proposal therefore wait
for a second consecutive unhealthy minute, because a restart neither creates
a book nor waits for one. A stalled step, a dead feed and an overdue next
game are answered at once, since there a restart is the repair. Every action is logged with its reason to
`~/logs/telarchy-snake-watchdog.log`. Configuration by environment:
the Telarchy base URL, the operator API key, the workspace id, the port,
the state file path, the liquidity per book.

The snake runs on a server of its own (Hetzner `telarchy-snake`,
167.233.147.90, 2 vCPU, 4 GB, user `telarchy`): the only other process
there is futarchy chess (`telarchy-chess`, its `docs/chess.md`), a light
operator with no engine and a few reads a minute, so a decision always falls
inside its minute. Nothing heavy runs there. It shared the fleet box first
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

- Exactly one proposal per minute while running, never more, and it
  carries exactly the three options forward, left, right in that order.
- The option with the highest price is the one chosen; a tie continues
  in the current heading.
- A decision is made every minute before the deadline; the undecided
  path leaves nothing pending.
- A reading is posted after every step, timestamped at the step, and it
  is the snake's length: 2 again after a death or a new game.
- The move that ends an attempt settles the metric at the length the
  attempt reached, before the new attempt's reading is posted, and never
  otherwise.
- One book per attempt: the metric's only horizon is the `until-settled`
  date titled `this attempt`, written when the metric does not carry it and
  never on the clock; its book settles only when the attempt ends, so no
  step is decided on a closed book.
- The snake never moves on a step the market did not price: no posted
  proposal, no answer at the decision, no price on any option, or a failed
  approval, and it waits instead and says why.
- The operator never trades.
- The board never shows a price the workspace did not report.
- A level video shows a whole complete level and nothing the record does
  not hold: every price is a recorded price, every trade row is a row of
  the public actions log, and an option is named on a trade only when the
  match is unambiguous.
