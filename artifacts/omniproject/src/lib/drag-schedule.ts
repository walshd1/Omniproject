/**
 * Pure geometry for the schedule sandbox's drag-to-shift gesture. Given the
 * pointer's start/current x (in px), the track's pixels-per-day scale and the
 * shift the bar already had when the drag began, return the bar's new whole-day
 * shift. Kept dependency-free so it can be unit-tested in isolation.
 */
export function dayShiftFromDrag(
  startX: number,
  currentX: number,
  pxPerDay: number,
  origShift: number,
): number {
  const deltaDays = Math.round((currentX - startX) / pxPerDay);
  return origShift + deltaDays;
}
