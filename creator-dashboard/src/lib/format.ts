/**
 * Date display for the creator dashboard.
 *
 * The creator is in Lagos, so every timestamp renders in Africa/Lagos
 * — never in the viewer's local timezone, which changes the date and
 * time depending on who (or which device) happens to open the page.
 * Lagos is UTC+1 all year (no daylight saving), so the offset is stable.
 */

export const DASHBOARD_TIME_ZONE = "Africa/Lagos";

/** Format an ISO timestamp in Africa/Lagos; returns the input unchanged when it is not a date. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-NG", { timeZone: DASHBOARD_TIME_ZONE });
}
