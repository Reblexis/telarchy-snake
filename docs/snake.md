# Futarchy snake

A snake game steered by a Telarchy workspace. Every minute the market
decides the snake's next move: four proposals are posted, one per
direction, each priced by the workspace's own pair markets on the snake's
length, and the one the market expects to leave the snake longest is
approved. The game runs around the clock and a board page shows it live.

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

- Grid 20 by 20. The snake starts at the centre with length 1, heading
  right, one food on a free cell. Classic rules: the snake moves one cell
  per step in its heading, eating food grows it by one and spawns new food
  on a random free cell, hitting a wall or its own body kills it.
- One step per minute, at the top of each UTC minute. The step's
  direction is the approved proposal's direction (below). Reversing into
  the second segment is a death like any other collision.
- On death the snake respawns at once at length 1 in the starting state.
  Deaths are counted and shown, nothing else happens: the length itself is
  the penalty, because the length is what the market prices.
- The game ends when the snake fills the grid: at length 400 it is
  **complete**, the operator posts the final reading, posts no more
  proposals, and the board shows the full snake and says so. Until then it
  runs without end.

## The workspace

One public Telarchy workspace named `Snake` (Telarchy derives the slug,
`snake`, from the name), owned by the snake operator account. One metric,
**Snake length**, the number of segments the snake has right now, an
integer starting at 3. The operator posts a reading after every step, so
the metric's chart is the length minute by minute.

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

At second 0 of each minute the operator posts four proposals at once,
titles exactly `Move up`, `Move right`, `Move down`, `Move left`. Each
carries the same deadline, the top of the next minute, so the four books
close together and the deadline a trader sees is the real one. The
description names the step, the state, the three cells the proposal is
priced on (as clock minutes, UTC), the rule, and the board's address, in
one line.

During the minute the operator re-reads the four proposals' pairs every
five seconds and publishes them on `/state`, so the board and any bot
see the live prices and the current leader, not only the decision.

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

The approved direction is applied at the next top of minute. So the
board shows: proposals for step N open during minute N, decision at N:58,
move at N+1:00, and the next four proposals posted the same second.

Nothing about the game is decided by the operator except through this
rule. The operator account never trades.

## The board

The service serves one page, the board, at `/`. It carries:

- the grid, the snake and the food, drawn large enough to read on a
  stream at 1280 by 720,
- the current length, deaths today, the step number, seconds to the
  decision,
- four cards, one per direction, with the live 60-move impact large and
  the 1-move and 5-move prices small, the leader marked, each card linking
  to that proposal on telarchy.com,
- the last ten decisions (direction, the four prices at decision, what it
  did to the length),
- one line saying what this is and where to trade, with the workspace
  link.

It polls the service's own `/state` JSON every two seconds. `/state` is
public and is the whole of the board's data and a bot's feed: the game
state, the workspace and metric ids, the open step with its four
proposals, and for each direction and cell the approved and declined
market ids and their live prices, the cell keys, the decide instant and
the next step instant, the decision rule in words, recent decisions and
counters. A bot needs one read of `/state` per step to know what to
trade.

Body text on the board is left-aligned; only titles and single numbers
may be centred.

The board also renders inside Telarchy: the workspace's live-view setting
points at the board's embed form (`/?embed=1`, the same page without its
own heading and footer, sized for a 16:9 frame), and the public floor
shows it above the owner's text. A visitor of telarchy.com/snake sees the
game without leaving the floor.

## The stream

The board rendered by a headless browser and pushed to Twitch as a
continuous stream, from the fleet box. A stream key lives in the keyring.
The stream is an embed on the board and a link; it is not expected to
find viewers on its own.

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

- Exactly four proposals per minute while running, never more.
- A decision is made every minute before the deadline; the undecided
  path leaves nothing pending.
- A reading is posted after every step, timestamped at the step, so the
  last one before midnight is the number the day's books settle on.
- The operator never trades.
- The board never shows a price the workspace did not report.
