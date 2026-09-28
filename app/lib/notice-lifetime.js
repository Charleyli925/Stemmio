/**
 * @typedef {{
 *   identity: string;
 *   deadlineAt: number;
 *   remainingMs: number;
 *   paused: boolean;
 * }} NoticeDeadline
 */

/**
 * Advance one notice deadline without letting an equal fact restart its life.
 * A pause freezes the remaining duration; resume continues from that duration.
 *
 * @param {NoticeDeadline | null} current
 * @param {{ identity: string; dismissMs: number | null; paused: boolean; now: number }} input
 * @returns {NoticeDeadline | null}
 */
export function advanceNoticeDeadline(current, {
  identity,
  dismissMs,
  paused,
  now,
}) {
  if (!identity || dismissMs === null) return null;
  const remainingMs = current?.identity === identity
    ? current.paused
      ? current.remainingMs
      : Math.max(0, current.deadlineAt - now)
    : dismissMs;
  return Object.freeze({
    identity,
    deadlineAt: now + remainingMs,
    remainingMs,
    paused,
  });
}
