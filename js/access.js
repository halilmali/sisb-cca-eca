// ============================================================================
// ClubBoard — student access window
// ============================================================================
// Students may use the app only during a short, fixed window. Admin access is
// never gated — only the student role is limited by the window below.
//
// The window is expressed in Bangkok local time (Asia/Bangkok). Bangkok is
// always UTC +7 and does not observe daylight saving time, so the Bangkok
// wall-clock is simply the UTC instant plus 7 hours. This avoids relying on a
// timezone database being present in every browser.
// ============================================================================

// Bangkok is 7 hours ahead of UTC, year-round.
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

// The student access window: Wednesday Aug 26 14:30 → Friday Aug 28 18:00
// Bangkok time.
//   Wed 26 Aug 14:30 BKK  == 07:30 UTC (inclusive)
//   Fri 28 Aug 18:00 BKK  == 11:00 UTC (exclusive — access ends exactly here)
// Note: `Date.UTC` uses 0-based months, so "7" is August.
export const STUDENT_WINDOW_START_MS = Date.UTC(2026, 7, 26, 7, 30, 0);
export const STUDENT_WINDOW_END_MS = Date.UTC(2026, 7, 28, 11, 0, 0);

/** Human-readable summary used in the closed screen and save-error message. */
export const STUDENT_WINDOW_LABEL =
  "Wednesday, August 26, 2:30 PM → Friday, August 28, 6:00 PM (Bangkok time)";

/** True while the student window is open (start inclusive, end exclusive). */
export function isStudentWindowOpen(now = Date.now()) {
  return now >= STUDENT_WINDOW_START_MS && now < STUDENT_WINDOW_END_MS;
}

/** A Date whose fields represent the current Bangkok wall-clock. */
export function bangkokNow(now = Date.now()) {
  return new Date(now + BANGKOK_OFFSET_MS);
}

/**
 * Format an absolute instant as a Bangkok-clock string. The instant is shifted
 * by +7h and rendered as UTC, so the browser's own timezone never changes the
 * displayed wall-clock (Bangkok = UTC+7 for any user).
 */
export function fmtBangkok(ms) {
  return new Date(ms + BANGKOK_OFFSET_MS).toLocaleString(undefined, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
