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

- Grid 20 by 20. The snake starts at the centre with length 3, heading
  right, one food on a free cell. Classic rules: the snake moves one cell
  per step in its heading, eating food grows it by one and spawns new food
  on a random free cell, hitting a wall or its own body kills it.
- One step per minute, at the top of each UTC minute. The step's
  direction is the approved proposal's direction (below). Reversing into
  the second segment is a death like any other collision.
- On death the snake respawns at once in the starting state. Deaths are
  counted and shown, nothing else happens: the length itself is the
  penalty, because the length is what the market prices.
- The game never ends. A "game" for scoring purposes is a UTC day.

## The workspace

One public Telarchy workspace named `Snake` (Telarchy derives the slug,
`snake`, from the name), owned by the snake operator account. One metric,
**Snake length**, the number of segments the snake has right now, an
integer starting at 3. The operator posts a reading after every step, so
the metric's chart is the length minute by minute.

The metric is priced on two horizons and no other: **today** and **this
week** (UTC day and ISO week). A book for a period settles on the last
reading whose timestamp falls inside the period; Telarchy has no "final"
flag, so the reading posted after the last step before midnight is the
day's fixing by being last. Both horizons are needed because a proposal
only gets a pair on a period that ends after its deadline: in the last
minute of a day the today book is closed to it, and the week pair carries
the decision.

Liquidity: every pair book a proposal opens is funded by the workspace
owner through the metric's per-horizon proposal credits (20 credits a
book on today, 5 on the week), never by the proposer; the operator posts
with no subsidy of its own. The workspace's decision window is one minute,
the minimum. The workspace has no charter, so a decline needs no reason.

## The step

At second 0 of each minute the operator posts four proposals, titles
exactly `Move up`, `Move right`, `Move down`, `Move left`, description
naming the step number and the current state in one line. Each carries a
one-minute decision window, so its pair books on Snake length open at
once and close at the deadline.

At second 55, before the deadline, the operator reads each proposal's
pair on the today horizon (or the week horizon when today has none) and
decides:

- the proposal whose approved-branch price is highest is **approved**;
  its declined branch voids and its approved branch stays open to settle
  on the length;
- the other three are **declined with refund**: both their branches void
  and every stake in them returns, so nothing but the chosen move's book
  stays open;
- ties go to the current heading, then to up, right, down, left in that
  order;
- if no price can be read, or the API fails, the snake continues in its
  current heading and the four proposals are declined with refund; the
  step is logged as undecided.

The approved direction is applied at the next top of minute. So the
board shows: proposals for step N open during minute N, decision at N:55,
move at N+1:00, and the next four proposals posted the same second.

Nothing about the game is decided by the operator except through this
rule. The operator account never trades.

## The board

The service serves one page, the board, at `/`. It carries:

- the grid, the snake and the food, drawn large enough to read on a
  stream at 1280 by 720,
- the current length, deaths today, the step number, seconds to the
  decision,
- four cards, one per direction, with the live approved-branch and
  declined-branch prices, the leader marked, each card linking to that
  proposal on telarchy.com,
- the last ten decisions (direction, the four prices at decision, what it
  did to the length),
- one line saying what this is and where to trade, with the workspace
  link.

It polls the service's own `/state` JSON every two seconds. `/state` is
public and is the whole of the board's data: game state, current
proposals with prices, recent decisions, counters. A watcher who wants to
build their own board or bot can read it.

Body text on the board is left-aligned; only titles and single numbers
may be centred.

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
