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
  Deaths are counted and shown, nothing else happens: the length itself is
  the penalty, because the length is what the market prices.
- A game ends when the snake fills the grid (length 144 on the first
  grid): it is **complete**, the operator posts no more proposals, keeps
  posting the full length as the reading every minute, and the board
  shows the full snake and says so. After a **cooldown of one hour** the
  next game starts on the larger grid, at length 2, with the game number
  counted up. Until a game completes it runs without end.

## The workspace

One public Telarchy workspace named `Snake` (Telarchy derives the slug,
`snake`, from the name), owned by the snake operator account. One metric,
**Snake length**, the number of segments the snake has right now, an
integer starting at 2. Its market range is 0 to the full grid (144 on the
first grid), so a book can price any length the snake can reach; when a
new game starts on a larger grid the operator raises the range to the
new full grid first. Telarchy refuses that while an open book on the
metric has trades, so the operator retries every minute until it goes
through, and the cooldown lasts that long. The operator posts a
reading after every step, so the metric's chart is the length minute by
minute.

The metric is priced on three rolling horizons, each a one-minute
period on Telarchy's clock (`+1min`, `+5min`, `+60min`): the length in
**1 move**, in **5 moves** and in **60 moves**. A book for a minute
settles on the last reading whose timestamp falls inside that minute; the
operator's reading at the top of each minute, posted right after the
move, is that minute's fixing, so the book for minute M+5 settles on the
length after five more moves. No calendar horizon is priced.

A rolling minute cell exists only once the workspace's rolling markets
are refreshed, so the operator forces that refresh at every step, before
posting the four proposals; the three baseline books for the step's
cells are then open and every proposal gets its three pairs.

Liquidity: every pair book a proposal opens is funded by the workspace
owner through the metric's per-horizon proposal credits (20 credits a
book on the 1-move and 5-move horizons, 40 on the 60-move horizon, so a
five-credit trade is an opinion and a twenty-credit one does not pin the
book),
never by the proposer; the operator posts
with no subsidy of its own. The workspace's decision window is one minute,
the minimum. The workspace has no charter, so a decline needs no reason.

The workspace is **muted**: `notificationsMuted` is on, so nothing it does
reaches anyone by email, push or the bell, owner included. Four proposals
and four decisions a minute would otherwise mail the owner and the
proposer thousands of times a day. It stays muted until Viktor says
otherwise.

## The step

At second 0 of each minute the operator posts three proposals at once,
titles exactly `Turn left`, `Turn right`, `Continue forward`. Each
carries the same deadline, the top of the next minute, so the books
close together and the deadline a trader sees is the real one. The
description names the step, the state including the current heading and
the compass direction each action would take, the three cells the
proposal is priced on (as clock minutes, UTC), the rule, and the board's
address, in one line.

During the minute the operator re-reads the proposals' pairs every five
seconds and publishes them on `/state`, so the board and any bot see the
live prices and the current leader, not only the decision.

At second 58, two seconds before the deadline, the operator reads each
proposal's three pairs one last time and decides on the **60-move
horizon alone**: a direction's
score is its predicted impact there, the approved-branch price minus the
declined-branch price. Then:

- the proposal with the highest score is **approved**; its declined
  branches void and its approved branches stay open to settle on the
  length at their minutes;
- the other three are **declined with refund**: all their branches void
  and every stake in them returns;
- ties go to the current heading, then to up, right, down, left in that
  order;
- if no 60-move price can be read, or the API fails, the snake continues
  in its current heading and the four proposals are declined with refund;
  the step is logged as undecided.

The 1-move and 5-move pairs never decide anything; they exist to be
traded and to show how the market sees the near future.

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

What the board shows, top to bottom, and where each element comes from:

- **The grid**, the snake and the food, drawn large enough to read on a
  stream at 1280 by 720, with the snake's heading marked on its head and
  named in words. Source: `game` on `/state`.
- **Counters**: the game number and grid size, the current length, the
  best length reached in this game, deaths today, the step number, seconds
  to the decision. Source: `game`, `bestLength`, `deathsToday`,
  `secondsToDecision`.
- **Next move**, one big line, `NEXT: TURN LEFT ↑ UP`, with the seconds
  to the decision. Before the decision it is the current leader, the
  action with the highest live 60-move impact (forward when no price is
  readable, per the rule); after the decision it is the approved action,
  held until the move happens at the top of the minute. Source: `next` on
  `/state` (`action`, `direction`, `decided`, `seconds`).
- **Commentary**, one left-aligned line written by a fixed rule set from
  the state alone, no model: where the food is relative to the head and
  which way the market leans, a death in the last two steps, a new record
  length, a leader that runs into a wall or the body next move, a step
  nobody has traded yet, a completed game. Source: `commentary`.
- **Three cards**, one per action, each naming the compass direction it
  would take, with the live 60-move impact large and the 1-move and
  5-move prices small, the leader marked, each card linking to that
  proposal on telarchy.com. Source: `open.quotes`, `open.directions`,
  `open.proposals`.
- **The trades ticker**, a strip scrolling the last 30 trades across the
  snake's books, newest first: time, handle, action, horizon, branch
  (approved or declined), side (higher or lower), buy or sell, amount in
  credits, and the book's price when the trade was first seen. Source:
  `recentTrades`.
- **Current traders**: who holds a position in this step's books right
  now, one row per position: handle, action, horizon, branch, side, stake
  and current worth; with the count of distinct traders this step and
  today. Source: `traders`, `tradersThisStep`, `tradersToday`.
- **Leaderboard**: the top five traders of this workspace by profit, from
  Telarchy's public per-workspace leaderboard, with their trade counts.
  Source: `leaderboard`.
- **The last ten decisions** (action and direction, the three impacts at
  decision, what it did to the length). Source: `recentDecisions`.
- One line saying what this is and where to trade, with the workspace
  link.

Body text on the board is left-aligned; only titles and single numbers
may be centred.

The board also renders inside Telarchy: the workspace's live-view setting
points at the board's embed form (`/?embed=1`, the same page without its
own heading and footer, sized for a 16:9 frame), and the public floor
shows it above the owner's text. The embed is compact: it shows the grid,
the counters, the next move, the commentary, the three cards and the
ticker, and hides the traders list, the leaderboard and the decisions
table. A visitor of telarchy.com/snake sees the game without leaving the
floor.

### The feed

`/state` is public and is the whole of the board's data and a bot's feed:
the game state, the workspace and metric ids, the open step with its
three proposals, and for each action and cell the approved and declined
market ids and their live prices, the cell keys, the decide instant and
the next step instant, the decision rule in words, recent decisions and
counters. A bot needs one read of `/state` per step to know what to
trade.

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

The operator reads activity on its own timer, apart from the quotes: the
six 60-move books of the open step (approved and declined per action)
every ten seconds, the twelve 1-move and 5-move books once per step, and
the workspace leaderboard once a minute. That is about fifty public reads
a minute on top of the step's own calls; it never walks a book's history.
The operator account still never trades.

## The stream

The board rendered as a 1280 by 720 frame in-process and pushed to Twitch
as a continuous stream, from the fleet box. The channel is
https://www.twitch.tv/telarchy (account agents@telarchy.com; credentials
and the stream key in the keyring, `telarchy/twitch.env`). The stream is
a link on the board and the floor; it is not expected to find viewers on
its own.

The frame carries the grid on the left and, in the right column: the
title, the counters, the next move in large yellow type, the commentary,
the three cards, the current traders (up to three rows), the last trades
(up to five rows, newest first), the last decisions, and the trade line.
Every line is readable at 720p: nothing below the cards is drawn smaller
than the decisions rows.

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
- A reading is posted after every step, timestamped at the step, so the
  last one before midnight is the number the day's books settle on.
- The operator never trades.
- The board never shows a price the workspace did not report.
