/**
 * Faux backend Tauri pour les tests d'écran : remplace `window.__TAURI_INTERNALS__`
 * avant le chargement de l'app. Les règles métier restent testées en Rust ; ici on
 * vérifie les parcours (états, confirmations, navigation, messages).
 *
 * Cette fonction est sérialisée et exécutée dans la page : elle ne doit rien importer.
 */
export type Scenario = {
  locked: "setup" | "locked" | "unlocked";
  rotationPending?: boolean;
  /** Touch ID proposé dans les réglages et pour la réinitialisation. */
  touchId?: boolean;
};

export function installFakeBackend(scenario: Scenario) {
  const TODAY = "2026-10-15";
  const stamp = "2026-10-01T10:00:00";
  const appReset = sessionStorage.getItem("tracink:app-reset") === "1";
  const status = {
    state: appReset
      ? "SETUP_REQUIRED"
      : scenario.locked === "setup"
        ? "SETUP_REQUIRED"
        : scenario.locked === "locked"
          ? "LOCKED"
          : "UNLOCKED",
    touchIdAvailable: scenario.touchId === true && !appReset,
    touchIdEnabled: scenario.touchId === true && !appReset,
    hasPlaintextData: false,
    vaultMissing: false,
    autoLockMinutes: 10,
    rotationPending: scenario.rotationPending ?? false,
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
      archivedAt: null as string | null,
      sessionCount: 1,
    },
  ];
  const projects = [
    {
      id: "p1",
      clientId: "c1",
      clientFirstName: "Léa",
      clientLastName: "Martin",
      title: "Arbre",
      bodyArea: "Avant-bras" as string | null,
      description: null,
      quotedPriceCents: null,
      status: "ACTIVE" as "ACTIVE" | "COMPLETED" | "ABANDONED",
      createdAt: stamp,
      updatedAt: stamp,
      sessionCount: 1,
      completedCount: 0,
      nextSessionDate: null,
      sessionsPriceCents: 0,
      heldDepositsCents: 0,
      receivedCents: 0,
      archivedAt: null as string | null,
    },
  ];
  const session = {
    id: "s1",
    clientId: "c1",
    projectId: null,
    projectTitle: null,
    title: null,
    date: TODAY,
    startTime: "14:00",
    durationMinutes: 120,
    status: "PLANNED",
    priceCents: 30000,
    bodyArea: "Avant-bras",
    description: null,
    notes: null,
    aftercareExplained: false,
    createdAt: stamp,
    updatedAt: stamp,
    clientFirstName: "Léa",
    clientLastName: "Martin",
    usageCount: 0,
    moneyCount: 0,
    clientNoShowCount: 0,
    archivedAt: null as string | null,
    clientArchived: false,
    projectArchived: false,
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
    categoryId: null as string | null,
    categoryPath: null as string | null,
    productId: null as string | null,
    productName: null as string | null,
    productBrand: null as string | null,
    createdAt: stamp,
    updatedAt: stamp,
    stock: 4,
    sealedCount: 0,
    openedCount: 0,
    movementCount: 1,
    sessionCount: 0,
    expired: true,
    archivedAt: null as string | null,
    productArchived: false,
  };
  const daySession = {
    id: "s1",
    clientId: "c1",
    clientFirstName: "Léa",
    clientLastName: "Martin",
    projectTitle: null,
    title: null,
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

  // Journal d'audit : quelques entrées fixes, filtrées comme le fait Rust.
  const audit = [
    {
      seq: 6,
      occurredAt: "2026-10-15T09:30:00",
      action: "UPDATE",
      entity: "client",
      entityId: "c1",
      label: "Léa Martin",
      clientId: "c1",
      sessionId: null,
      lotId: null,
      changes: [{ field: "phone", before: null, after: "06 01 02 03 04" }],
    },
    {
      seq: 5,
      occurredAt: "2026-10-15T09:10:00",
      action: "UPDATE",
      entity: "session_form",
      entityId: "f1",
      label: "Léa Martin · 15/10/2026",
      clientId: "c1",
      sessionId: "s1",
      lotId: null,
      changes: [],
    },
    {
      seq: 4,
      occurredAt: "2026-10-15T09:00:00",
      action: "CREATE",
      entity: "payment",
      entityId: "p1",
      label: "Léa Martin · 15/10/2026",
      clientId: "c1",
      sessionId: "s1",
      lotId: null,
      changes: [
        { field: "session_id", before: null, after: "s1" },
        { field: "amount_cents", before: null, after: 5000 },
        { field: "method", before: null, after: "CARD" },
      ],
    },
    {
      seq: 3,
      occurredAt: "2026-10-14T16:00:00",
      action: "CREATE",
      entity: "stock_movement",
      entityId: "m1",
      label: "Encre rouge · lot ER-1",
      clientId: null,
      sessionId: null,
      lotId: "l1",
      changes: [
        { field: "type", before: null, after: "LOSS" },
        { field: "quantity", before: null, after: -1 },
        { field: "reason", before: null, after: "Flacon cassé" },
      ],
    },
    {
      seq: 2,
      occurredAt: "2026-10-14T08:00:00",
      action: "BACKUP_CREATED",
      entity: "app",
      entityId: null,
      label: null,
      clientId: null,
      sessionId: null,
      lotId: null,
      changes: [{ field: "automatic", before: null, after: true }],
    },
    {
      seq: 1,
      occurredAt: "2026-10-01T10:00:00",
      action: "JOURNAL_STARTED",
      entity: "app",
      entityId: null,
      label: null,
      clientId: null,
      sessionId: null,
      lotId: null,
      changes: [],
    },
  ];
  const auditGroups: Record<string, string[]> = {
    clients: ["client", "project"],
    sessions: ["session", "session_form", "session_document", "session_usage"],
    billing: ["deposit", "deposit_outcome", "payment"],
    stock: ["product", "lot", "unit", "stock_movement", "category"],
    app: ["app"],
  };

  // Catégories : arbre en mémoire, rendu à plat comme le fait Rust.
  type Raw = {
    id: string;
    parentId: string | null;
    name: string;
    lowStockThreshold?: number | null;
    lowStockMode?: string | null;
  };
  const categories: Raw[] = [];
  let nextCategory = 1;
  const lots = [lot];

  // Fiches produit : stock calculé depuis les lots rattachés, comme en Rust.
  type Sheet = {
    id: string;
    name: string;
    brand: string | null;
    categoryId: string | null;
    singleUse: boolean;
    afterOpeningMonths: number | null;
    productUrl: string | null;
    lowStockThreshold?: number | null;
  };
  const sheets: Sheet[] = [];
  /** Seuil appliqué : celui de la fiche (0 = aucun), sinon la catégorie « par produit » la plus proche. */
  function applied(sheet: Sheet): { threshold: number; source: string | null } | null {
    if (sheet.lowStockThreshold === 0) return null;
    if (sheet.lowStockThreshold) return { threshold: sheet.lowStockThreshold, source: null };
    const paths = tree();
    let current = sheet.categoryId;
    while (current) {
      const category = categories.find((c) => c.id === current);
      if (!category) return null;
      if (category.lowStockMode === "EACH" && category.lowStockThreshold) {
        const path = paths.find((c) => c.id === category.id)?.path as string;
        return { threshold: category.lowStockThreshold, source: path };
      }
      current = category.parentId;
    }
    return null;
  }
  let nextSheet = 1;
  const display = (sheet: Sheet) => (sheet.brand ? `${sheet.brand} ${sheet.name}` : sheet.name);
  function sheetView(sheet: Sheet) {
    const own = lots.filter((l) => l.productId === sheet.id);
    const paths = tree();
    return {
      ...sheet,
      displayName: display(sheet),
      categoryPath:
        (paths.find((c) => c.id === sheet.categoryId)?.path as string | undefined) ?? null,
      createdAt: stamp,
      updatedAt: stamp,
      lotCount: own.length,
      stock: own.filter((l) => !l.expired).reduce((sum, l) => sum + l.stock, 0),
      expiredStock: own.filter((l) => l.expired).reduce((sum, l) => sum + l.stock, 0),
      lowStockThreshold: sheet.lowStockThreshold ?? null,
      alertThreshold: applied(sheet)?.threshold ?? null,
      alertSource: applied(sheet)?.source ?? null,
      lowStock: false,
      archivedAt: (sheet as Sheet & { archivedAt?: string | null }).archivedAt ?? null,
    };
  }
  function sheetViews() {
    return sheets.map((sheet) => {
      const view = sheetView(sheet);
      view.lowStock = view.alertThreshold !== null && view.stock <= view.alertThreshold;
      return view;
    });
  }
  function lowStockReport() {
    return {
      sheets: sheetViews()
        .filter((view) => view.lowStock)
        .map((view) => ({
          sheetId: view.id,
          displayName: view.displayName,
          singleUse: view.singleUse,
          stock: view.stock,
          threshold: view.alertThreshold,
          source: view.alertSource,
        })),
      categories: [],
    };
  }
  function attachLot(lotId: string, sheet: Sheet) {
    const target = lots.find((l) => l.id === lotId)!;
    if (target.singleUse !== sheet.singleUse) {
      throw "Ce lot et cette fiche produit n'ont pas le même type (usage unique ou multiple)";
    }
    Object.assign(target, {
      productId: sheet.id,
      productName: sheet.name,
      productBrand: sheet.brand,
      categoryId: sheet.categoryId,
    });
  }
  function tree() {
    const out: Record<string, unknown>[] = [];
    const visit = (parentId: string | null, depth: number, prefix: string) => {
      const children = categories
        .filter((c) => c.parentId === parentId)
        .sort((a, b) => a.name.localeCompare(b.name, "fr"));
      let total = 0;
      for (const c of children) {
        const path = prefix ? `${prefix} › ${c.name}` : c.name;
        const lotCount =
          sheets.filter((p) => p.categoryId === c.id).length +
          lots.filter((l) => l.categoryId === c.id && l.productId === null).length;
        const row = {
          id: c.id,
          parentId: c.parentId,
          name: c.name,
          depth,
          path,
          lotCount,
          totalLotCount: 0,
          childCount: categories.filter((x) => x.parentId === c.id).length,
          lowStockThreshold: c.lowStockThreshold ?? null,
          lowStockMode: c.lowStockMode ?? null,
        };
        out.push(row);
        row.totalLotCount = lotCount + visit(c.id, depth + 1, path);
        total += row.totalLotCount;
      }
      return total;
    };
    visit(null, 0, "");
    for (const l of lots) {
      l.categoryPath = (out.find((c) => c.id === l.categoryId)?.path as string | undefined) ?? null;
    }
    return out;
  }
  const wiped = sessionStorage.getItem("tracink:data-reset") === "1";
  const emptyAlerts = {
    expired: [],
    expiringSoon: [],
    sessionsToClose: [],
    unpaid: [],
    depositsToSettle: [],
    unsigned: [],
    lowStock: { sheets: [], categories: [] },
  };
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
      todaySessions: wiped ? [] : [daySession],
      upcoming: [],
      alerts: wiped
        ? emptyAlerts
        : {
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
            lowStock: lowStockReport(),
          },
      month: period("2026-10-01", "2026-10-31"),
      previousMonth: period("2026-09-01", "2026-09-30"),
    }),
    get_period_summary: ({ from, to }) => period(String(from), String(to)),
    export_csv: ({ path }) => ({ path, rows: 12 }),
    "plugin:dialog|save": () => "/Users/atelier/Documents/export.csv",
    list_clients: ({ archived }) =>
      wiped ? [] : clients.filter((client) => Boolean(client.archivedAt) === Boolean(archived)),
    get_client: ({ id }) => clients.find((client) => client.id === id),
    create_client: ({ input }) => {
      const client = {
        ...(input as object),
        id: `c${clients.length + 1}`,
        createdAt: stamp,
        updatedAt: stamp,
        archivedAt: null,
        sessionCount: 0,
      } as (typeof clients)[number];
      clients.push(client);
      return client;
    },
    preview_client_archive: ({ id }) => {
      const linked = session.clientId === id;
      const client = clients.find((item) => item.id === id);
      return {
        clientId: id,
        archived: Boolean(client?.archivedAt),
        canDelete: !linked && !client?.archivedAt,
        sessions: linked ? [{ id: session.id, date: session.date, upcoming: true }] : [],
        projects: [],
        depositCount: 0,
        paymentCount: 0,
        documentCount: 0,
        stock: linked
          ? [{ lotId: lot.id, name: lot.name, lotNumber: lot.lotNumber, quantity: 1 }]
          : [],
      };
    },
    delete_client: ({ id }) => {
      const index = clients.findIndex((client) => client.id === id);
      if (index >= 0) clients.splice(index, 1);
    },
    archive_client: ({ id }) => {
      const client = clients.find((item) => item.id === id);
      if (client) client.archivedAt = stamp;
    },
    restore_client: ({ id }) => {
      const client = clients.find((item) => item.id === id);
      if (client) client.archivedAt = null;
    },
    list_client_sessions: () => [session],
    list_client_usages: () => [],
    list_client_projects: ({ clientId }) =>
      projects.filter((project) => project.clientId === clientId),
    list_sessions: ({ archived }) => {
      if (wiped) return [];
      return Boolean(session.archivedAt) === Boolean(archived) ? [session] : [];
    },
    get_session: () => session,
    preview_session_removal: () => ({
      sessionId: session.id,
      archived: session.archivedAt !== null,
      canDelete: session.usageCount === 0 && session.moneyCount === 0,
      usageCount: session.usageCount,
      formCount: 0,
      documentCount: 0,
      paymentCount: 0,
      depositCount: 0,
    }),
    update_session: ({ input }) => {
      const next = input as { status?: typeof session.status };
      if (next.status) session.status = next.status;
      return session;
    },
    set_aftercare_explained: ({ explained }) => {
      session.aftercareExplained = explained === true;
      return session;
    },
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
    list_categories: () => tree(),
    create_category: ({ input }) => {
      const { name, parentId } = input as { name: string; parentId: string | null };
      if (
        categories.some(
          (c) => c.parentId === parentId && c.name.toLowerCase() === name.trim().toLowerCase(),
        )
      ) {
        return fail("Une catégorie porte déjà ce nom à cet endroit");
      }
      const id = `cat${nextCategory++}`;
      categories.push({ id, parentId, name: name.trim() });
      return tree().find((c) => c.id === id);
    },
    update_category: ({ id, input }) => {
      const category = categories.find((c) => c.id === id)!;
      Object.assign(category, input);
      return tree().find((c) => c.id === id);
    },
    delete_category: ({ id }) => {
      const category = categories.find((c) => c.id === id)!;
      for (const c of categories) if (c.parentId === id) c.parentId = category.parentId;
      for (const l of lots) if (l.categoryId === id) l.categoryId = category.parentId;
      categories.splice(categories.indexOf(category), 1);
      return null;
    },
    list_lots: ({ archived }) => {
      if (wiped) return [];
      tree();
      if (archived === null || archived === undefined) return lots;
      return lots.filter((item) => Boolean(item.archivedAt) === Boolean(archived));
    },
    get_lot: ({ id }) => {
      tree();
      return lots.find((l) => l.id === id) ?? lot;
    },
    list_product_sheets: ({ archived }) => {
      const views = sheetViews();
      if (archived === null || archived === undefined) return views;
      return views.filter((item) => Boolean(item.archivedAt) === Boolean(archived));
    },
    get_product_sheet: ({ id }) => sheetViews().find((p) => p.id === id),
    get_low_stock_report: () => lowStockReport(),
    set_category_low_stock: ({ id, setting }) => {
      const category = categories.find((c) => c.id === id)!;
      const { mode, threshold } = setting as { mode: string | null; threshold: number | null };
      category.lowStockMode = mode;
      category.lowStockThreshold = mode ? threshold : null;
      return tree().find((c) => c.id === id);
    },
    create_product_sheet: ({ input, attachLotIds }) => {
      const sheet = { ...(input as Sheet), id: `p${nextSheet++}` };
      if (
        sheets.some(
          (p) =>
            p.name.toLowerCase() === sheet.name.toLowerCase() &&
            (p.brand ?? "").toLowerCase() === (sheet.brand ?? "").toLowerCase(),
        )
      ) {
        return fail("Une fiche produit porte déjà ce nom et cette marque");
      }
      try {
        for (const id of attachLotIds as string[]) {
          const target = lots.find((l) => l.id === id)!;
          if (target.singleUse !== sheet.singleUse) throw new Error();
        }
      } catch {
        return fail(
          "Ce lot et cette fiche produit n'ont pas le même type (usage unique ou multiple)",
        );
      }
      sheets.push(sheet);
      for (const id of attachLotIds as string[]) attachLot(id, sheet);
      return sheetViews().find((p) => p.id === sheet.id);
    },
    set_lot_product_sheet: ({ lotId, sheetId }) => {
      const target = lots.find((l) => l.id === lotId)!;
      if (sheetId)
        attachLot(
          String(lotId),
          sheets.find((p) => p.id === sheetId)!,
        );
      else Object.assign(target, { productId: null, productName: null, productBrand: null });
      tree();
      return target;
    },
    find_lot: () => null,
    create_lot: ({ input }) => {
      const { productId } = input as { productId: string | null };
      const sheet = sheets.find((p) => p.id === productId);
      const created = {
        ...lot,
        ...(input as object),
        ...(sheet
          ? {
              name: display(sheet),
              singleUse: sheet.singleUse,
              categoryId: sheet.categoryId,
              productName: sheet.name,
              productBrand: sheet.brand,
            }
          : {}),
        id: `l${lots.length + 1}`,
        expired: false,
        stock: (input as { quantity: number }).quantity,
      };
      lots.push(created);
      tree();
      return created;
    },
    list_lot_sessions: () => [],
    list_lot_units: ({ lotId }) => {
      const target = lots.find((item) => item.id === lotId);
      if (!target || target.singleUse) return [];
      return [
        {
          id: `${lotId}-open`,
          lotId,
          openedAt: "2026-10-16",
          inStock: true,
          exitType: null,
          exitMovementId: null,
          createdAt: stamp,
          updatedAt: stamp,
          usedInSessions: true,
          usefulUntil: "2027-10-16",
          expired: false,
        },
        {
          id: `${lotId}-sealed`,
          lotId,
          openedAt: null,
          inStock: true,
          exitType: null,
          exitMovementId: null,
          createdAt: stamp,
          updatedAt: stamp,
          usedInSessions: false,
          usefulUntil: "2027-12-01",
          expired: false,
        },
      ];
    },
    list_lot_movements: () => [],
    list_audit_entries: ({ query }) => {
      const q = query as Record<string, string | number | null | undefined>;
      const entries = audit.filter(
        (entry) =>
          (!q.clientId || entry.clientId === q.clientId) &&
          (!q.sessionId || entry.sessionId === q.sessionId) &&
          (!q.lotId || entry.lotId === q.lotId) &&
          (!q.entity || entry.entity === q.entity) &&
          (!q.entityId || entry.entityId === q.entityId) &&
          (!q.group || auditGroups[String(q.group)].includes(entry.entity)) &&
          (!q.from || entry.occurredAt.slice(0, 10) >= String(q.from)) &&
          (!q.to || entry.occurredAt.slice(0, 10) <= String(q.to)),
      );
      return {
        entries,
        names: { s1: "Léa Martin · 15/10/2026", l1: "Encre rouge · lot ER-1" },
        hasMore: false,
      };
    },
    "plugin:updater|check": () => null,
    reset_app: ({ proof }) => {
      const given = proof as { method?: string; password?: string; scope?: string } | undefined;
      const method = given?.method;
      if (method === "password") {
        if (given.password !== PASSWORD) {
          return fail("Mot de passe incorrect.");
        }
      } else if (method === "touchId") {
        if (!status.touchIdEnabled) {
          return fail("Touch ID n'est pas activé. Saisissez le mot de passe.");
        }
      } else {
        return fail("Saisissez le mot de passe.");
      }
      if (given.scope === "installation") {
        sessionStorage.setItem("tracink:app-reset", "1");
      } else {
        sessionStorage.setItem("tracink:data-reset", "1");
      }
      return null;
    },
    rotate_master_key: ({ currentPassword, newPassword }) => {
      if (currentPassword !== PASSWORD) return fail("Le mot de passe actuel est incorrect.");
      if (newPassword === currentPassword) {
        return fail("Choisis un mot de passe différent de l'actuel.");
      }
      return "9QWE-RTY2-ZXC4-VBN6-MKL8-PJH3";
    },
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
