import type { Category } from "../stores/products-store";

/** Filtre de la liste des produits. */
export type CategoryFilter = { kind: "all" } | { kind: "none" } | { kind: "category"; id: string };

/** Identifiants de la catégorie et de toutes ses sous-catégories. */
export function withDescendants(categories: Category[], id: string): Set<string> {
  const ids = new Set([id]);
  // La liste est dans l'ordre de l'arbre : un enfant suit toujours son parent.
  for (const category of categories) {
    if (category.parentId && ids.has(category.parentId)) ids.add(category.id);
  }
  return ids;
}

/** Vrai si le lot passe le filtre (une catégorie inclut ses sous-catégories). */
export function matchesFilter(
  categoryId: string | null,
  filter: CategoryFilter,
  categories: Category[],
): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "none") return categoryId === null;
  return categoryId !== null && withDescendants(categories, filter.id).has(categoryId);
}

/** Parents possibles pour déplacer une catégorie : ni elle-même ni ses descendantes. */
export function possibleParents(categories: Category[], id: string): Category[] {
  const excluded = withDescendants(categories, id);
  return categories.filter((category) => !excluded.has(category.id));
}
