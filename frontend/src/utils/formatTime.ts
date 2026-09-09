/**
 * Renders a time of day for display: "7 PM" on a whole hour, "7:15 PM"
 * otherwise.
 *
 * The minutes are dropped by *asking for* an hour-only format rather than by
 * editing them out of the result. An earlier version stripped `:\d{2}` with a
 * regex, which was invisible while slots were seeded on the hour and turned
 * every slot on a 15-minute schedule into "7 PM" once they were not.
 *
 * `locales` is for tests. The app passes nothing, so each visitor sees their
 * own locale's format.
 */
export function formatTimeOfDay(date: Date, locales?: Intl.LocalesArgument) {
  return date.toLocaleTimeString(locales, {
    hour: "numeric",
    ...(date.getMinutes() ? { minute: "2-digit" } : {}),
  });
}
