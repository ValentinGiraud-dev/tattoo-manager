const longDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Date métier `AAAA-MM-JJ` (date locale) → « 14 octobre 2026 ». */
export function formatIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return longDate.format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/**
 * Horodatage technique stocké en UTC (`AAAA-MM-JJTHH:MM:SS`, sans `Z`)
 * → date et heure locales : « 14 oct. 2026, 15:42 ».
 */
export function formatTimestamp(value: string): string {
  const utc = /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return value;
  return dateTime.format(date);
}
