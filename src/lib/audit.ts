/**
 * Mise en forme du journal d'audit : titre de chaque entrée, libellés des champs,
 * valeurs lisibles. Les données viennent brutes de Rust (`services/audit.rs`).
 */
import type { AuditChange, AuditEntry } from "../stores/audit-store";
import { formatBytes, formatIsoDate, formatTimestamp } from "./format";
import { formatDuration, PAYMENT_METHOD_LABELS, SESSION_STATUS_LABELS } from "./labels";
import { formatEuros } from "./money";

type Noun = { label: string; feminine: boolean };

const ENTITIES: Record<string, Noun> = {
  client: { label: "Client", feminine: false },
  project: { label: "Projet", feminine: false },
  session: { label: "Séance", feminine: true },
  session_form: { label: "Questionnaire", feminine: false },
  session_document: { label: "Document", feminine: false },
  session_usage: { label: "Lien produit", feminine: false },
  session_usage_void: { label: "Annulation de lien", feminine: true },
  deposit: { label: "Acompte", feminine: false },
  deposit_outcome: { label: "Issue d'acompte", feminine: true },
  payment: { label: "Paiement", feminine: false },
  product: { label: "Fiche produit", feminine: true },
  lot: { label: "Lot", feminine: false },
  unit: { label: "Pièce", feminine: true },
  stock_movement: { label: "Mouvement de stock", feminine: false },
  category: { label: "Catégorie", feminine: true },
  app: { label: "Application", feminine: true },
};

export function entityLabel(entity: string): string {
  return ENTITIES[entity]?.label ?? entity;
}

const MOVEMENT_TITLES: Record<string, string> = {
  PURCHASE: "Entrée en stock",
  CONSUMPTION: "Consommation en séance",
  LOSS: "Perte",
  EXPIRATION: "Sortie pour péremption",
  RETURN: "Retour",
  ADJUSTMENT: "Ajustement de stock",
};

const OUTCOME_TITLES: Record<string, string> = {
  APPLIED: "Acompte déduit d'une séance",
  FORFEITED: "Acompte déclaré perdu",
  REFUNDED: "Acompte remboursé",
};

const FORM_KINDS: Record<string, string> = {
  HEALTH: "Questionnaire de santé",
  CONSENT: "Consentement",
};

const DOCUMENT_KINDS: Record<string, string> = {
  HEALTH_SIGNED: "Questionnaire de santé signé",
  CONSENT_SIGNED: "Consentement signé",
  OTHER: "Autre document",
};

const EXPORT_KINDS: Record<string, string> = {
  PAYMENTS: "journal des encaissements",
  SESSIONS: "séances",
  TRACEABILITY: "registre de traçabilité",
};

const PROJECT_STATUSES: Record<string, string> = {
  ACTIVE: "En cours",
  COMPLETED: "Terminé",
  ABANDONED: "Abandonné",
};

/** Libellés des champs, dans l'ordre d'affichage. */
const FIELDS: Record<string, string> = {
  first_name: "Prénom",
  last_name: "Nom",
  birth_date: "Date de naissance",
  phone: "Téléphone",
  email: "E-mail",
  address: "Adresse",
  client_id: "Client",
  project_id: "Projet",
  title: "Titre",
  session_id: "Séance",
  lot_id: "Lot",
  name: "Nom",
  brand: "Marque",
  product_id: "Fiche produit",
  lot_number: "Numéro de lot",
  category_id: "Catégorie",
  parent_id: "Rangée dans",
  date: "Date",
  start_time: "Heure",
  duration_minutes: "Durée",
  status: "Statut",
  kind: "Type",
  form_version: "Version du formulaire",
  original_name: "Fichier",
  size_bytes: "Taille",
  type: "Mouvement",
  quantity: "Quantité",
  opened_at: "Ouverte le",
  outcome: "Issue",
  deposit_id: "Acompte",
  amount_cents: "Montant",
  method: "Mode de paiement",
  received_on: "Reçu le",
  paid_on: "Payé le",
  price_cents: "Prix",
  quoted_price_cents: "Devis",
  body_area: "Zone",
  description: "Description",
  creation_date: "Date de fabrication",
  expiration_date: "Péremption",
  single_use: "Usage unique",
  after_opening_months: "Durée après ouverture",
  product_url: "Lien du produit",
  low_stock_threshold: "Seuil de stock bas",
  low_stock_mode: "Alerte de stock bas",
  reason: "Motif",
  note: "Note",
  notes: "Notes",
  void_reason: "Motif d'annulation",
  voided_at: "Annulé le",
  // Événements de l'app
  automatic: "Automatique",
  enabled: "Activé",
  minutes: "Délai",
  folder: "Dossier",
  backup: "Sauvegarde",
  with_recovery_key: "Avec la clé de secours",
  existing_data: "Données existantes chiffrées",
  from: "Du",
  to: "Au",
  rows: "Lignes",
};

/** Champs techniques sans intérêt à l'écran (déjà dits par le titre ou le nom). */
const HIDDEN_FIELDS = new Set(["unit_id", "session_usage_id"]);

/** Champs déjà dits par le titre d'une création ou d'un événement. */
const TITLE_FIELDS: Record<string, string[]> = {
  stock_movement: ["type"],
  deposit_outcome: ["outcome"],
  session_form: ["kind"],
  app: ["kind", "automatic", "enabled"],
};

/** Champs qui désignent une autre fiche : affichés par leur nom. */
const REFERENCE_FIELDS = new Set([
  "client_id",
  "project_id",
  "session_id",
  "lot_id",
  "category_id",
  "parent_id",
  "deposit_id",
  "product_id",
]);

const DATE_FIELDS = new Set([
  "birth_date",
  "date",
  "received_on",
  "paid_on",
  "creation_date",
  "expiration_date",
  "from",
  "to",
]);
const TIMESTAMP_FIELDS = new Set(["voided_at", "opened_at"]);
const BOOLEAN_FIELDS = new Set([
  "single_use",
  "automatic",
  "enabled",
  "with_recovery_key",
  "existing_data",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function changed(entry: AuditEntry, field: string): AuditChange | undefined {
  return entry.changes.find((change) => change.field === field);
}

/** Valeur actuelle d'un champ dans l'entrée (après, ou avant pour une suppression). */
function valueOf(entry: AuditEntry, field: string): unknown {
  const change = changed(entry, field);
  if (!change) return null;
  return entry.action === "DELETE" ? change.before : change.after;
}

function verb(entity: string, masculine: string, feminine: string): string {
  return `${entityLabel(entity)} ${ENTITIES[entity]?.feminine ? feminine : masculine}`;
}

function eventTitle(entry: AuditEntry): string {
  switch (entry.action) {
    case "JOURNAL_STARTED":
      return "Début du journal";
    case "SECURITY_ENABLED":
      return "Protection par mot de passe activée";
    case "PASSWORD_CHANGED":
      return "Mot de passe changé";
    case "RECOVERY_KEY_RENEWED":
      return "Nouvelle clé de secours créée";
    case "TOUCH_ID_CHANGED":
      return valueOf(entry, "enabled") === true ? "Touch ID activé" : "Touch ID désactivé";
    case "AUTO_LOCK_CHANGED":
      return "Verrouillage automatique modifié";
    case "BACKUP_FOLDER_CHANGED":
      return valueOf(entry, "folder")
        ? "Dossier de sauvegarde choisi"
        : "Sauvegarde externe arrêtée";
    case "BACKUP_CREATED":
      return valueOf(entry, "automatic") === true
        ? "Sauvegarde automatique"
        : "Sauvegarde manuelle";
    case "BACKUP_RESTORED":
      return "Sauvegarde restaurée";
    case "KEY_ROTATED":
      return "Données rechiffrées avec une nouvelle clé";
    case "DATA_RESET":
      return "Données réinitialisées";
    case "CSV_EXPORTED": {
      const kind = text(valueOf(entry, "kind"));
      return `Export CSV${kind && EXPORT_KINDS[kind] ? ` : ${EXPORT_KINDS[kind]}` : ""}`;
    }
    default:
      return entry.action;
  }
}

/** Titre d'une entrée : « Séance créée », « Paiement annulé », « Pièce ouverte »… */
export function describeEntry(entry: AuditEntry): string {
  const { entity, action } = entry;
  if (entity === "app") return eventTitle(entry);

  if (action === "CREATE") {
    switch (entity) {
      case "session_form": {
        const kind = text(valueOf(entry, "kind"));
        return `${(kind && FORM_KINDS[kind]) ?? "Questionnaire"} rempli`;
      }
      case "session_document":
        return "Document joint";
      case "session_usage":
        return "Produit lié à la séance";
      case "session_usage_void":
        return "Lien produit annulé";
      case "deposit":
        return "Acompte reçu";
      case "deposit_outcome": {
        const outcome = text(valueOf(entry, "outcome"));
        return (outcome && OUTCOME_TITLES[outcome]) ?? "Issue d'acompte enregistrée";
      }
      case "payment":
        return "Paiement enregistré";
      case "stock_movement": {
        const type = text(valueOf(entry, "type"));
        return (type && MOVEMENT_TITLES[type]) ?? "Mouvement de stock";
      }
      default:
        return verb(entity, "créé", "créée");
    }
  }
  if (action === "DELETE") return verb(entity, "supprimé", "supprimée");

  const voided = changed(entry, "voided_at");
  if (voided && voided.before === null && voided.after !== null) {
    return verb(entity, "annulé", "annulée");
  }
  if (entity === "unit") {
    const opened = changed(entry, "opened_at");
    if (opened && opened.before === null) return "Pièce ouverte";
  }
  if (entity === "session_form") {
    const kind = text(valueOf(entry, "kind")) ?? "";
    return `${FORM_KINDS[kind] ?? "Questionnaire"} modifié`;
  }
  return verb(entity, "modifié", "modifiée");
}

/** Phrase d'explication quand le détail n'est volontairement pas recopié. */
export function hiddenDetailNote(entry: AuditEntry): string | null {
  if (entry.entity === "session_form" && entry.action === "UPDATE") {
    return "Les réponses ne sont pas recopiées dans le journal.";
  }
  return null;
}

export function fieldLabel(field: string): string {
  return FIELDS[field] ?? field;
}

function enumLabel(entity: string, field: string, value: string): string | null {
  switch (field) {
    case "status":
      return entity === "project"
        ? (PROJECT_STATUSES[value] ?? null)
        : (SESSION_STATUS_LABELS[value as keyof typeof SESSION_STATUS_LABELS] ?? null);
    case "method":
      return PAYMENT_METHOD_LABELS[value as keyof typeof PAYMENT_METHOD_LABELS] ?? null;
    case "type":
      return MOVEMENT_TITLES[value] ?? null;
    case "outcome":
      return OUTCOME_TITLES[value] ?? null;
    case "low_stock_mode":
      return value === "EACH" ? "Pour chaque produit" : value === "TOTAL" ? "Au total" : null;
    case "kind":
      return FORM_KINDS[value] ?? DOCUMENT_KINDS[value] ?? EXPORT_KINDS[value] ?? null;
    default:
      return null;
  }
}

/** Valeur lisible d'un champ. `names` : noms des fiches citées (fournis par Rust). */
export function formatValue(
  entity: string,
  field: string,
  value: unknown,
  names: Record<string, string>,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (REFERENCE_FIELDS.has(field) && typeof value === "string") {
    return names[value] ?? "fiche supprimée";
  }
  if (BOOLEAN_FIELDS.has(field)) return value === true || value === 1 ? "Oui" : "Non";
  if (typeof value === "number") {
    if (field.endsWith("_cents")) return formatEuros(value);
    if (field === "duration_minutes") return formatDuration(value);
    if (field === "after_opening_months") return `${value} mois`;
    if (field === "minutes") return `${value} min`;
    if (field === "size_bytes") return formatBytes(value);
    return value.toLocaleString("fr-FR");
  }
  if (typeof value === "string") {
    if (DATE_FIELDS.has(field) && ISO_DATE.test(value)) return formatIsoDate(value);
    if (TIMESTAMP_FIELDS.has(field)) {
      return ISO_DATE.test(value) ? formatIsoDate(value) : formatTimestamp(value);
    }
    return enumLabel(entity, field, value) ?? value;
  }
  return JSON.stringify(value);
}

export type ChangeLine = { field: string; label: string; before: string | null; after: string };

/**
 * Lignes affichées sous le titre. Création et événement : « Champ : valeur ».
 * Modification : « Champ : avant → après ». Suppression : la valeur perdue.
 */
export function changeLines(entry: AuditEntry, names: Record<string, string>): ChangeLine[] {
  const order = Object.keys(FIELDS);
  const rank = (field: string) => {
    const index = order.indexOf(field);
    return index === -1 ? order.length : index;
  };
  const titleField = entry.action === "UPDATE" ? null : TITLE_FIELDS[entry.entity];
  // Fiche liée déjà nommée dans le titre de l'entrée (« Léa Martin · 15/10/2026 »).
  const inLabel = (change: AuditChange) => {
    const id = entry.action === "DELETE" ? change.before : change.after;
    const name = typeof id === "string" ? names[id] : undefined;
    return entry.action !== "UPDATE" && name !== undefined && (entry.label ?? "").includes(name);
  };
  return (
    entry.changes
      .filter((change) => !HIDDEN_FIELDS.has(change.field))
      .filter((change) => !titleField?.includes(change.field))
      // Installation neuve : rien à chiffrer, rien à dire.
      .filter((change) => !(change.field === "existing_data" && change.after === false))
      .filter((change) => !(REFERENCE_FIELDS.has(change.field) && inLabel(change)))
      .sort((a, b) => rank(a.field) - rank(b.field))
      .map((change) => {
        const format = (value: unknown) => formatValue(entry.entity, change.field, value, names);
        const label = fieldLabel(change.field);
        if (entry.action === "UPDATE") {
          return {
            field: change.field,
            label,
            before: format(change.before),
            after: format(change.after),
          };
        }
        const value = entry.action === "DELETE" ? change.before : change.after;
        return { field: change.field, label, before: null, after: format(value) };
      })
  );
}

/** Fiche à ouvrir depuis une entrée, si elle a un sens. */
export type EntryTarget =
  | { kind: "client"; id: string }
  | { kind: "session"; id: string }
  | { kind: "lot"; id: string }
  | { kind: "product"; id: string };

export function entryTarget(entry: AuditEntry): EntryTarget | null {
  if (entry.action === "DELETE" && ["client", "session", "lot"].includes(entry.entity)) {
    return null;
  }
  const stock = ["lot", "unit", "stock_movement"].includes(entry.entity);
  if (stock && entry.lotId) return { kind: "lot", id: entry.lotId };
  if (entry.entity === "client" && entry.entityId) return { kind: "client", id: entry.entityId };
  if (entry.sessionId) return { kind: "session", id: entry.sessionId };
  if (entry.lotId) return { kind: "lot", id: entry.lotId };
  if (entry.clientId) return { kind: "client", id: entry.clientId };
  if (entry.entity === "product" && entry.entityId) return { kind: "product", id: entry.entityId };
  return null;
}

/** Horodatage UTC → jour local `AAAA-MM-JJ`, pour grouper la liste par jour. */
export function localDay(occurredAt: string): string {
  const date = new Date(`${occurredAt}Z`);
  if (Number.isNaN(date.getTime())) return occurredAt.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const timeFormat = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Horodatage UTC → heure locale « 10:15 ». */
export function localTime(occurredAt: string): string {
  const date = new Date(`${occurredAt}Z`);
  return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
}
