import { useState, type FormEvent } from "react";
import { btnGhost, btnPrimary, cardClass, fieldClass } from "../../components/styles";
import { InfoTip } from "../../components/info-tip";
import { useConfirm } from "../../components/use-confirm";
import { possibleParents } from "../../lib/categories";
import { categoryAlertLabel } from "../../lib/low-stock";
import { useProductsStore, type Category, type LowStockSetting } from "../../stores/products-store";
import { toast } from "../../stores/toast-store";
import { LowStockForm } from "./category-low-stock-form";

type Editing =
  | { kind: "add"; parentId: string | null }
  | { kind: "rename"; id: string }
  | { kind: "alert"; id: string }
  | null;

const ROOT = "__racine__";

function NameForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === "") {
      setError("Le nom de la catégorie est obligatoire");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (submitError) {
      setError(String(submitError));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1.5 py-1.5">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
          aria-label="Nom de la catégorie"
          placeholder="Ex. Aiguilles, RL, Encres noires"
          maxLength={60}
          className={`${fieldClass} mt-0 flex-1 py-1.5`}
        />
        <button type="submit" disabled={busy} className={btnPrimary}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={btnGhost}>
          Annuler
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count > 1 ? many : one}`;
}

/** Création, renommage, déplacement et suppression des catégories de produits. */
export function CategoryManager({ onBack }: { onBack: () => void }) {
  const {
    categories,
    categoriesError,
    createCategory,
    updateCategory,
    deleteCategory,
    setCategoryLowStock,
  } = useProductsStore();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(categories.map((category) => [category.id, category]));
  const parentLabel = (category: Category) =>
    category.parentId ? `« ${byId.get(category.parentId)?.path ?? "…"} »` : null;

  async function add(name: string, parentId: string | null) {
    const created = await createCategory({ name, parentId });
    toast.success(`Catégorie « ${created.path} » créée`);
    setEditing(null);
  }

  async function rename(category: Category, name: string) {
    await updateCategory(category.id, { name, parentId: category.parentId });
    toast.success("Catégorie renommée");
    setEditing(null);
  }

  async function saveAlert(category: Category, setting: LowStockSetting) {
    await setCategoryLowStock(category.id, setting);
    toast.success(setting.mode ? "Seuil de stock bas enregistré" : "Alerte de stock bas retirée");
    setEditing(null);
  }

  async function move(category: Category) {
    const parents = possibleParents(categories, category.id);
    const result = await confirm({
      title: `Déplacer « ${category.name} » ?`,
      body: "La catégorie part avec ses sous-catégories et ses produits.",
      choices: [
        { value: ROOT, label: "Au premier niveau" },
        ...parents.map((parent) => ({ value: parent.id, label: parent.path })),
      ],
      defaultChoice: category.parentId ?? ROOT,
      confirmLabel: "Déplacer",
      cancelLabel: "Annuler",
    });
    if (!result?.choice) return;
    const parentId = result.choice === ROOT ? null : result.choice;
    if (parentId === category.parentId) return;
    setError(null);
    try {
      const moved = await updateCategory(category.id, { name: category.name, parentId });
      toast.success(`Catégorie déplacée : ${moved.path}`);
    } catch (moveError) {
      setError(String(moveError));
    }
  }

  async function remove(category: Category) {
    const destination = parentLabel(category) ?? "le premier niveau";
    const lotsDestination = parentLabel(category) ?? "« Sans catégorie »";
    const details = [
      category.childCount > 0
        ? `${plural(category.childCount, "sous-catégorie remonte", "sous-catégories remontent")} dans ${destination}`
        : null,
      category.lotCount > 0
        ? `${plural(category.lotCount, "produit passe", "produits passent")} dans ${lotsDestination}`
        : null,
    ].filter((line): line is string => line !== null);
    const ok = await confirm({
      title: `Supprimer la catégorie « ${category.path} » ?`,
      details: details.length > 0 ? details : undefined,
      body:
        details.length > 0
          ? "Aucun produit n'est supprimé : seul le rangement change."
          : "Elle est vide : rien d'autre ne change.",
      confirmLabel: "Supprimer la catégorie",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      await deleteCategory(category.id);
      toast.success("Catégorie supprimée");
    } catch (deleteError) {
      setError(String(deleteError));
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-10">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-[13px] text-fg-muted hover:text-fg"
      >
        ← Produits
      </button>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-1">
          <h1 className="text-[24px] font-medium tracking-tight">Catégories</h1>
          <InfoTip label="Catégories">
            Rangez les produits sur autant de niveaux que vous voulez : Encres, Aiguilles › RL…
          </InfoTip>
        </div>
        {!(editing?.kind === "add" && editing.parentId === null) ? (
          <button
            type="button"
            onClick={() => setEditing({ kind: "add", parentId: null })}
            className={btnPrimary}
          >
            Nouvelle catégorie
          </button>
        ) : null}
      </div>

      {(error ?? categoriesError) && (
        <p role="alert" className="text-[13px] text-danger">
          {error ?? categoriesError}
        </p>
      )}

      {editing?.kind === "add" && editing.parentId === null && (
        <div className={`${cardClass} px-4 py-2`}>
          <NameForm
            initial=""
            submitLabel="Créer"
            onSubmit={(name) => add(name, null)}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {categories.length === 0 ? (
        editing?.kind !== "add" && (
          <div className={`${cardClass} px-5 py-10 text-center`}>
            <p className="text-[14px] text-fg-muted">Aucune catégorie pour le moment.</p>
            <button
              type="button"
              onClick={() => setEditing({ kind: "add", parentId: null })}
              className={`${btnGhost} mt-4`}
            >
              Créer la première catégorie
            </button>
          </div>
        )
      ) : (
        <ul className={`${cardClass} divide-y divide-line`}>
          {categories.map((category) => (
            <li key={category.id} className="px-4 py-2">
              <div style={{ paddingLeft: `${category.depth * 20}px` }}>
                {editing?.kind === "rename" && editing.id === category.id ? (
                  <NameForm
                    initial={category.name}
                    submitLabel="Renommer"
                    onSubmit={(name) => rename(category, name)}
                    onCancel={() => setEditing(null)}
                  />
                ) : editing?.kind === "alert" && editing.id === category.id ? (
                  <LowStockForm
                    category={category}
                    onSubmit={(setting) => saveAlert(category, setting)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
                    <span className="min-w-0 flex-1">
                      <span className="text-[14px] text-fg">
                        {category.depth > 0 && (
                          <span aria-hidden="true" className="mr-1.5 text-fg-faint">
                            ↳
                          </span>
                        )}
                        <span>{category.name}</span>
                      </span>
                      <span className="ml-2 text-[12px] text-fg-faint">
                        {plural(category.totalLotCount, "produit", "produits")}
                      </span>
                      {categoryAlertLabel(category) && (
                        <span className="mt-0.5 block text-[12px] text-fg-muted">
                          {categoryAlertLabel(category)}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing({ kind: "add", parentId: category.id })}
                        className="rounded-sm px-2 py-1 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                      >
                        + Sous-catégorie
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing({ kind: "alert", id: category.id })}
                        className="rounded-sm px-2 py-1 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                      >
                        Stock bas…
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing({ kind: "rename", id: category.id })}
                        className="rounded-sm px-2 py-1 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                      >
                        Renommer
                      </button>
                      <button
                        type="button"
                        onClick={() => void move(category)}
                        className="rounded-sm px-2 py-1 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                      >
                        Déplacer…
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(category)}
                        className="rounded-sm px-2 py-1 text-[12.5px] text-danger hover:bg-surface-2"
                      >
                        Supprimer…
                      </button>
                    </span>
                  </div>
                )}
                {editing?.kind === "add" && editing.parentId === category.id && (
                  <div style={{ paddingLeft: "20px" }}>
                    <NameForm
                      initial=""
                      submitLabel="Créer"
                      onSubmit={(name) => add(name, category.id)}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
