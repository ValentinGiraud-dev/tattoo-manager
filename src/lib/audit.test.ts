import { describe, expect, it } from "vitest";
import type { AuditEntry } from "../stores/audit-store";
import {
  changeLines,
  describeEntry,
  entryTarget,
  formatValue,
  hiddenDetailNote,
  localDay,
} from "./audit";

function entry(patch: Partial<AuditEntry>): AuditEntry {
  return {
    seq: 1,
    occurredAt: "2026-10-20T08:15:00",
    action: "CREATE",
    entity: "client",
    entityId: "c1",
    label: "Léa Martin",
    clientId: "c1",
    sessionId: null,
    lotId: null,
    changes: [],
    ...patch,
  };
}

describe("describeEntry", () => {
  it("accorde le verbe avec la fiche", () => {
    expect(describeEntry(entry({}))).toBe("Client créé");
    expect(describeEntry(entry({ entity: "session", action: "UPDATE" }))).toBe("Séance modifiée");
    expect(describeEntry(entry({ entity: "category", action: "DELETE" }))).toBe(
      "Catégorie supprimée",
    );
  });

  it("reconnaît une annulation et l'ouverture d'une pièce", () => {
    expect(
      describeEntry(
        entry({
          entity: "payment",
          action: "UPDATE",
          changes: [{ field: "voided_at", before: null, after: "2026-10-20T08:15:00" }],
        }),
      ),
    ).toBe("Paiement annulé");
    expect(
      describeEntry(
        entry({
          entity: "unit",
          action: "UPDATE",
          changes: [{ field: "opened_at", before: null, after: "2026-10-20" }],
        }),
      ),
    ).toBe("Pièce ouverte");
  });

  it("nomme les mouvements, les issues d'acompte et les événements", () => {
    const movement = entry({
      entity: "stock_movement",
      changes: [{ field: "type", before: null, after: "LOSS" }],
    });
    expect(describeEntry(movement)).toBe("Perte");
    expect(
      describeEntry(
        entry({
          entity: "deposit_outcome",
          changes: [{ field: "outcome", before: null, after: "REFUNDED" }],
        }),
      ),
    ).toBe("Acompte remboursé");
    expect(
      describeEntry(
        entry({
          entity: "app",
          action: "CSV_EXPORTED",
          changes: [{ field: "kind", before: null, after: "TRACEABILITY" }],
        }),
      ),
    ).toBe("Export CSV : registre de traçabilité");
    expect(
      describeEntry(
        entry({
          entity: "app",
          action: "BACKUP_CREATED",
          changes: [{ field: "automatic", before: null, after: true }],
        }),
      ),
    ).toBe("Sauvegarde automatique");
  });

  it("signale qu'un questionnaire modifié ne montre pas ses réponses", () => {
    const form = entry({ entity: "session_form", action: "UPDATE" });
    expect(describeEntry(form)).toBe("Questionnaire modifié");
    expect(hiddenDetailNote(form)).toMatch(/pas recopiées/);
    expect(hiddenDetailNote(entry({}))).toBeNull();
  });
});

describe("formatValue", () => {
  const names = { s1: "Léa Martin · 05/10/2026" };

  it("met en forme montants, dates, booléens et listes fermées", () => {
    expect(formatValue("payment", "amount_cents", 5000, names)).toMatch(/^50,00\s€$/);
    expect(formatValue("lot", "expiration_date", "2027-03-01", names)).toBe("1 mars 2027");
    expect(formatValue("lot", "single_use", 1, names)).toBe("Oui");
    expect(formatValue("session", "status", "NO_SHOW", names)).toBe("Absent");
    expect(formatValue("project", "status", "COMPLETED", names)).toBe("Terminé");
    expect(formatValue("payment", "method", "CARD", names)).toBe("Carte");
    expect(formatValue("session", "duration_minutes", 90, names)).toBe("1 h 30");
    expect(formatValue("client", "phone", null, names)).toBe("—");
  });

  it("remplace un identifiant par le nom de la fiche, ou dit qu'elle n'existe plus", () => {
    expect(formatValue("payment", "session_id", "s1", names)).toBe("Léa Martin · 05/10/2026");
    expect(formatValue("lot", "category_id", "disparue", names)).toBe("fiche supprimée");
  });
});

describe("changeLines", () => {
  it("montre avant → après pour une modification, dans un ordre stable", () => {
    const lines = changeLines(
      entry({
        action: "UPDATE",
        changes: [
          { field: "notes", before: null, after: "Allergique au latex" },
          { field: "phone", before: "0601", after: "0602" },
        ],
      }),
      {},
    );
    expect(lines).toEqual([
      { field: "phone", label: "Téléphone", before: "0601", after: "0602" },
      { field: "notes", label: "Notes", before: "—", after: "Allergique au latex" },
    ]);
  });

  it("montre la valeur perdue pour une suppression et masque les champs techniques", () => {
    const lines = changeLines(
      entry({
        entity: "session_usage",
        action: "DELETE",
        changes: [
          { field: "unit_id", before: "u1", after: null },
          { field: "lot_id", before: "l1", after: null },
        ],
      }),
      { l1: "Encre noire · lot A1" },
    );
    expect(lines).toEqual([
      { field: "lot_id", label: "Lot", before: null, after: "Encre noire · lot A1" },
    ]);
  });
});

describe("entryTarget", () => {
  it("ouvre la fiche la plus utile", () => {
    expect(entryTarget(entry({}))).toEqual({ kind: "client", id: "c1" });
    expect(
      entryTarget(entry({ entity: "payment", entityId: "p1", sessionId: "s1", clientId: "c1" })),
    ).toEqual({ kind: "session", id: "s1" });
    expect(entryTarget(entry({ entity: "stock_movement", sessionId: "s1", lotId: "l1" }))).toEqual({
      kind: "lot",
      id: "l1",
    });
    expect(entryTarget(entry({ entity: "category", clientId: null }))).toBeNull();
    expect(entryTarget(entry({ entity: "app", clientId: null }))).toBeNull();
  });
});

describe("localDay", () => {
  it("convertit l'horodatage UTC en jour local", () => {
    const utc = "2026-10-20T23:30:00";
    const local = new Date(`${utc}Z`);
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
    expect(localDay(utc)).toBe(expected);
  });
});

describe("changeLines sans redites", () => {
  it("n'affiche ni le champ qui fait le titre ni la fiche déjà nommée", () => {
    const names = { s1: "Léa Martin · 15/10/2026" };
    const payment = entry({
      entity: "payment",
      label: "Léa Martin · 15/10/2026",
      changes: [
        { field: "session_id", before: null, after: "s1" },
        { field: "amount_cents", before: null, after: 5000 },
      ],
    });
    expect(changeLines(payment, names).map((line) => line.field)).toEqual(["amount_cents"]);
    const movement = entry({
      entity: "stock_movement",
      changes: [
        { field: "type", before: null, after: "LOSS" },
        { field: "quantity", before: null, after: -1 },
      ],
    });
    expect(changeLines(movement, names).map((line) => line.field)).toEqual(["quantity"]);
    // Une modification garde tout : c'est le changement lui-même.
    const moved = entry({
      entity: "payment",
      action: "UPDATE",
      label: "Léa Martin · 15/10/2026",
      changes: [{ field: "session_id", before: "s0", after: "s1" }],
    });
    expect(changeLines(moved, names)).toHaveLength(1);
  });
});
