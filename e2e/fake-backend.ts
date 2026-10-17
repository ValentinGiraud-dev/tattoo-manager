/**
 * Faux backend Tauri pour les tests d'écran : remplace `window.__TAURI_INTERNALS__`
 * avant le chargement de l'app. Les règles métier restent testées en Rust ; ici on
 * vérifie les parcours (états, confirmations, navigation, messages).
 *
 * Cette fonction est sérialisée et exécutée dans la page : elle ne doit rien importer.
 */
export type Scenario = { locked: "setup" | "locked" | "unlocked" };

export function installFakeBackend(scenario: Scenario) {
  const TODAY = "2026-10-15";
  const stamp = "2026-10-01T10:00:00";
  const status = {
    state:
      scenario.locked === "setup"
        ? "SETUP_REQUIRED"
        : scenario.locked === "locked"
          ? "LOCKED"
          : "UNLOCKED",
    touchIdAvailable: false,
    touchIdEnabled: false,
    hasPlaintextData: false,
    vaultMissing: false,
    autoLockMinutes: 10,
  };
  const PASSWORD = "atelier secret";

  const clients = [
    {
      id: "c1",
      firstName: "Léa",
      lastName: "Martin",
      birthDate: "1995-04-02",
      address: null,
      email: "lea@example.org",
      phone: null,
      notes: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const session = {
    id: "s1",
    clientId: "c1",
    projectId: null,
    projectTitle: null,
    date: TODAY,
    startTime: "14:00",
    durationMinutes: 120,
    status: "PLANNED",
    priceCents: 30000,
    bodyArea: "Avant-bras",
    description: null,
    notes: null,
    createdAt: stamp,
    updatedAt: stamp,
    clientFirstName: "Léa",
    clientLastName: "Martin",
    usageCount: 0,
    moneyCount: 0,
    clientNoShowCount: 0,
  };
  const lot = {
    id: "l1",
    name: "Encre rouge",
    lotNumber: "ER-1",
    creationDate: null,
    expirationDate: "2026-09-01",
    singleUse: true,
    afterOpeningMonths: null,
    productUrl: null,
    createdAt: stamp,
    updatedAt: stamp,
    stock: 4,
    sealedCount: 0,
    openedCount: 0,
    movementCount: 1,
    sessionCount: 0,
    expired: true,
  };
  const daySession = {
    id: "s1",
    clientId: "c1",
    clientFirstName: "Léa",
    clientLastName: "Martin",
    projectTitle: null,
    date: TODAY,
    startTime: "14:00",
    durationMinutes: 120,
    status: "PLANNED",
    bodyArea: "Avant-bras",
    priceCents: 30000,
    paidCents: 0,
    balanceCents: 30000,
    healthSaved: false,
    healthSigned: false,
    consentSaved: false,
    consentSigned: false,
  };
  const period = (from: string, to: string) => ({
    from,
    to,
    collectedCents: 45000,
    paymentsCents: 40000,
    depositsCents: 5000,
    refundsCents: 0,
    byMethod: [{ method: "CARD", cents: 45000 }],
    completedPriceCents: 40000,
    sessionsCompleted: 2,
    sessionsPlanned: 1,
    sessionsCancelled: 0,
    sessionsNoShow: 0,
    newClients: 1,
  });
  const backup = {
    folder: null,
    lastBackupAt: null,
    lastCheckAt: null,
    lastFingerprint: null,
    lastError: null,
  };

  const fail = (message: string) => Promise.reject(message);
  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    get_security_status: () => status,
    setup_security: () => {
      status.state = "UNLOCKED";
      return "7KQ2-M9XD-4HBR-T6WC-PZ3N-8FJA";
    },
    unlock_with_password: ({ password }) => {
      if (password !== PASSWORD) return fail("Mot de passe incorrect.");
      status.state = "UNLOCKED";
      return status;
    },
    lock_app: () => {
      status.state = "LOCKED";
      return status;
    },
    get_settings: () => ({
      locale: "fr",
      window: { width: 1200, height: 800 },
      studio: { professionalName: "", city: "" },
    }),
    get_app_paths: () => ({
      root: "/données",
      database: "/données/database.sqlite",
      photos: "/données/photos",
      documents: "/données/documents",
      backups: "/données/backups",
      settings: "/données/settings.json",
    }),
    get_backup_settings: () => backup,
    run_backup_if_due: () => ({ result: "SKIPPED", settings: backup }),
    get_dashboard: () => ({
      today: TODAY,
      todaySessions: [daySession],
      upcoming: [],
      alerts: {
        expired: [
          {
            lotId: "l1",
            name: "Encre rouge",
            lotNumber: "ER-1",
            kind: "LOT",
            count: 4,
            openedAt: null,
            usefulUntil: "2026-09-01",
            expired: true,
          },
        ],
        expiringSoon: [],
        sessionsToClose: [],
        unpaid: [],
        depositsToSettle: [],
        unsigned: [],
      },
      month: period("2026-10-01", "2026-10-31"),
      previousMonth: period("2026-09-01", "2026-09-30"),
    }),
    get_period_summary: ({ from, to }) => period(String(from), String(to)),
    export_csv: ({ path }) => ({ path, rows: 12 }),
    "plugin:dialog|save": () => "/Users/atelier/Documents/export.csv",
    list_clients: () => clients,
    get_client: ({ id }) => clients.find((client) => client.id === id),
    create_client: ({ input }) => {
      const client = {
        ...(input as object),
        id: `c${clients.length + 1}`,
        createdAt: stamp,
        updatedAt: stamp,
      } as (typeof clients)[number];
      clients.push(client);
      return client;
    },
    list_client_sessions: () => [session],
    list_client_usages: () => [],
    list_client_projects: () => [],
    list_sessions: () => [session],
    get_session: () => session,
    list_session_usages: () => [],
    get_session_paperwork: () => ({
      sessionId: "s1",
      sessionDate: TODAY,
      sessionStatus: "PLANNED",
      clientFirstName: "Léa",
      clientLastName: "Martin",
      clientBirthDate: "1995-04-02",
      clientAge: 31,
      clientMinor: false,
      health: null,
      consent: null,
      healthSigned: false,
      consentSigned: false,
      documents: [],
    }),
    get_session_billing: () => ({
      sessionId: "s1",
      sessionStatus: "PLANNED",
      priceCents: 30000,
      appliedCents: 0,
      paymentsCents: 0,
      paidCents: 0,
      balanceCents: 30000,
      state: "UNPAID",
      deposits: [],
      payments: [],
    }),
    list_lots: () => [lot],
    get_lot: () => lot,
    list_lot_sessions: () => [],
    list_lot_units: () => [],
    list_lot_movements: () => [],
    "plugin:updater|check": () => null,
  };

  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      const handler = handlers[command];
      if (!handler) return [];
      return handler(args);
    },
    transformCallback: () => 0,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };
}
