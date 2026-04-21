export function formatLocalDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("fr-FR");
}

export function formatLocalDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("fr-FR");
}

export function localDateTimeInput(hoursFromNow: number): string {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}
