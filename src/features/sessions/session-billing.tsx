import { useEffect, useState } from "react";
import { MoneyForm } from "../../components/money-form";
import { btnGhost, btnPrimary, cardClass, labelClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { formatIsoDate } from "../../lib/format";
import { PAYMENT_METHOD_LABELS } from "../../lib/labels";
import { formatEuros } from "../../lib/money";
import {
  useBillingStore,
  type BillingState,
  type Deposit,
  type Payment,
  type SessionBilling as Billing,
} from "../../stores/billing-store";
import type { SessionListItem } from "../../stores/sessions-store";
import { toast } from "../../stores/toast-store";

const STATE_LABELS: Record<BillingState, { label: string; tone: string }> = {
  NO_PRICE: { label: "Prix non renseigné", tone: "bg-surface-3 text-fg-muted" },
  UNPAID: { label: "Non payée", tone: "bg-warning/15 text-warning" },
  PARTIAL: { label: "Partiellement payée", tone: "bg-warning/15 text-warning" },
  PAID: { label: "Payée", tone: "bg-success/15 text-success" },
  OVERPAID: { label: "Trop-perçu", tone: "bg-info/15 text-info" },
};

const DEPOSIT_STATUS_TEXT: Record<Deposit["status"], string> = {
  HELD: "En attente",
  APPLIED: "Déduit",
  FORFEITED: "Perdu (conservé par l'atelier)",
  REFUNDED: "Remboursé",
  VOIDED: "Saisie annulée",
};

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
      <dt className="text-fg-faint">{label}</dt>
      <dd className={strong ? "text-[15px] font-medium text-fg" : "text-fg"}>{value}</dd>
    </div>
  );
}

/** Prix, acomptes, paiements et reste à payer d'une séance. */
export function SessionBilling({ session }: { session: SessionListItem }) {
  const store = useBillingStore();
  const confirm = useConfirm();
  const [bill, setBill] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<"payment" | "deposit" | null>(null);
  const [depositTarget, setDepositTarget] = useState<"project" | "session">(
    session.projectId ? "project" : "session",
  );

  useEffect(() => {
    let cancelled = false;
    store
      .sessionBilling(session.id)
      .then((loaded) => {
        if (!cancelled) setBill(loaded);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, store]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast.success(success);
      setBill(await store.sessionBilling(session.id));
    } catch (actionError) {
      setError(String(actionError));
    } finally {
      setBusy(false);
    }
  }

  if (error && !bill) return <p className="text-[13px] text-danger">{error}</p>;
  if (!bill) return <p className="text-[13px] text-fg-muted">Chargement du paiement…</p>;

  const held = bill.deposits.filter((deposit) => deposit.status === "HELD");
  const closed = bill.deposits.filter((deposit) => deposit.status !== "HELD");
  const state = STATE_LABELS[bill.state];
  const canApply = session.status === "PLANNED" || session.status === "COMPLETED";

  function depositLine(deposit: Deposit) {
    return `${formatEuros(deposit.amountCents)} · ${PAYMENT_METHOD_LABELS[deposit.method]} · versé le ${formatIsoDate(deposit.receivedOn)}${deposit.projectTitle ? ` · projet ${deposit.projectTitle}` : ""}`;
  }

  async function applyDeposit(deposit: Deposit) {
    const ok = await confirm({
      title: "Déduire cet acompte de la séance ?",
      details: [depositLine(deposit)],
      body: "Le reste à payer de la séance diminue d'autant. Pour revenir en arrière, il faudra annuler cette déduction avec un motif.",
      confirmLabel: "Déduire l'acompte",
    });
    if (!ok) return;
    await run(() => store.applyDeposit(deposit.id, session.id), "Acompte déduit de la séance");
  }

  async function settleDeposit(deposit: Deposit) {
    const result = await confirm({
      title: "Que devient cet acompte ?",
      details: [depositLine(deposit)],
      choices: [
        {
          value: "FORFEITED",
          label: "Acompte perdu",
          description: "Conservé par l'atelier (absence, annulation tardive…).",
        },
        { value: "REFUNDED", label: "Remboursé", description: "Rendu au client." },
      ],
      reason: { label: "Précision", placeholder: "Optionnel" },
      confirmLabel: "Enregistrer",
      cancelLabel: "Retour",
    });
    if (!result?.choice) return;
    const outcome = result.choice as "FORFEITED" | "REFUNDED";
    await run(
      () =>
        store.settleDeposit({
          depositId: deposit.id,
          outcome,
          sessionId: session.id,
          reason: result.reason,
        }),
      outcome === "FORFEITED" ? "Acompte gardé par l’atelier" : "Remboursement enregistré",
    );
  }

  async function voidDeposit(deposit: Deposit) {
    const result = await confirm({
      title: "Annuler la saisie de cet acompte ?",
      details: [depositLine(deposit)],
      body: "À utiliser pour une erreur de saisie. L'acompte reste visible, barré, avec le motif.",
      reason: { label: "Motif", required: true, placeholder: "Ex. montant erroné" },
      confirmLabel: "Annuler la saisie",
      cancelLabel: "Garder",
      tone: "danger",
    });
    if (!result?.reason) return;
    const reason = result.reason;
    await run(() => store.voidDeposit(deposit.id, reason), "Acompte annulé");
  }

  async function voidOutcome(deposit: Deposit) {
    if (!deposit.outcomeId) return;
    const outcomeId = deposit.outcomeId;
    const result = await confirm({
      title: "Annuler cette issue ?",
      details: [depositLine(deposit), DEPOSIT_STATUS_TEXT[deposit.status]],
      body: "L'acompte redevient « en attente ». L'issue annulée reste dans l'historique.",
      reason: { label: "Motif", required: true, placeholder: "Ex. mauvaise séance" },
      confirmLabel: "Annuler l'issue",
      cancelLabel: "Garder",
      tone: "danger",
    });
    if (!result?.reason) return;
    const reason = result.reason;
    await run(
      () => store.voidOutcome(outcomeId, reason),
      "Issue annulée : l’acompte est de nouveau en attente",
    );
  }

  async function voidPayment(payment: Payment) {
    const result = await confirm({
      title: "Annuler ce paiement ?",
      details: [
        `${formatEuros(payment.amountCents)} · ${PAYMENT_METHOD_LABELS[payment.method]} · ${formatIsoDate(payment.paidOn)}`,
      ],
      body: "À utiliser pour une erreur de saisie. Le paiement reste visible, barré, avec le motif.",
      reason: { label: "Motif", required: true, placeholder: "Ex. double saisie" },
      confirmLabel: "Annuler le paiement",
      cancelLabel: "Garder",
      tone: "danger",
    });
    if (!result?.reason) return;
    const reason = result.reason;
    await run(() => store.voidPayment(payment.id, reason), "Paiement annulé");
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-medium">Paiement</h2>
        <span
          className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[12px] font-medium ${state.tone}`}
        >
          {state.label}
        </span>
      </div>

      <dl className={`${cardClass} flex flex-col gap-2 p-4`}>
        <Row
          label="Prix de la séance"
          value={bill.priceCents === null ? "—" : formatEuros(bill.priceCents)}
        />
        <Row label="Acomptes déduits" value={formatEuros(bill.appliedCents)} />
        <Row label="Paiements" value={formatEuros(bill.paymentsCents)} />
        {bill.balanceCents !== null && (
          <Row
            label={bill.balanceCents < 0 ? "Trop-perçu" : "Reste à payer"}
            value={formatEuros(Math.abs(bill.balanceCents))}
            strong
          />
        )}
      </dl>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {held.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-fg-muted">Acomptes en attente</h3>
          <ul className={`${cardClass} divide-y divide-line`}>
            {held.map((deposit) => (
              <li key={deposit.id} className="flex flex-col gap-2 px-4 py-3">
                <p className="text-[13.5px]">{depositLine(deposit)}</p>
                {deposit.note && <p className="text-[12.5px] text-fg-muted">{deposit.note}</p>}
                <div className="flex flex-wrap gap-2">
                  {canApply && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void applyDeposit(deposit)}
                      className={btnPrimary}
                    >
                      Déduire de cette séance
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void settleDeposit(deposit)}
                    className={btnGhost}
                  >
                    Perdu ou remboursé…
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void voidDeposit(deposit)}
                    className={btnGhost}
                  >
                    Annuler la saisie
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding === "payment" ? (
        <MoneyForm
          title="Encaisser un paiement"
          submitLabel="Encaisser"
          initialCents={
            bill.balanceCents !== null && bill.balanceCents > 0 ? bill.balanceCents : null
          }
          onCancel={() => setAdding(null)}
          onSubmit={async (draft) => {
            await store.recordPayment({
              sessionId: session.id,
              amountCents: draft.amountCents,
              method: draft.method,
              paidOn: draft.date,
              note: draft.note,
            });
            setAdding(null);
            toast.success("Paiement enregistré");
            setBill(await store.sessionBilling(session.id));
          }}
        />
      ) : adding === "deposit" ? (
        <MoneyForm
          title="Enregistrer un acompte"
          submitLabel="Enregistrer l'acompte"
          initialCents={null}
          onCancel={() => setAdding(null)}
          extra={
            session.projectId ? (
              <fieldset className="flex flex-col gap-1.5 text-[13px]">
                <legend className={labelClass}>Rattacher à</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={depositTarget === "project"}
                    onChange={() => setDepositTarget("project")}
                    className="accent-[var(--accent)]"
                  />
                  Projet « {session.projectTitle} » (déductible de n&apos;importe quelle séance du
                  projet)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={depositTarget === "session"}
                    onChange={() => setDepositTarget("session")}
                    className="accent-[var(--accent)]"
                  />
                  Cette séance uniquement
                </label>
              </fieldset>
            ) : undefined
          }
          onSubmit={async (draft) => {
            const forProject = session.projectId !== null && depositTarget === "project";
            await store.recordDeposit({
              projectId: forProject ? session.projectId : null,
              sessionId: forProject ? null : session.id,
              amountCents: draft.amountCents,
              method: draft.method,
              receivedOn: draft.date,
              note: draft.note,
            });
            setAdding(null);
            toast.success("Acompte enregistré");
            setBill(await store.sessionBilling(session.id));
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setAdding("payment")}
            className={btnPrimary}
          >
            Encaisser un paiement
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setAdding("deposit")}
            className={btnGhost}
          >
            Enregistrer un acompte
          </button>
        </div>
      )}

      {(bill.payments.length > 0 || closed.length > 0) && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-fg-muted">Historique</h3>
          <ul className={`${cardClass} divide-y divide-line`}>
            {bill.payments.map((payment) => (
              <li key={payment.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[13.5px] ${payment.voidReason ? "text-fg-muted line-through" : ""}`}
                  >
                    Paiement · {formatEuros(payment.amountCents)} ·{" "}
                    {PAYMENT_METHOD_LABELS[payment.method]} · {formatIsoDate(payment.paidOn)}
                  </p>
                  {payment.note && <p className="text-[12.5px] text-fg-muted">{payment.note}</p>}
                  {payment.voidReason && (
                    <p className="text-[12.5px] text-fg-muted">Annulé : {payment.voidReason}</p>
                  )}
                </div>
                {!payment.voidReason && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void voidPayment(payment)}
                    className={btnGhost}
                  >
                    Annuler
                  </button>
                )}
              </li>
            ))}
            {closed.map((deposit) => (
              <li key={deposit.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[13.5px] ${deposit.status === "VOIDED" ? "text-fg-muted line-through" : ""}`}
                  >
                    Acompte · {depositLine(deposit)}
                  </p>
                  <p className="text-[12.5px] text-fg-muted">
                    {DEPOSIT_STATUS_TEXT[deposit.status]}
                    {deposit.status === "APPLIED" && deposit.outcomeSessionDate
                      ? ` sur la séance du ${formatIsoDate(deposit.outcomeSessionDate)}`
                      : ""}
                    {deposit.outcomeReason ? ` · ${deposit.outcomeReason}` : ""}
                    {deposit.voidReason ? ` : ${deposit.voidReason}` : ""}
                  </p>
                </div>
                {deposit.outcomeId && deposit.status !== "VOIDED" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void voidOutcome(deposit)}
                    className={btnGhost}
                  >
                    Annuler l&apos;issue
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
