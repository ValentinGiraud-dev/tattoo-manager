import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type PaymentMethod = "CASH" | "CARD" | "TRANSFER" | "CHECK" | "OTHER";
export type OutcomeKind = "APPLIED" | "FORFEITED" | "REFUNDED";
export type DepositStatus = "HELD" | "APPLIED" | "FORFEITED" | "REFUNDED" | "VOIDED";
export type BillingState = "NO_PRICE" | "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";

/** Miroir de `DepositView` (Rust). Montants en centimes. */
export interface Deposit {
  id: string;
  clientId: string;
  projectId: string | null;
  projectTitle: string | null;
  sessionId: string | null;
  sessionDate: string | null;
  amountCents: number;
  method: PaymentMethod;
  receivedOn: string;
  note: string | null;
  createdAt: string;
  voidReason: string | null;
  voidedAt: string | null;
  outcomeId: string | null;
  outcome: OutcomeKind | null;
  outcomeSessionId: string | null;
  outcomeSessionDate: string | null;
  outcomeReason: string | null;
  outcomeAt: string | null;
  status: DepositStatus;
}

export interface Payment {
  id: string;
  sessionId: string;
  amountCents: number;
  method: PaymentMethod;
  paidOn: string;
  note: string | null;
  createdAt: string;
  voidReason: string | null;
  voidedAt: string | null;
}

export interface SessionBilling {
  sessionId: string;
  sessionStatus: string;
  priceCents: number | null;
  appliedCents: number;
  paymentsCents: number;
  paidCents: number;
  /** Négatif : trop-perçu. `null` sans prix. */
  balanceCents: number | null;
  state: BillingState;
  deposits: Deposit[];
  payments: Payment[];
}

export interface DepositInput {
  projectId: string | null;
  sessionId: string | null;
  amountCents: number;
  method: PaymentMethod;
  receivedOn: string;
  note: string | null;
}

export interface PaymentInput {
  sessionId: string;
  amountCents: number;
  method: PaymentMethod;
  paidOn: string;
  note: string | null;
}

interface BillingState_ {
  sessionBilling: (sessionId: string) => Promise<SessionBilling>;
  projectDeposits: (projectId: string) => Promise<Deposit[]>;
  recordDeposit: (input: DepositInput) => Promise<Deposit>;
  voidDeposit: (depositId: string, reason: string) => Promise<Deposit>;
  applyDeposit: (depositId: string, sessionId: string) => Promise<Deposit>;
  /** Acompte perdu (conservé par l'atelier) ou remboursé. */
  settleDeposit: (input: {
    depositId: string;
    outcome: "FORFEITED" | "REFUNDED";
    sessionId: string | null;
    reason: string | null;
  }) => Promise<Deposit>;
  voidOutcome: (outcomeId: string, reason: string) => Promise<Deposit>;
  recordPayment: (input: PaymentInput) => Promise<Payment>;
  voidPayment: (paymentId: string, reason: string) => Promise<Payment>;
}

export const useBillingStore = create<BillingState_>(() => ({
  sessionBilling: (sessionId) => invoke<SessionBilling>("get_session_billing", { sessionId }),
  projectDeposits: (projectId) => invoke<Deposit[]>("list_project_deposits", { projectId }),
  recordDeposit: (input) => invoke<Deposit>("record_deposit", { input }),
  voidDeposit: (depositId, reason) => invoke<Deposit>("void_deposit", { depositId, reason }),
  applyDeposit: (depositId, sessionId) =>
    invoke<Deposit>("apply_deposit", { depositId, sessionId }),
  settleDeposit: (input) => invoke<Deposit>("settle_deposit", { input }),
  voidOutcome: (outcomeId, reason) =>
    invoke<Deposit>("void_deposit_outcome", { outcomeId, reason }),
  recordPayment: (input) => invoke<Payment>("record_payment", { input }),
  voidPayment: (paymentId, reason) => invoke<Payment>("void_payment", { paymentId, reason }),
}));

/** Date du jour locale `AAAA-MM-JJ`. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
