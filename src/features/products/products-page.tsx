import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, cardClass } from "../../components/styles";
import { ArchiveFilter } from "../../components/archive-controls";
import { DataTable, type DataTableColumn } from "../../components/data-table";
import { matchesFilter, type CategoryFilter } from "../../lib/categories";
import { formatIsoDate, formatWeekdayDate } from "../../lib/format";
import { useProductsStore, type LotSummary, type ProductSheet } from "../../stores/products-store";
import { useUIStore } from "../../stores/ui-store";
import { CategoryManager } from "./category-manager";
import { CategoryTree } from "./category-tree";
import { LotDetail } from "./lot-detail";
import { LotForm } from "./lot-form";
import { LotRow } from "./lot-row";
import { SheetEditor } from "./sheet-editor";

/**
 * Écran courant de Produits. `from` : écran à rouvrir au retour (navigation
 * interne fiche ↔ lot ↔ formulaire).
 */
type View =
  | { kind: "list" }
  | { kind: "categories" }
  | {
      kind: "editor";
      sheet?: ProductSheet;
      fromLot?: LotSummary;
      /** Créée depuis une réception : on y revient avec la nouvelle fiche. */
      thenReceive?: boolean;
      from: View;
    }
  | { kind: "lot"; lot: LotSummary; from?: View }
  | { kind: "lot-form"; lot?: LotSummary; sheetId?: string | null; from: View };

function latestUpdatedAt(sheets: ProductSheet[], lots: LotSummary[]): string | null {
  let latest: string | null = null;
  for (const item of sheets) {
    if (latest === null || item.updatedAt > latest) latest = item.updatedAt;
  }
  for (const item of lots) {
    if (latest === null || item.updatedAt > latest) latest = item.updatedAt;
  }
  return latest;
}

/** État affiché dans la liste. Le calcul (stock, péremption, seuil) vient de Rust. */
function sheetStatus(sheet: ProductSheet): { label: string; className: string } {
  if (sheet.lowStock) return { label: "Stock bas", className: "text-warning" };
  if (sheet.stock === 0 && sheet.expiredStock > 0) {
    return { label: "Périmé", className: "text-danger" };
  }
  if (sheet.lotCount === 0) return { label: "Aucun lot", className: "text-fg-faint" };
  return { label: "En stock", className: "text-success" };
}

function backLabel(view: View | undefined): string | undefined {
  if (!view) return undefined;
  if (view.kind === "editor") return view.sheet?.displayName ?? "Nouveau produit";
  if (view.kind === "lot") return `Lot ${view.lot.lotNumber}`;
  return "Produits";
}

export default function ProductsPage() {
  const {
    lots,
    sheets,
    search,
    showArchived,
    loading,
    error,
    load,
    get: getLot,
    getSheet,
    categories,
    loadCategories,
    lowStock,
  } = useProductsStore();
  const [view, setView] = useState<View>({ kind: "list" });
  const [lowOnly, setLowOnly] = useState(false);
  const lowCount = sheets.filter((sheet) => sheet.lowStock).length;
  const lowFilter = lowOnly && lowCount > 0;
  const [filter, setFilter] = useState<CategoryFilter>({ kind: "all" });
  // Catégorie supprimée entre-temps : retour à tous les produits.
  const activeFilter: CategoryFilter =
    filter.kind === "category" && !categories.some((category) => category.id === filter.id)
      ? { kind: "all" }
      : filter;
  const unattached = lots.filter((lot) => lot.productId === null);
  const shownSheets = sheets.filter(
    (sheet) =>
      matchesFilter(sheet.categoryId, activeFilter, categories) && (!lowFilter || sheet.lowStock),
  );
  const shownUnattached = lowFilter
    ? []
    : unattached.filter((lot) => matchesFilter(lot.categoryId, activeFilter, categories));
  const shownCount = shownSheets.length + shownUnattached.length;
  const filterLabel =
    activeFilter.kind === "category"
      ? (categories.find((category) => category.id === activeFilter.id)?.path ?? "")
      : activeFilter.kind === "none"
        ? "Sans catégorie"
        : null;
  const defaultCategoryId = activeFilter.kind === "category" ? activeFilter.id : null;
  const lotIntent = useUIStore((state) => state.lotIntent);
  const takeLotIntent = useUIStore((state) => state.takeLotIntent);
  const sheetIntent = useUIStore((state) => state.sheetIntent);
  const takeSheetIntent = useUIStore((state) => state.takeSheetIntent);
  const setDetail = useUIStore((state) => state.setDetail);
  const detailId = view.kind === "lot" ? view.lot.id : null;

  // Lot demandé depuis un autre écran (accueil, séance, fiche client).
  useEffect(() => {
    if (!lotIntent) return;
    const lotId = takeLotIntent();
    if (!lotId) return;
    void getLot(lotId)
      .then((lot) => setView({ kind: "lot", lot }))
      .catch(() => setView({ kind: "list" }));
  }, [lotIntent, takeLotIntent, getLot]);

  // Fiche demandée depuis l'accueil (stock bas).
  useEffect(() => {
    if (!sheetIntent) return;
    const sheetId = takeSheetIntent();
    if (!sheetId) return;
    void getSheet(sheetId)
      .then((sheet) => setView({ kind: "editor", sheet, from: { kind: "list" } }))
      .catch(() => setView({ kind: "list" }));
  }, [sheetIntent, takeSheetIntent, getSheet]);

  useEffect(() => {
    setDetail(detailId ? { kind: "lot", id: detailId } : null);
  }, [detailId, setDetail]);

  useEffect(() => {
    void load("");
    void loadCategories();
  }, [load, loadCategories]);

  /** Rouvre une fiche produit à jour (stock, lots) : après une réception par exemple. */
  function openSheet(sheetId: string, from?: View) {
    void getSheet(sheetId)
      .then((sheet) => setView({ kind: "editor", sheet, from: from ?? { kind: "list" } }))
      .catch(() => setView({ kind: "list" }));
  }

  /** Retour vers une vue mémorisée, avec des données relues. */
  function returnTo(target: View | undefined) {
    if (target?.kind === "editor" && target.sheet) openSheet(target.sheet.id, target.from);
    else if (target?.kind === "lot") {
      void getLot(target.lot.id)
        .then((lot) => setView({ kind: "lot", lot, from: target.from }))
        .catch(() => setView({ kind: "list" }));
    } else setView(target ?? { kind: "list" });
  }

  if (view.kind === "categories") {
    return <CategoryManager onBack={() => setView({ kind: "list" })} />;
  }

  if (view.kind === "editor") {
    const originLabel =
      view.from.kind === "lot-form"
        ? "Réception d'un lot"
        : view.from.kind === "list"
          ? undefined
          : backLabel(view.from);
    return (
      <SheetEditor
        key={view.sheet?.id ?? "nouveau"}
        sheet={view.sheet}
        fromLot={view.fromLot}
        defaultCategoryId={defaultCategoryId}
        backLabel={originLabel}
        onBack={() => returnTo(view.from.kind === "list" ? undefined : view.from)}
        onSaved={(saved) => {
          if (view.thenReceive && view.from.kind === "lot-form") {
            setView({ ...view.from, sheetId: saved.id });
            return;
          }
          const from = view.fromLot && !view.sheet ? { kind: "list" as const } : view.from;
          setView({ kind: "editor", sheet: saved, from });
        }}
        onOpenLot={(lot) => setView({ kind: "lot", lot, from: view })}
      />
    );
  }

  if (view.kind === "lot-form") {
    return (
      <LotForm
        // Nouvelle fiche créée entre-temps : le formulaire repart avec elle.
        key={view.sheetId ?? "nouveau"}
        lot={view.lot}
        sheetId={view.sheetId}
        onNewSheet={() => setView({ kind: "editor", thenReceive: true, from: view })}
        onDone={(saved) =>
          saved ? setView({ kind: "lot", lot: saved, from: view.from }) : returnTo(view.from)
        }
      />
    );
  }

  if (view.kind === "lot") {
    return (
      <LotDetail
        lot={view.lot}
        backLabel={backLabel(view.from)}
        onEdit={() => setView({ kind: "lot-form", lot: view.lot, from: view })}
        onBack={() => returnTo(view.from)}
        onChange={(lot) => setView({ kind: "lot", lot, from: view.from })}
        onOpenSheet={(sheetId) => openSheet(sheetId, view)}
        onCreateSheet={(lot) => setView({ kind: "editor", fromLot: lot, from: view })}
      />
    );
  }

  const list: View = { kind: "list" };
  const emptyText = search
    ? "Aucun résultat."
    : filterLabel
      ? "Aucun produit dans cette catégorie."
      : showArchived
        ? "Aucun produit archivé."
        : "Aucun produit pour le moment.";
  const updatedAt = latestUpdatedAt(sheets, lots);
  const subtitle =
    loading && sheets.length === 0 && lots.length === 0
      ? "Chargement…"
      : updatedAt
        ? `Dernière mise à jour - ${formatWeekdayDate(updatedAt)}`
        : null;
  const columns: DataTableColumn<ProductSheet>[] = [
    {
      id: "name",
      header: "Nom du produit",
      cell: (sheet) => <span className="text-fg">{sheet.displayName}</span>,
    },
    {
      id: "usage",
      header: "Usage",
      className: "w-28",
      cell: (sheet) => (sheet.singleUse ? "Unique" : "Multiple"),
    },
    {
      id: "lots",
      header: "Nombre de lots",
      className: "w-36",
      cell: (sheet) => sheet.lotCount,
    },
    {
      id: "stock",
      header: "Stock",
      className: "w-24",
      cell: (sheet) => sheet.stock,
    },
    {
      id: "status",
      header: "Statut",
      className: "w-32",
      cell: (sheet) => {
        const status = sheetStatus(sheet);
        return <span className={status.className}>{status.label}</span>;
      },
    },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-10">
      <div>
        <h1 className="text-[16px] font-medium tracking-tight">Ma traçabilité</h1>
        {subtitle ? <p className="mt-0.5 text-[12.5px] text-fg-faint">{subtitle}</p> : null}
      </div>
      <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="md:sticky md:top-10">
          <CategoryTree
            categories={categories}
            filter={activeFilter}
            onFilter={setFilter}
            totalCount={sheets.length + unattached.length}
            uncategorizedCount={
              sheets.filter((sheet) => sheet.categoryId === null).length +
              unattached.filter((lot) => lot.categoryId === null).length
            }
            onManage={() => setView({ kind: "categories" })}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <input
                type="search"
                aria-label="Rechercher un produit"
                placeholder="Recherche"
                value={search}
                onChange={(event) => void load(event.target.value)}
                className="w-64 rounded-md border border-line-strong bg-bg px-3 py-2 text-[14px] text-fg transition-[border-color,box-shadow] outline-none placeholder:text-fg-faint focus:border-accent"
              />
              <ArchiveFilter
                archived={showArchived}
                onChange={(archived) => void load(search, archived)}
              />
              {lowCount > 0 && !showArchived && (
                <button
                  type="button"
                  aria-pressed={lowFilter}
                  onClick={() => setLowOnly(!lowFilter)}
                  className={[
                    "inline-flex items-center rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                    lowFilter
                      ? "bg-warning/20 text-fg"
                      : "border border-warning/50 text-warning hover:bg-warning/10",
                  ].join(" ")}
                >
                  <span aria-hidden="true" className="mr-1">
                    ⚠︎
                  </span>
                  Stock bas ({lowCount})
                </button>
              )}
            </div>
            {!showArchived && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setView({ kind: "lot-form", from: list })}
                  className={btnGhost}
                >
                  Ajouter un lot
                </button>
                <button
                  type="button"
                  onClick={() => setView({ kind: "editor", from: list })}
                  className={btnPrimary}
                >
                  Ajouter un produit
                </button>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}

          {lowStock.categories.length > 0 && (
            <section
              aria-label="Stock bas au total"
              className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
            >
              <ul className="flex flex-col gap-1 text-[13px] text-fg">
                {lowStock.categories.map((alert) => (
                  <li key={alert.categoryId}>
                    <span aria-hidden="true">⚠︎ </span>
                    <span className="font-medium">{alert.path}</span> : {alert.stock} au total
                    (alerte à {alert.threshold} ou moins, {alert.sheetCount} fiche
                    {alert.sheetCount > 1 ? "s" : ""}).
                  </li>
                ))}
              </ul>
            </section>
          )}

          {shownUnattached.length > 0 && (
            <section
              aria-labelledby="unattached-title"
              className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4"
            >
              <div>
                <h2 id="unattached-title" className="text-[14px] font-medium text-fg">
                  <span aria-hidden="true">⚠︎ </span>
                  {shownUnattached.length} lot{shownUnattached.length > 1 ? "s" : ""} sans fiche
                  produit
                </h2>
                <p className="mt-0.5 text-[12.5px] text-fg-muted">
                  Reçus avant les fiches produit. Ouvre un lot pour créer sa fiche (ses homonymes
                  peuvent y être rattachés en même temps) ou en choisir une.
                </p>
              </div>
              <ul className={`${cardClass} divide-y divide-line overflow-hidden`}>
                {shownUnattached.map((lot) => (
                  <li key={lot.id}>
                    <LotRow
                      lot={lot}
                      title={lot.name}
                      onOpen={() => setView({ kind: "lot", lot, from: list })}
                    >
                      Lot {lot.lotNumber} · exp. {formatIsoDate(lot.expirationDate)}
                    </LotRow>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!loading && shownCount === 0 ? (
            <div className={`${cardClass} px-5 py-10 text-center`}>
              <p className="text-[14px] text-fg-muted">{emptyText}</p>
              {!search && !showArchived && (
                <button
                  type="button"
                  onClick={() => setView({ kind: "editor", from: list })}
                  className={`${btnGhost} mt-4`}
                >
                  {filterLabel ? "Ajouter un produit ici" : "Ajouter un produit"}
                </button>
              )}
            </div>
          ) : (
            shownSheets.length > 0 && (
              <DataTable
                label="Produits"
                columns={columns}
                rows={shownSheets}
                rowKey={(sheet) => sheet.id}
                rowLabel={(sheet) => sheet.displayName}
                pageResetKey={`${search}|${showArchived}|${activeFilter.kind}|${activeFilter.kind === "category" ? activeFilter.id : ""}|${lowFilter}`}
                onRowClick={(sheet) => setView({ kind: "editor", sheet, from: list })}
                rowActions={(sheet) => [
                  {
                    id: "open",
                    label: "Ouvrir",
                    onSelect: () => setView({ kind: "editor", sheet, from: list }),
                  },
                  ...(sheet.archivedAt
                    ? []
                    : [
                        {
                          id: "receive",
                          label: "Ajouter un lot",
                          onSelect: () =>
                            setView({ kind: "lot-form", sheetId: sheet.id, from: list }),
                        },
                      ]),
                ]}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}
