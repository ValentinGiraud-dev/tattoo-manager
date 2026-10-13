import { useEffect, useState, type FormEvent } from "react";
import { DateSelector } from "../../components/date-selector";
import {
  useProductsStore,
  type Product,
  type ProductInput,
  type ProductSessionItem,
} from "../../stores/products-store";

type View =
  | { kind: "list" }
  | { kind: "form"; product?: Product }
  | { kind: "detail"; product: Product };

const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim());

const fieldClass =
  "mt-1.5 w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-[14px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-faint focus:border-accent";
const labelClass = "block text-[12.5px] font-medium text-fg-muted";
const btnPrimary =
  "inline-flex items-center rounded-pill bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-fg transition-[filter] hover:brightness-110 disabled:opacity-45";
const btnGhost =
  "inline-flex items-center rounded-pill border border-line-strong px-3.5 py-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg";

const STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planifiée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  RESCHEDULED: "Reportée",
};

function formatIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTimestamp(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function addMonthsIso(iso: string, months: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setMonth(date.getMonth() + months);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Limite utile = plus proche entre expiration et (ouverture + durée). */
function usefulUntil(product: Product): string {
  let limit = product.expirationDate;
  if (product.openedAt && product.afterOpeningMonths) {
    const afterOpen = addMonthsIso(product.openedAt, product.afterOpeningMonths);
    if (afterOpen && afterOpen < limit) limit = afterOpen;
  }
  return limit;
}

function ProductForm({
  product,
  onDone,
}: {
  product?: Product;
  onDone: (saved?: Product) => void;
}) {
  const { create, update } = useProductsStore();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creationDate, setCreationDate] = useState<string | null>(product?.creationDate ?? null);
  const [openedAt, setOpenedAt] = useState<string | null>(product?.openedAt ?? null);
  const [expirationDate, setExpirationDate] = useState<string | null>(
    product?.expirationDate ?? null,
  );
  const [singleUse, setSingleUse] = useState(product?.singleUse ?? true);
  const currentYear = new Date().getFullYear();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    if (!expirationDate) {
      setError("La date d'expiration est obligatoire");
      return;
    }
    const monthsRaw = text("afterOpeningMonths").trim();
    let afterOpeningMonths: number | null = null;
    if (monthsRaw !== "") {
      const months = Number(monthsRaw);
      if (!Number.isInteger(months) || months <= 0) {
        setError("La durée après ouverture doit être un nombre de mois positif");
        return;
      }
      afterOpeningMonths = months;
    }
    const input: ProductInput = {
      name: text("name").trim(),
      lotNumber: text("lotNumber").trim(),
      creationDate,
      openedAt,
      expirationDate,
      afterOpeningMonths,
      singleUse,
      productUrl: emptyToNull(text("productUrl")),
    };
    if (!input.name) {
      setError("Le nom est obligatoire");
      return;
    }
    if (!input.lotNumber) {
      setError("Le numéro de lot est obligatoire");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = product ? await update(product.id, input) : await create(input);
      onDone(saved);
    } catch (submitError) {
      setError(String(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="mx-auto flex max-w-xl flex-col gap-4 px-8 py-10"
    >
      <div>
        <button
          type="button"
          onClick={() => onDone()}
          className="mb-4 text-[13px] text-fg-muted hover:text-fg"
        >
          ← Retour
        </button>
        <h1 className="text-[24px] font-medium tracking-tight">
          {product ? "Modifier le produit" : "Nouveau produit"}
        </h1>
      </div>

      <label className={labelClass}>
        Nom *
        <input
          name="name"
          required
          defaultValue={product?.name ?? ""}
          placeholder="Ex. Encre noire, aiguille 3RL"
          className={fieldClass}
        />
      </label>

      <label className={labelClass}>
        Numéro de lot *
        <input
          name="lotNumber"
          required
          defaultValue={product?.lotNumber ?? ""}
          className={fieldClass}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>Type *</legend>
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => setSingleUse(true)}
            className={[
              "rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              singleUse
                ? "bg-accent text-accent-fg"
                : "border border-line-strong text-fg-muted hover:bg-surface-3",
            ].join(" ")}
          >
            Usage unique (aiguille)
          </button>
          <button
            type="button"
            onClick={() => setSingleUse(false)}
            className={[
              "rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              !singleUse
                ? "bg-accent text-accent-fg"
                : "border border-line-strong text-fg-muted hover:bg-surface-3",
            ].join(" ")}
          >
            Réutilisable (encre)
          </button>
        </div>
      </fieldset>

      <div>
        <label htmlFor="product-expiration" className={labelClass}>
          Date d&apos;expiration *
        </label>
        <DateSelector
          id="product-expiration"
          value={expirationDate}
          onChange={setExpirationDate}
          placeholder="Choisir la date d'expiration"
          minYear={currentYear - 5}
          maxYear={currentYear + 20}
        />
      </div>

      <div>
        <label htmlFor="product-creation" className={labelClass}>
          Date de fabrication
        </label>
        <DateSelector
          id="product-creation"
          value={creationDate}
          onChange={setCreationDate}
          placeholder="Optionnel"
          minYear={currentYear - 20}
          maxYear={currentYear + 1}
        />
      </div>

      <div>
        <label htmlFor="product-opened" className={labelClass}>
          Ouvert le
        </label>
        <DateSelector
          id="product-opened"
          value={openedAt}
          onChange={setOpenedAt}
          placeholder="Jamais ouvert si vide"
          minYear={currentYear - 10}
          maxYear={currentYear + 1}
        />
      </div>

      <label className={labelClass}>
        Durée après ouverture (mois)
        <input
          name="afterOpeningMonths"
          type="number"
          min={1}
          step={1}
          defaultValue={product?.afterOpeningMonths ?? ""}
          placeholder="Ex. 12"
          className={fieldClass}
        />
      </label>

      <label className={labelClass}>
        URL produit
        <input
          name="productUrl"
          type="url"
          defaultValue={product?.productUrl ?? ""}
          placeholder="https://…"
          className={fieldClass}
        />
      </label>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" onClick={() => onDone()} className={btnGhost}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function ProductDetail({
  product,
  onEdit,
  onBack,
}: {
  product: Product;
  onEdit: () => void;
  onBack: () => void;
}) {
  const listSessions = useProductsStore((state) => state.listSessions);
  const [sessions, setSessions] = useState<ProductSessionItem[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setSessionsLoading(true);
    void listSessions(product.id)
      .then((items) => {
        if (!cancelled) {
          setSessions(items);
          setSessionsError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setSessionsError(String(error));
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listSessions, product.id]);

  const rows: [string, string | null][] = [
    ["Lot", product.lotNumber],
    ["Type", product.singleUse ? "Usage unique" : "Réutilisable"],
    ["Expiration", formatIsoDate(product.expirationDate)],
    ["Limite utile", formatIsoDate(usefulUntil(product))],
    ["Fabrication", product.creationDate ? formatIsoDate(product.creationDate) : null],
    ["Ouvert le", product.openedAt ? formatIsoDate(product.openedAt) : "Jamais ouvert"],
    [
      "Après ouverture",
      product.afterOpeningMonths != null ? `${product.afterOpeningMonths} mois` : null,
    ],
    ["URL", product.productUrl],
    ["Créé le", formatTimestamp(product.createdAt)],
    ["Modifié le", formatTimestamp(product.updatedAt)],
  ];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-8 py-10">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-[13px] text-fg-muted hover:text-fg"
      >
        ← Produits
      </button>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[12px] text-fg-faint">
            {product.singleUse ? "Usage unique" : "Réutilisable"}
          </p>
          <h1 className="text-[24px] font-medium tracking-tight">{product.name}</h1>
          <p className="mt-1 text-[13px] text-fg-muted">Lot {product.lotNumber}</p>
        </div>
        <button type="button" onClick={onEdit} className={btnPrimary}>
          Modifier
        </button>
      </div>

      <dl className="grid gap-3 rounded-lg border border-line bg-surface p-4">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 text-[13.5px]">
            <dt className="text-fg-faint">{label}</dt>
            <dd className="break-all whitespace-pre-wrap text-fg">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      <section>
        <h2 className="mb-2 text-[14px] font-medium">Séances liées</h2>
        <p className="mb-3 text-[12.5px] text-fg-muted">
          Traçabilité : chaque lien reste enregistré.
        </p>
        {sessionsError && <p className="text-[13px] text-danger">{sessionsError}</p>}
        {sessionsLoading ? (
          <p className="text-[13px] text-fg-muted">Chargement…</p>
        ) : sessions.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[13px] text-fg-muted">
            Aucune séance pour ce produit.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-line bg-surface">
            {sessions.map((item, index) => (
              <li
                key={`${item.sessionId}-${item.createdAt}`}
                className={index > 0 ? "border-t border-line px-4 py-3" : "px-4 py-3"}
              >
                <p className="text-[14px] font-medium">
                  {item.clientFirstName} {item.clientLastName}
                </p>
                <p className="mt-0.5 text-[12.5px] text-fg-muted">
                  {formatIsoDate(item.date)}
                  {item.bodyArea ? ` · ${item.bodyArea}` : ""}
                  {" · "}
                  {STATUS_LABELS[item.status] ?? item.status}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ProductsPage() {
  const { products, search, loading, error, load } = useProductsStore();
  const [view, setView] = useState<View>({ kind: "list" });

  useEffect(() => {
    void load("");
  }, [load]);

  if (view.kind === "form") {
    return (
      <ProductForm
        product={view.product}
        onDone={(saved) =>
          setView(
            saved
              ? { kind: "detail", product: saved }
              : view.product
                ? { kind: "detail", product: view.product }
                : { kind: "list" },
          )
        }
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <ProductDetail
        product={view.product}
        onEdit={() => setView({ kind: "form", product: view.product })}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-medium tracking-tight">Produits</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {loading
              ? "Chargement…"
              : `${products.length} produit${products.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button type="button" onClick={() => setView({ kind: "form" })} className={btnPrimary}>
          Nouveau produit
        </button>
      </div>

      <input
        type="search"
        placeholder="Rechercher (nom, lot)…"
        value={search}
        onChange={(event) => void load(event.target.value)}
        className={fieldClass}
      />

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {!loading && products.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-5 py-10 text-center">
          <p className="text-[14px] text-fg-muted">
            {search ? "Aucun résultat." : "Aucun produit pour le moment."}
          </p>
          {!search && (
            <button
              type="button"
              onClick={() => setView({ kind: "form" })}
              className={`${btnGhost} mt-4`}
            >
              Créer le premier produit
            </button>
          )}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {products.map((product, index) => (
            <li key={product.id} className={index > 0 ? "border-t border-line" : undefined}>
              <button
                type="button"
                onClick={() => setView({ kind: "detail", product })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[14px] font-medium">{product.name}</span>
                    <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-[11px] text-fg-muted">
                      {product.singleUse ? "Unique" : "Encre"}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-fg-muted">
                    Lot {product.lotNumber} · exp. {formatIsoDate(product.expirationDate)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
