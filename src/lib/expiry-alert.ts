/**
 * Libellés de l'alerte d'expiration. Le délai appliqué et l'avis sont calculés
 * en Rust (`services/dashboard.rs`) ; ici on ne fait que les dire.
 */
import { formatIsoDate } from "./format";

/** « 30 jours avant (par défaut) », « Alerte 14 jours avant », « Pas d'alerte ». */
export function expiryAlertLabel(setting: number | null): string {
  if (setting === 0) return "Pas d'alerte";
  if (setting === null) return "30 jours avant (par défaut)";
  return `Alerte ${daysBefore(setting)}`;
}

function daysBefore(days: number): string {
  return `${days} jour${days > 1 ? "s" : ""} avant`;
}

/** Bandeau de la fiche : le plus urgent, puis « et N autres ». */
export function expiryBannerText(
  notice: { expired: boolean; lotNumber: string; usefulUntil: string; extra: number },
  alertDays: number,
): string {
  const when = `lot ${notice.lotNumber}, exp. ${formatIsoDate(notice.usefulUntil)}`;
  const head = notice.expired
    ? `Périmé : ${when}`
    : `Bientôt expiré : ${when} (alerte ${daysBefore(alertDays)})`;
  const extra = notice.extra > 0 ? `, et ${notice.extra} autre${notice.extra > 1 ? "s" : ""}` : "";
  return `${head}${extra}.`;
}
