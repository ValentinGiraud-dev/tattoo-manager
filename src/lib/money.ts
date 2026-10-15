const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/** 12345 → « 123,45 € ». */
export function formatEuros(cents: number): string {
  return euros.format(cents / 100);
}

/**
 * Saisie libre → centimes. Accepte « 120 », « 120,5 », « 120.50 », « 1 200 € ».
 * `null` si vide ou invalide. Les montants négatifs sont refusés.
 */
export function parseEuros(text: string): number | null {
  const cleaned = text.replace(/[\s\u00a0\u202f€]/g, "").replace(",", ".");
  if (cleaned === "" || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Centimes → valeur d'un champ de saisie (« 120,50 »), vide si `null`. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const value = (cents / 100).toFixed(2).replace(".", ",");
  return value.endsWith(",00") ? value.slice(0, -3) : value;
}
