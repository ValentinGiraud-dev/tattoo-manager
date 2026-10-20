import { useState } from "react";
import type { CategoryFilter } from "../../lib/categories";
import type { Category } from "../../stores/products-store";

function sameFilter(a: CategoryFilter, b: CategoryFilter): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "category" || (b.kind === "category" && a.id === b.id);
}

function Row({
  label,
  count,
  depth,
  active,
  onSelect,
  toggle,
}: {
  label: string;
  count: number;
  depth: number;
  active: boolean;
  onSelect: () => void;
  toggle?: { open: boolean; onToggle: () => void };
}) {
  return (
    <li className="flex items-center" style={{ paddingLeft: `${depth * 14}px` }}>
      {toggle ? (
        <button
          type="button"
          onClick={toggle.onToggle}
          aria-label={toggle.open ? `Replier ${label}` : `Déplier ${label}`}
          aria-expanded={toggle.open}
          className="grid size-5 shrink-0 place-items-center rounded-sm text-[10px] text-fg-faint hover:text-fg"
        >
          <span
            aria-hidden="true"
            className={`transition-transform ${toggle.open ? "rotate-90" : ""}`}
          >
            ▶
          </span>
        </button>
      ) : (
        <span className="size-5 shrink-0" />
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={[
          "flex min-w-0 flex-1 items-baseline justify-between gap-2 rounded-sm px-2 py-1 text-left text-[13px] transition-colors",
          active
            ? "bg-surface-3 font-medium text-fg"
            : "text-fg-muted hover:bg-surface-2 hover:text-fg",
        ].join(" ")}
      >
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-[11.5px] text-fg-faint tabular-nums">{count}</span>
      </button>
    </li>
  );
}

/** Filtre de la liste des produits par catégorie (une catégorie inclut ses sous-catégories). */
export function CategoryTree({
  categories,
  filter,
  onFilter,
  totalCount,
  uncategorizedCount,
  onManage,
}: {
  categories: Category[];
  filter: CategoryFilter;
  onFilter: (filter: CategoryFilter) => void;
  totalCount: number;
  uncategorizedCount: number;
  onManage: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Une catégorie est cachée si l'un de ses parents est replié.
  const hidden = new Set<string>();
  for (const category of categories) {
    if (category.parentId && (hidden.has(category.parentId) || collapsed.has(category.parentId))) {
      hidden.add(category.id);
    }
  }

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <nav aria-label="Catégories" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-[12px] font-medium tracking-[0.06em] text-fg-faint uppercase">
          Catégories
        </h2>
        <button
          type="button"
          onClick={onManage}
          className="text-[12.5px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
        >
          Gérer
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        <Row
          label="Tous les produits"
          count={totalCount}
          depth={0}
          active={filter.kind === "all"}
          onSelect={() => onFilter({ kind: "all" })}
        />
        {categories
          .filter((category) => !hidden.has(category.id))
          .map((category) => (
            <Row
              key={category.id}
              label={category.name}
              count={category.totalLotCount}
              depth={category.depth}
              active={sameFilter(filter, { kind: "category", id: category.id })}
              onSelect={() => onFilter({ kind: "category", id: category.id })}
              toggle={
                category.childCount > 0
                  ? { open: !collapsed.has(category.id), onToggle: () => toggle(category.id) }
                  : undefined
              }
            />
          ))}
        {categories.length > 0 && (
          <Row
            label="Sans catégorie"
            count={uncategorizedCount}
            depth={0}
            active={filter.kind === "none"}
            onSelect={() => onFilter({ kind: "none" })}
          />
        )}
      </ul>
      {categories.length === 0 && (
        <p className="px-1 text-[12.5px] text-fg-faint">
          Rangez vos produits par catégories et sous-catégories (ex. Aiguilles › RL).
        </p>
      )}
    </nav>
  );
}
