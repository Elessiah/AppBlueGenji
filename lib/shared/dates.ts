export function formatLocalDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("fr-FR");
}

export function formatLocalDateTime(date: Date | string): string {
  // Options explicites : le format par défaut de `toLocaleString("fr-FR")`
  // inclut les secondes (« 21/09/2026 00:16:55 »), qui n'apportent rien à un
  // horaire de tournoi et alourdissent chaque date affichée.
  return new Date(date).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function localDateTimeInput(hoursFromNow: number): string {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}
