# telarchy-snake

A snake game steered by a Telarchy workspace: three proposals a minute
(turn left, turn right, continue), the market prices each on the length
the attempt will have reached in 60 moves, the highest impact is approved
and the snake moves; when the attempt ends every open book settles at
the length it reached. `docs/snake.md` governs; the code exists
to satisfy it.

Live workspace: https://telarchy.com/snake. Board: https://snake.telarchy.com. Stream: https://www.twitch.tv/telarchy.

The feed (public JSON, CORS `*`, `no-store`; shapes in `docs/snake.md`, "The feed"):

- `GET /state`: the present, the board's data and a bot's feed.
- `GET /games`: every recorded game, oldest first, the running one last.
- `GET /history?game=N|current&from=S&limit=L`: a game's steps, each the
  state after its move, default the newest 300, at most 2000.
- `GET /replay?game=G&from=I`: the Replay tab's start frame plus moves.

The record is `state/games/<number>.jsonl` (one line per step) and
`state/games/index.json`, next to the state file (`GAMES_DIR` overrides).

```bash
npm install
npm test
cp .env.example .env   # fill in
npm run dev
```
