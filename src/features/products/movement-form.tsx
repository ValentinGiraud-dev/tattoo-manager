import { useState, type FormEvent } from "react";
import { btnPrimary, fieldClass, labelClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { useProductsStore, type LotSummary } from "../../stores/products-store";
import { toast } from "../../stores/toast-store";
import { MOVEMENT_ARTICLE, MOVEMENT_LABELS, emptyToNull } from "./lot-labels";

/** Mouvement manuel d'un lot à usage unique (réception, perte, ajustement…). */
export function MovementForm({
  lot,
  onSaved,
}: {
  lot: LotSummary;
  onSaved: (lot: LotSummary) => void;
}) {
  const recordMovement = useProductsStore((state) => state.recordMovement);
  const confirm = useConfirm();
  const [movementType, setMovementType] = useState("PURCHASE");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty === 0 || (movementType !== "ADJUSTMENT" && qty < 0)) {
      setError(
        movementType === "ADJUSTMENT"
          ? "L'ajustement est un nombre non nul, négatif pour retirer"
          : "La quantité doit être un nombre positif",
      );
      return;
    }
    if (movementType !== "PURCHASE") {
      const signed = movementType === "ADJUSTMENT" ? qty : -qty;
      const ok = await confirm({
        title: `Enregistrer ${MOVEMENT_ARTICLE[movementType] ?? "ce mouvement"} ?`,
        details: [
          `${lot.name} · lot ${lot.lotNumber}`,
          `${MOVEMENT_LABELS[movementType] ?? movementType} : ${signed > 0 ? `+${signed}` : signed}`,
          `Stock actuel : ${lot.stock}`,
          ...(reason.trim() ? [`Raison : ${reason.trim()}`] : []),
        ],
        body: "Le mouvement s'ajoute à l'historique du lot. Pour le corriger, il faudra l'annuler par un mouvement inverse.",
        confirmLabel: "Enregistrer le mouvement",
        cancelLabel: "Retour",
        tone: signed < 0 ? "danger" : "default",
      });
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await recordMovement({
        lotId: lot.id,
        movementType,
        quantity: qty,
        reason: emptyToNull(reason),
      });
      setReason("");
      toast.success("Mouvement enregistré");
      onSaved(saved);
    } catch (submitError) {
      setError(String(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <h2 className="text-[14px] font-medium">Mouvement de stock</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Type
          <select
            value={movementType}
            onChange={(event) => setMovementType(event.target.value)}
            className={fieldClass}
          >
            <option value="PURCHASE">Réception</option>
            <option value="LOSS">Perte</option>
            <option value="EXPIRATION">Péremption</option>
            <option value="RETURN">Retour</option>
            <option value="ADJUSTMENT">Ajustement</option>
          </select>
        </label>
        <label className={labelClass}>
          Quantité
          <input
            type="number"
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className={fieldClass}
          />
        </label>
      </div>
      <label className={labelClass}>
        Raison {movementType === "ADJUSTMENT" ? "*" : ""}
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required={movementType === "ADJUSTMENT"}
          placeholder={movementType === "ADJUSTMENT" ? "Ex. comptage" : "Optionnel"}
          className={fieldClass}
        />
      </label>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <button type="submit" disabled={saving} className={`${btnPrimary} self-start`}>
        {saving ? "Enregistrement…" : "Enregistrer le mouvement"}
      </button>
    </form>
  );
}
