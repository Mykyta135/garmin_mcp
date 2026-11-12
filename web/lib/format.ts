/** Formatting helpers shared by the views. Safe on the client. */

/** "2026-09-08" -> "Sep 8" — axis labels, not full dates. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function hoursMinutes(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function duration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function km(meters: number | null | undefined): string {
  if (!meters) return "—";
  return `${(meters / 1000).toFixed(2)} km`;
}

/** "table_tennis" -> "Table Tennis" */
export function titleize(key: string | null | undefined): string {
  if (!key) return "—";
  // Lowercase the tail: Garmin mixes snake_case ("table_tennis") with
  // SCREAMING_CASE ("BREASTSTROKE", "DRILL"), and keeping the original case
  // would render the latter unchanged.
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
