/**
 * What the operator loop does this second (docs/snake.md, "Operation").
 *
 * The loop itself only reads a clock and calls the operator; which call it
 * makes is this one pure decision, so the order can be tested without a
 * server, a market, or a minute of waiting.
 */

export type LoopState = {
  /** The game filled its grid and is waiting out the cooldown. */
  complete: boolean;
  /** A step is posted (traded or already ruled). */
  hasOpen: boolean;
  /** That step has its ruling. */
  decided: boolean;
  /** There is enough of this minute left to post a step people can trade. */
  canOpen: boolean;
  /** Seconds into the minute, UTC. */
  sec: number;
  /** Minutes since the epoch, the loop's once-a-minute key. */
  minute: number;
  lastTickMinute: number;
  lastCloseMinute: number;
  sinceLastPoll: number;
  sinceLastActivity: number;
};

export type Action =
  /** Between games: post the full length, and start the next game when due. */
  | 'cooldown'
  | 'open'
  | 'close'
  | 'poll'
  | 'tick'
  | 'activity'
  | 'idle';

export const ACTIVITY_EVERY_MS = 10_000;
const POLL_EVERY_MS = 5_000;

export function nextAction(s: LoopState): Action {
  /* A complete game has no open step, so every branch below that asks for
     one would fire, and the operator refuses a step on a finished game. The
     cooldown comes first and owns the minute: it posts the full length and,
     when the pause is up, starts the next game on the larger grid. */
  if (s.complete) {
    if (s.lastTickMinute !== s.minute && s.canOpen) return 'cooldown';
    return s.sinceLastActivity >= ACTIVITY_EVERY_MS ? 'activity' : 'idle';
  }
  if (!s.hasOpen && s.lastTickMinute !== s.minute && s.canOpen) return 'open';
  if (s.sec >= 58 && s.hasOpen && !s.decided && s.lastCloseMinute !== s.minute) return 'close';
  if (s.hasOpen && !s.decided && s.sec < 58 && s.sinceLastPoll >= POLL_EVERY_MS) return 'poll';
  if (s.sec < 58 && s.hasOpen && s.decided && s.lastTickMinute !== s.minute) return 'tick';
  if (s.sinceLastActivity >= ACTIVITY_EVERY_MS) return 'activity';
  return 'idle';
}
