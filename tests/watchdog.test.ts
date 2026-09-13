import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The watchdog and the stream (docs/snake.md, "The stream" and "Operation").
 * The rule this file exists to protect: **a disabled stream is off on
 * purpose, and the watchdog never starts it.** The Twitch channel takes one
 * stream; when chess streams on it, the snake's stream unit is disabled, and a
 * watchdog that started every stopped stream would knock chess off the
 * channel within a minute.
 */

function run(opts: { healthy: boolean; active: boolean; enabled: boolean; out?: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'snake-watchdog-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'bin'));
  copyFileSync(new URL('../scripts/watchdog.sh', import.meta.url), join(dir, 'scripts/watchdog.sh'));
  writeFileSync(join(dir, 'scripts/health.sh'), `#!/usr/bin/env bash\necho "${opts.out ?? 'ok'}"\nexit ${opts.healthy ? 0 : 1}\n`);
  const calls = join(dir, 'calls');
  writeFileSync(join(dir, 'bin/systemctl'), `#!/usr/bin/env bash
echo "$*" >> "${calls}"
case "$*" in
  *is-active*) exit ${opts.active ? 0 : 3} ;;
  *is-enabled*) exit ${opts.enabled ? 0 : 1} ;;
esac
exit 0
`);
  for (const f of ['scripts/watchdog.sh', 'scripts/health.sh', 'bin/systemctl']) chmodSync(join(dir, f), 0o755);
  try {
    execFileSync('bash', [join(dir, 'scripts/watchdog.sh')], {
      env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, HOME: dir, LOG: join(dir, 'log'), LAST: join(dir, 'last'), STREAK: join(dir, 'streak'), SETTLE: '0' },
      stdio: 'ignore',
    });
  } catch { /* an unhealthy run exits 1 */ }
  const lines = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [];
  return { started: lines.some(l => /(^| )start telarchy-snake-stream\.service/.test(l)), restarted: lines.some(l => /(^| )restart telarchy-snake\.service/.test(l)) };
}

describe('a disabled stream is off on purpose', () => {
  test('healthy game, stream stopped and enabled: the watchdog starts it', () => {
    expect(run({ healthy: true, active: false, enabled: true }).started).toBe(true);
  });
  test('healthy game, stream stopped and disabled: the watchdog never starts it', () => {
    expect(run({ healthy: true, active: false, enabled: false }).started).toBe(false);
  });
  test('healthy game, stream running: nothing is started', () => {
    expect(run({ healthy: true, active: true, enabled: true }).started).toBe(false);
  });
  test('after restarting a stalled operator, a disabled stream stays off', () => {
    const r = run({ healthy: false, active: false, enabled: false, out: 'step has not moved' });
    expect(r.restarted).toBe(true);
    expect(r.started).toBe(false);
  }, 30_000);
  test('after restarting a stalled operator, an enabled stopped stream is started', () => {
    const r = run({ healthy: false, active: false, enabled: true, out: 'step has not moved' });
    expect(r.restarted).toBe(true);
    expect(r.started).toBe(true);
  }, 30_000);
});
