import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { PaymentMethod } from "./billing-store";
import type { LowStockReport } from "./products-store";
import { errorMessage } from "./security-store";
import type { SessionStatus } from "./sessions-store";

export type DaySession = {
  id: string;
  clientId: string;
  clientFirstName: string;
  clientLastName: string;
  projectTitle: string | null;
  title: string | null;
  date: string;
  startTime: string | null;
  durationMinutes: number | null;
  status: SessionStatus;
  bodyArea: string | null;
  priceCents: number | null;
  paidCents: number;
  balanceCents: number | null;
  healthSaved: boolean;
  healthSigned: boolean;
  consentSaved: boolean;
  consentSigned: boolean;
};

export type ExpiringItem = {
  lotId: string;
  name: string;
  lotNumber: string;
  kind: "LOT" | "OPENED" | "SEALED";
  count: number;
  openedAt: string | null;
  usefulUntil: string;
  expired: boolean;
};

export type DepositToSettle = {
  depositId: string;
  sessionId: string;
  clientId: string;
  clientFirstName: string;
  clientLastName: string;
  sessionDate: string;
  sessionStatus: SessionStatus;
  amountCents: number;
};

export type Alerts = {
  expired: ExpiringItem[];
  expiringSoon: ExpiringItem[];
  sessionsToClose: DaySession[];
  unpaid: DaySession[];
  depositsToSettle: DepositToSettle[];
  unsigned: DaySession[];
  /** Fiches produit et catégories sous leur seuil d'alerte. */
  lowStock: LowStockReport;
};

export type MethodTotal = { method: PaymentMethod; cents: number };

export type PeriodSummary = {
  from: string;
  to: string;
  collectedCents: number;
  paymentsCents: number;
  depositsCents: number;
  refundsCents: number;
  byMethod: MethodTotal[];
  completedPriceCents: number;
  sessionsCompleted: number;
  sessionsPlanned: number;
  sessionsCancelled: number;
  sessionsNoShow: number;
  newClients: number;
};

export type Dashboard = {
  today: string;
  todaySessions: DaySession[];
  upcoming: DaySession[];
  alerts: Alerts;
  month: PeriodSummary;
  previousMonth: PeriodSummary;
};

export type ExportKind = "PAYMENTS" | "SESSIONS" | "TRACEABILITY";
export type ExportResult = { path: string; rows: number };

type DashboardState = {
  dashboard: Dashboard | null;
  error: string | null;
  load: () => Promise<void>;
  periodSummary: (from: string, to: string) => Promise<PeriodSummary>;
  exportCsv: (kind: ExportKind, from: string, to: string, path: string) => Promise<ExportResult>;
};

export function alertCount(alerts: Alerts): number {
  return (
    alerts.expired.length +
    alerts.expiringSoon.length +
    alerts.sessionsToClose.length +
    alerts.unpaid.length +
    alerts.depositsToSettle.length +
    alerts.unsigned.length +
    alerts.lowStock.sheets.length +
    alerts.lowStock.categories.length
  );
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboard: null,
  error: null,
  load: async () => {
    try {
      set({ dashboard: await invoke<Dashboard>("get_dashboard"), error: null });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  periodSummary: (from, to) => invoke<PeriodSummary>("get_period_summary", { from, to }),
  exportCsv: (kind, from, to, path) => invoke<ExportResult>("export_csv", { kind, from, to, path }),
}));
