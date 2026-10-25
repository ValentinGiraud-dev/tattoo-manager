/** Découpe d'une liste déjà chargée. La page 1 est la première. */

export const PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

export function pageCount(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.ceil(total / pageSize);
}

export function clampPage(page: number, total: number, pageSize: number): number {
  const last = pageCount(total, pageSize);
  if (page < 1) return 1;
  if (page > last) return last;
  return page;
}

/** Indices affichés, 1-based. Liste vide : de 0 à 0. */
export function pageBounds(
  page: number,
  total: number,
  pageSize: number,
): { from: number; to: number } {
  if (total <= 0 || pageSize <= 0) return { from: 0, to: 0 };
  const safe = clampPage(page, total, pageSize);
  const from = (safe - 1) * pageSize + 1;
  const to = Math.min(safe * pageSize, total);
  return { from, to };
}

export function rangeLabel(page: number, total: number, pageSize: number): string {
  const { from, to } = pageBounds(page, total, pageSize);
  const noun = total === 1 ? "résultat" : "résultats";
  return `Affichage de ${from} à ${to} sur ${total} ${noun}.`;
}

export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  if (pageSize <= 0) return [];
  const safe = clampPage(page, rows.length, pageSize);
  const start = (safe - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/** Au plus cinq numéros, calés sur la page courante. */
export function visiblePages(page: number, total: number, pageSize: number): number[] {
  const pages = pageCount(total, pageSize);
  const width = Math.min(5, pages);
  let start = clampPage(page, total, pageSize) - 2;
  if (start < 1) start = 1;
  if (start + width - 1 > pages) start = pages - width + 1;
  return Array.from({ length: width }, (_, index) => start + index);
}
