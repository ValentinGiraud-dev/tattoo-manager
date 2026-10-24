import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, cardClass, fieldClass } from "../../components/styles";
import { ArchiveFilter } from "../../components/archive-controls";
import { matchesFilter, type CategoryFilter } from "../../lib/categories";
import { formatIsoDate } from "../../lib/format";
import { useProductsStore, type LotSummary, type ProductSheet } from "../../stores/products-store";
import { useUIStore } from "../../stores/ui-store";
import { CategoryManager } from "./category-manager";
import { CategoryTree } from "./category-tree";
import { LotDetail } from "./lot-detail";
import { LotForm } from "./lot-form";
import { LotRow, SheetRow } from "./lot-row";
import { SheetDetail } from "./sheet-detail";
import { SheetForm } from "./sheet-form";

/**
 * Écran courant de Produits. `from` : écran à rouvrir au retour (navigation
 * interne fiche ↔ lot ↔ formulaire).
 */
type View =
  | { kind: "list" }
  | { kind: "categories" }
  | { kind: "sheet"; sheet: ProductSheet; from?: View }
  | {
      kind: "sheet-form";
      sheet?: ProductSheet;
      fromLot?: LotSummary;
      /** Créée depuis une réception : on y revient avec la nouvelle fiche. */
      thenReceive?: boolean;
      from: View;
    }
  | { kind: "lot"; lot: LotSummary; from?: View }
  | { kind: "lot-form"; lot?: LotSummary; sheetId?: string | null; from: View };

function backLabel(view: View | undefined): string | undefined {
  if (!view) return undefined;
  if (view.kind === "sheet") return view.sheet.displayName;
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
      .then((sheet) => setView({ kind: "sheet", sheet }))
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
      .then((sheet) => setView({ kind: "sheet", sheet, from }))
      .catch(() => setView({ kind: "list" }));
  }

  /** Retour vers une vue mémorisée, avec des données relues. */
  function returnTo(target: View | undefined) {
    if (target?.kind === "sheet") openSheet(target.sheet.id, target.from);
    else if (target?.kind === "lot") {
      void getLot(target.lot.id)
        .then((lot) => setView({ kind: "lot", lot, from: target.from }))
        .catch(() => setView({ kind: "list" }));
    } else setView(target ?? { kind: "list" });
  }

  if (view.kind === "categories") {
    return <CategoryManager onBack={() => setView({ kind: "list" })} />;
  }

  if (view.kind === "sheet-form") {
    return (
      <SheetForm
        sheet={view.sheet}
        fromLot={view.fromLot}
        defaultCategoryId={defaultCategoryId}
        onDone={(saved) => {
          if (!saved) returnTo(view.from);
          else if (view.thenReceive && view.from.kind === "lot-form") {
            setView({ ...view.from, sheetId: saved.id });
          } else {
            // Modifiée depuis sa fiche : on y revient avec l'écran d'avant la fiche.
            const from = view.from.kind === "sheet" ? view.from.from : undefined;
            setView({ kind: "sheet", sheet: saved, from });
          }
        }}
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
        onNewSheet={() => setView({ kind: "sheet-form", thenReceive: true, from: view })}
        onDone={(saved) =>
          saved ? setView({ kind: "lot", lot: saved, from: view.from }) : returnTo(view.from)
        }
      />
    );
  }

  if (view.kind === "sheet") {
    return (
      <SheetDetail
        sheet={view.sheet}
        backLabel={backLabel(view.from)}
        onBack={() => returnTo(view.from)}
        onEdit={() => setView({ kind: "sheet-form", sheet: view.sheet, from: view })}
        onReceive={() => setView({ kind: "lot-form", sheetId: view.sheet.id, from: view })}
        onOpenLot={(lot) => setView({ kind: "lot", lot, from: view })}
        onChanged={(sheet) => setView({ kind: "sheet", sheet, from: view.from })}
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
        onCreateSheet={(lot) => setView({ kind: "sheet-form", fromLot: lot, from: view })}
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

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 items-start gap-8 px-8 py-10 md:grid-cols-[14rem_minmax(0,1fr)]">
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
          <div>
            <h1 className="text-[24px] font-medium tracking-tight">{filterLabel ?? "Produits"}</h1>
            <p className="mt-1 text-[13px] text-fg-muted">
              {loading ? "Chargement…" : `${shownCount} produit${shownCount === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ArchiveFilter
              archived={showArchived}
              onChange={(archived) => void load(search, archived)}
            />
            {!showArchived && (
              <>
                {lowCount > 0 && (
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
                <button
                  type="button"
                  onClick={() => setView({ kind: "sheet-form", from: list })}
                  className={btnGhost}
                >
                  Nouvelle fiche produit
                </button>
                <button
                  type="button"
                  onClick={() => setView({ kind: "lot-form", from: list })}
                  className={btnPrimary}
                >
                  Recevoir un lot
                </button>
              </>
            )}
          </div>
        </div>

        <input
          type="search"
          aria-label="Rechercher un produit"
          placeholder="Rechercher (nom, marque, numéro de lot)…"
          value={search}
          onChange={(event) => void load(event.target.value)}
          className={fieldClass}
        />

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
                  <span className="font-medium">{alert.path}</span> : {alert.stock} au total (alerte
                  à {alert.threshold} ou moins, {alert.sheetCount} fiche
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
                onClick={() => setView({ kind: "sheet-form", from: list })}
                className={`${btnGhost} mt-4`}
              >
                {filterLabel ? "Ajouter un produit ici" : "Créer la première fiche produit"}
              </button>
            )}
          </div>
        ) : (
          shownSheets.length > 0 && (
            <ul className={`${cardClass} divide-y divide-line overflow-hidden`}>
              {shownSheets.map((sheet) => (
                <li key={sheet.id}>
                  <SheetRow
                    sheet={sheet}
                    showCategory={
                      !(activeFilter.kind === "category" && sheet.categoryId === activeFilter.id)
                    }
                    onOpen={() => setView({ kind: "sheet", sheet })}
                  />
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}
