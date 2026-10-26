import { useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cardClass } from "../../components/styles";
import { expiryAlertLabel } from "../../lib/expiry-alert";
import { formatTimestamp } from "../../lib/format";
import { sheetThresholdLabel } from "../../lib/low-stock";
import { sheetStockLabel, sheetTypeLabel } from "../../lib/product-sheets";
import type { ProductSheet } from "../../stores/products-store";
import { PencilIcon, TrashIcon } from "./lot-row";

const iconButtonClass =
  "grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-45";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 text-[13.5px]">
      <dt className="text-fg-faint">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

/** Fiche produit en lecture : les champs, le crayon et la corbeille. */
export function SheetFacts({
  sheet,
  busy,
  onEdit,
  onRemove,
}: {
  sheet: ProductSheet;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const archived = sheet.archivedAt != null;
  const [linkError, setLinkError] = useState<string | null>(null);

  async function openLink() {
    const url = sheet.productUrl;
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setLinkError("Ce lien n'est pas une adresse web.");
      return;
    }
    try {
      await openUrl(url);
      setLinkError(null);
    } catch {
      setLinkError("Le lien n'a pas pu être ouvert.");
    }
  }

  return (
    <section className={cardClass}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-[15px] font-medium">{sheet.displayName}</p>
        {!archived && (
          <>
            <button
              type="button"
              aria-label="Modifier la fiche"
              onClick={onEdit}
              disabled={busy}
              className={iconButtonClass}
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              aria-label="Supprimer ou archiver la fiche"
              onClick={onRemove}
              disabled={busy}
              className="grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-45"
            >
              <TrashIcon />
            </button>
          </>
        )}
      </div>
      <dl className="grid gap-3 p-4">
        <Fact label="Marque">{sheet.brand ?? "—"}</Fact>
        <Fact label="Catégorie">{sheet.categoryPath ?? "—"}</Fact>
        <Fact label="Type">{sheetTypeLabel(sheet)}</Fact>
        <Fact label="Stock total">{sheetStockLabel(sheet)}</Fact>
        <Fact label="Stock bas">{sheetThresholdLabel(sheet)}</Fact>
        <Fact label="Expiration">{expiryAlertLabel(sheet.expiryWarningDays)}</Fact>
        <Fact label="Lien">
          {sheet.productUrl ? (
            <button
              type="button"
              onClick={() => void openLink()}
              className="text-left break-all underline-offset-2 hover:underline"
            >
              {sheet.productUrl}
            </button>
          ) : (
            "—"
          )}
          {linkError && (
            <span role="alert" className="mt-1 block text-[12.5px] text-danger">
              {linkError}
            </span>
          )}
        </Fact>
        <Fact label="Créée le">{formatTimestamp(sheet.createdAt)}</Fact>
      </dl>
    </section>
  );
}
