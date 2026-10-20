import { describe, expect, it } from "vitest";
import type { Category } from "../stores/products-store";
import { matchesFilter, possibleParents, withDescendants } from "./categories";

function category(id: string, parentId: string | null, depth: number): Category {
  return {
    id,
    parentId,
    name: id,
    depth,
    path: id,
    lotCount: 0,
    totalLotCount: 0,
    childCount: 0,
    lowStockThreshold: null,
    lowStockMode: null,
  };
}

// Aiguilles > RL > 3RL, Aiguilles > RM, Encres
const tree = [
  category("aiguilles", null, 0),
  category("rl", "aiguilles", 1),
  category("3rl", "rl", 2),
  category("rm", "aiguilles", 1),
  category("encres", null, 0),
];

describe("catégories", () => {
  it("une catégorie inclut toutes ses sous-catégories", () => {
    expect([...withDescendants(tree, "aiguilles")].sort()).toEqual([
      "3rl",
      "aiguilles",
      "rl",
      "rm",
    ]);
    expect([...withDescendants(tree, "rl")].sort()).toEqual(["3rl", "rl"]);
    expect([...withDescendants(tree, "encres")]).toEqual(["encres"]);
  });

  it("le filtre retrouve les lots rangés plus bas", () => {
    const filter = { kind: "category", id: "aiguilles" } as const;
    expect(matchesFilter("3rl", filter, tree)).toBe(true);
    expect(matchesFilter("encres", filter, tree)).toBe(false);
    expect(matchesFilter(null, filter, tree)).toBe(false);
    expect(matchesFilter(null, { kind: "none" }, tree)).toBe(true);
    expect(matchesFilter("rl", { kind: "all" }, tree)).toBe(true);
  });

  it("une catégorie ne peut pas être déplacée dans sa propre branche", () => {
    expect(possibleParents(tree, "rl").map((c) => c.id)).toEqual(["aiguilles", "rm", "encres"]);
  });
});
