import type { ConfirmFn } from "../../components/use-confirm";
import { formatIsoDate } from "../../lib/format";
import { SESSION_STATUS_LABELS } from "../../lib/labels";
import { formatEuros } from "../../lib/money";
import { useBillingStore } from "../../stores/billing-store";
import type { SessionListItem } from "../../stores/sessions-store";

/** Confirmation avant d'enregistrer une annulation ou une absence. */
export async function confirmClosingStatus(
  confirm: ConfirmFn,
  status: "CANCELLED" | "NO_SHOW",
  clientName: string,
  date: string,
  startTime: string | null,
): Promise<boolean> {
  const result = await confirm({
    title:
      status === "NO_SHOW"
        ? "Marquer le client comme absent ?"
        : "Marquer cette séance comme annulée ?",
    details: [clientName, formatIsoDate(date), ...(startTime ? [startTime] : [])],
    body: `La séance reste dans l'historique avec le statut « ${SESSION_STATUS_LABELS[status]} ».`,
    confirmLabel: status === "NO_SHOW" ? "Marquer absent" : "Annuler la séance",
    cancelLabel: "Retour",
    tone: "danger",
  });
  return result !== null;
}

/** Après une absence ou une annulation : que devient l'acompte en attente ? */
export async function settleHeldDeposits(confirm: ConfirmFn, saved: SessionListItem) {
  if (saved.status !== "CANCELLED" && saved.status !== "NO_SHOW") return;
  const billing = useBillingStore.getState();
  const bill = await billing.sessionBilling(saved.id);
  const held = bill.deposits.filter((deposit) => deposit.status === "HELD");
  if (held.length === 0) return;
  const total = held.reduce((sum, deposit) => sum + deposit.amountCents, 0);
  const event =
    saved.status === "NO_SHOW"
      ? `Absence du ${formatIsoDate(saved.date)}`
      : `Annulation de la séance du ${formatIsoDate(saved.date)}`;
  const result = await confirm({
    title: "Que devient l'acompte ?",
    details: held.map(
      (deposit) =>
        `${formatEuros(deposit.amountCents)} versé le ${formatIsoDate(deposit.receivedOn)}${deposit.projectTitle ? ` · ${deposit.projectTitle}` : ""}`,
    ),
    body: `${event}. ${held.length > 1 ? `Ces acomptes (${formatEuros(total)}) sont` : "Cet acompte est"} encore en attente.`,
    choices: [
      {
        value: "KEEP",
        label: "Le garder en attente",
        description: "Il pourra être déduit d'une prochaine séance.",
      },
      {
        value: "FORFEITED",
        label: "Acompte perdu",
        description: "Conservé par l'atelier ; il ne sera plus déduit.",
      },
      { value: "REFUNDED", label: "Le rembourser", description: "Rendu au client." },
    ],
    confirmLabel: "Valider",
    cancelLabel: "Décider plus tard",
  });
  if (!result || result.choice === "KEEP" || result.choice === null) return;
  const outcome = result.choice as "FORFEITED" | "REFUNDED";
  for (const deposit of held) {
    await billing.settleDeposit({
      depositId: deposit.id,
      outcome,
      sessionId: saved.id,
      reason: event,
    });
  }
}
