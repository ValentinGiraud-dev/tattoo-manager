import { useState, type FormEvent, type ReactNode } from "react";
import { PAYMENT_METHOD_LABELS } from "../lib/labels";
import { centsToInput, parseEuros } from "../lib/money";
import { todayIso, type PaymentMethod } from "../stores/billing-store";
import { btnGhost, btnPrimary, fieldClass, labelClass } from "./styles";

const METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

export type MoneyDraft = {
  amountCents: number;
  method: PaymentMethod;
  date: string;
  note: string | null;
};

/** Saisie d'un montant encaissé (paiement ou acompte). */
export function MoneyForm({
  title,
  submitLabel,
  initialCents,
  extra,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  initialCents: number | null;
  extra?: ReactNode;
  onSubmit: (draft: MoneyDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(centsToInput(initialCents));
  const [method, setMethod] = useState<PaymentMethod>("CARD");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = parseEuros(amount);
    if (cents === null || cents <= 0) {
      setError("Indique un montant en euros, par exemple 80 ou 80,50");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ amountCents: cents, method, date, note: note.trim() || null });
    } catch (submitError) {
      setError(String(submitError));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3 rounded-md border border-line-strong bg-surface-2 p-3"
    >
      <p className="text-[13px] font-medium">{title}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Montant (€) *
          <input
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Mode
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            className={fieldClass}
          >
            {METHODS.map((value) => (
              <option key={value} value={value}>
                {PAYMENT_METHOD_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Date
          <input
            type="date"
            max={todayIso()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={fieldClass}
          />
        </label>
      </div>
      {extra}
      <label className={labelClass}>
        Note
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optionnel"
          className={fieldClass}
        />
      </label>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? "Enregistrement…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>
          Annuler
        </button>
      </div>
    </form>
  );
}
