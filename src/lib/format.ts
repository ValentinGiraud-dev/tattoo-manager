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

const relative = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

/** Horodatage avec fuseau → « il y a 5 minutes », « hier », « il y a 3 jours ». */
export function formatRelative(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (Math.abs(minutes) < 1) return "à l’instant";
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

/** Taille de fichier lisible : « 12,4 Mo ». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

/** Vrai si l'horodatage est absent, illisible ou plus ancien que `ms` millisecondes. */
export function isOlderThan(value: string | null, ms: number, now: Date = new Date()): boolean {
  if (!value) return true;
  const time = new Date(value).getTime();
  return Number.isNaN(time) || now.getTime() - time > ms;
}
