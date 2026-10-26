import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type ReactNode } from "react";
import { cardClass } from "../../components/styles";
import { InfoTip } from "../../components/info-tip";
import { useConfirm } from "../../components/use-confirm";
import { formatTimestamp } from "../../lib/format";
import {
  usePaperworkStore,
  type DocumentKind,
  type FormKind,
  type Paperwork,
  type SessionDocument,
} from "../../stores/paperwork-store";
import type { SessionListItem } from "../../stores/sessions-store";
import { toast } from "../../stores/toast-store";
import { SessionReadiness } from "./session-readiness";

const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  HEALTH_SIGNED: "Questionnaire de santé signé",
  CONSENT_SIGNED: "Consentement signé",
  OTHER: "Autre document",
};

const SCAN_FILTERS = [{ name: "Scan ou photo", extensions: ["pdf", "jpg", "jpeg", "png", "heic"] }];

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

type Tone = "neutral" | "warning" | "success";

function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-surface-3 text-fg-muted",
    warning: "bg-warning/15 text-warning",
    success: "bg-success/15 text-success",
  };
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[12px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  tone = "muted",
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  tone?: "muted" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md p-1.5 transition-colors disabled:opacity-45 ${
        tone === "danger"
          ? "text-fg-muted hover:bg-danger/10 hover:text-danger"
          : "text-fg-muted hover:bg-surface-3 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.2v6.2M5.4 6.1 8 8.7l2.6-2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.2 10.1v1.5c0 .6.5 1.1 1.1 1.1h7.4c.6 0 1.1-.5 1.1-1.1v-1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M9.4 3.1 12.9 6.6 6.1 13.4H2.6V9.9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 8.8V2.6M5.4 4.8 8 2.2l2.6 2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.2 10.1v1.5c0 .6.5 1.1 1.1 1.1h7.4c.6 0 1.1-.5 1.1-1.1v-1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.2 4.4h9.6M6.3 4.3V3h3.4v1.3M4.5 4.4l.5 8.3h6l.5-8.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Alert({ tone, children }: { tone: "warning" | "info"; children: ReactNode }) {
  return (
    <div
      role="note"
      className={
        tone === "warning"
          ? "rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-fg"
          : "rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg-muted"
      }
    >
      {tone === "warning" && <span aria-hidden="true">⚠︎ </span>}
      {children}
    </div>
  );
}

function formState(
  exists: boolean,
  missing: number,
  signed: boolean,
): { tone: Tone; label: string } {
  if (signed) return { tone: "success", label: "Validé" };
  if (!exists) return { tone: "neutral", label: "À remplir" };
  if (missing > 0)
    return {
      tone: "warning",
      label: `Incomplet · ${missing} réponse${missing > 1 ? "s" : ""} manquante${missing > 1 ? "s" : ""}`,
    };
  return { tone: "neutral", label: "Prêt à signer" };
}

/**
 * Questionnaire de santé, consentement et documents signés d'une séance.
 * Monté avec une `key` qui change après chaque retour de formulaire : rechargement.
 */
export function SessionPaperwork({
  sessionId,
  onOpenForm,
  onValidated,
  readOnly = false,
}: {
  sessionId: string;
  onOpenForm: (kind: FormKind, paperwork: Paperwork) => void;
  onValidated: (session: SessionListItem) => void | Promise<void>;
  readOnly?: boolean;
}) {
  const store = usePaperworkStore();
  const confirm = useConfirm();
  const [paperwork, setPaperwork] = useState<Paperwork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    store
      .get(sessionId)
      .then((loaded) => {
        if (!cancelled) setPaperwork(loaded);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, store]);

  /** `success` : message de confirmation d'une écriture (rechargement des documents). */
  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (success) {
        toast.success(success);
        setPaperwork(await store.get(sessionId));
      }
    } catch (actionError) {
      setError(String(actionError));
    } finally {
      setBusy(false);
    }
  }

  async function attach(kind: DocumentKind) {
    const picked = await openFileDialog({
      multiple: false,
      directory: false,
      filters: SCAN_FILTERS,
      title: DOCUMENT_LABELS[kind],
    });
    if (typeof picked !== "string") return;
    const fileName = picked.split(/[\\/]/).pop() ?? picked;
    const freezes =
      kind === "HEALTH_SIGNED"
        ? "Les réponses du questionnaire de santé seront figées."
        : kind === "CONSENT_SIGNED"
          ? "Les réponses du consentement seront figées."
          : null;
    const ok = await confirm({
      title: `Joindre ce document à la séance ?`,
      details: [fileName, DOCUMENT_LABELS[kind]],
      body: [
        "Une copie du fichier est rangée dans le dossier de l'app ; l'original n'est pas modifié.",
        freezes,
        "Un document joint ne se supprime pas : il pourra seulement être annulé avec un motif.",
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: "Joindre le document",
    });
    if (!ok) return;
    await run(() => store.attach(sessionId, kind, picked), "Document joint (chiffré)");
  }

  async function voidDocument(document: SessionDocument) {
    const result = await confirm({
      title: "Annuler ce document ?",
      details: [document.originalName, DOCUMENT_LABELS[document.kind]],
      body:
        document.kind === "OTHER"
          ? "Le document reste listé, barré, avec le motif. Le fichier est conservé."
          : "Le document reste listé, barré, avec le motif. Les réponses correspondantes redeviennent modifiables : il faudra faire signer un nouveau document.",
      reason: { label: "Motif", required: true, placeholder: "Ex. mauvaise page scannée" },
      confirmLabel: "Annuler le document",
      cancelLabel: "Garder",
      tone: "danger",
    });
    if (!result?.reason) return;
    const reason = result.reason;
    await run(() => store.voidDocument(document.id, reason), "Document annulé");
  }

  if (error && !paperwork) {
    return (
      <section id="session-documents" className="scroll-mt-6">
        <p className="text-[13px] text-danger">{error}</p>
      </section>
    );
  }
  if (!paperwork) {
    return (
      <section id="session-documents" className="scroll-mt-6">
        <p className="text-[13px] text-fg-muted">Chargement des documents…</p>
      </section>
    );
  }

  const health = formState(
    paperwork.health !== null,
    paperwork.health?.missing.length ?? 0,
    paperwork.healthSigned,
  );
  const consent = formState(
    paperwork.consent !== null,
    paperwork.consent?.missing.length ?? 0,
    paperwork.consentSigned,
  );
  const flags = paperwork.health?.flags ?? [];
  const unsigned = [
    !paperwork.healthSigned && "questionnaire de santé",
    !paperwork.consentSigned && "consentement",
  ].filter(Boolean);

  const liveScan = (kind: DocumentKind) =>
    paperwork.documents.find((document) => document.kind === kind && !document.voidReason) ?? null;

  const formRow = (
    kind: FormKind,
    title: string,
    state: { tone: Tone; label: string },
    exists: boolean,
    signed: boolean,
    signedKind: DocumentKind,
    when: string | null,
  ) => {
    const scan = liveScan(signedKind);
    const openLabel =
      signed || readOnly ? `Voir ${title}` : exists ? `Modifier ${title}` : `Remplir ${title}`;
    const stamp = scan?.createdAt ?? when;
    return (
      <li className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <p className="text-[14px] font-medium">{title}</p>
            <StatusPill tone={state.tone}>{state.label}</StatusPill>
          </div>
          <p className="mt-0.5 text-[12.5px] text-fg-faint">
            {stamp ? formatTimestamp(stamp) : "Pas encore rempli"}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          {(exists || !readOnly) && (
            <IconButton
              label={openLabel}
              disabled={busy}
              onClick={() => onOpenForm(kind, paperwork)}
            >
              <PencilIcon />
            </IconButton>
          )}
          <IconButton
            label={`Imprimer ${title}`}
            disabled={busy}
            onClick={() => void run(() => store.print(sessionId, kind))}
          >
            <DownloadIcon />
          </IconButton>
          {!signed && !readOnly && (
            <IconButton
              label={`Joindre le scan signé, ${title}`}
              disabled={busy}
              onClick={() => void attach(signedKind)}
            >
              <UploadIcon />
            </IconButton>
          )}
          {scan && !readOnly && (
            <IconButton
              label={`Annuler le scan, ${title}`}
              disabled={busy}
              tone="danger"
              onClick={() => void voidDocument(scan)}
            >
              <TrashIcon />
            </IconButton>
          )}
        </div>
      </li>
    );
  };

  const extraDocuments = paperwork.documents.filter(
    (document) =>
      document.kind === "OTHER" ||
      ((document.kind === "HEALTH_SIGNED" || document.kind === "CONSENT_SIGNED") &&
        document.voidReason),
  );

  return (
    <section id="session-documents" className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex items-center gap-1">
        <h2 className="text-[14px] font-medium">Documents</h2>
        <InfoTip label="Documents">À remplir par le client, puis par toi.</InfoTip>
      </div>

      {paperwork.clientMinor === true && (
        <Alert tone="warning">
          Client mineur : {paperwork.clientAge} ans à la date de la séance. L&apos;autorisation
          écrite d&apos;un représentant légal présent pendant l&apos;acte est obligatoire.
        </Alert>
      )}
      {paperwork.clientMinor === null && (
        <Alert tone="info">
          Date de naissance manquante dans la fiche client : la majorité ne peut pas être vérifiée.
        </Alert>
      )}
      {flags.length > 0 && (
        <Alert tone="warning">Points d&apos;attention santé : {flags.join(" · ")}</Alert>
      )}
      {paperwork.sessionStatus === "COMPLETED" && unsigned.length > 0 && (
        <Alert tone="warning">Séance terminée sans {unsigned.join(" ni ")} signé joint.</Alert>
      )}

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <div className={cardClass}>
        <ul className="divide-y divide-line">
          {formRow(
            "HEALTH",
            "Questionnaire de santé",
            health,
            paperwork.health !== null,
            paperwork.healthSigned,
            "HEALTH_SIGNED",
            paperwork.health?.updatedAt ?? null,
          )}
          {formRow(
            "CONSENT",
            "Consentement éclairé",
            consent,
            paperwork.consent !== null,
            paperwork.consentSigned,
            "CONSENT_SIGNED",
            paperwork.consent?.updatedAt ?? null,
          )}
          <li className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 text-[14px] font-medium">
                Conseils de cicatrisation
                <InfoTip label="Conseils de cicatrisation">Fiche à remettre au client.</InfoTip>
              </p>
            </div>
            <IconButton
              label="Ouvrir la fiche de cicatrisation"
              disabled={busy}
              onClick={() => void run(() => store.openAftercare())}
            >
              <DownloadIcon />
            </IconButton>
          </li>
          {extraDocuments.map((document) => (
            <li key={document.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-[14px] font-medium ${document.voidReason ? "text-fg-muted line-through" : ""}`}
                >
                  {document.originalName}
                </p>
                <p className="mt-0.5 text-[12.5px] text-fg-faint">
                  {DOCUMENT_LABELS[document.kind]} · {formatTimestamp(document.createdAt)} ·{" "}
                  {formatSize(document.sizeBytes)}
                  {document.voidReason
                    ? ` · Annulé${document.voidedAt ? ` le ${formatTimestamp(document.voidedAt)}` : ""} : ${document.voidReason}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <IconButton
                  label={`Ouvrir ${document.originalName}`}
                  disabled={busy}
                  onClick={() => void run(() => store.open(document.id))}
                >
                  <DownloadIcon />
                </IconButton>
                {!readOnly && !document.voidReason && (
                  <IconButton
                    label={`Annuler ${document.originalName}`}
                    disabled={busy}
                    tone="danger"
                    onClick={() => void voidDocument(document)}
                  >
                    <TrashIcon />
                  </IconButton>
                )}
              </div>
            </li>
          ))}
        </ul>
        {!readOnly && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void attach("OTHER")}
            className="w-full border-t border-line px-4 py-3 text-center text-[13.5px] text-fg-muted transition-colors hover:text-fg disabled:opacity-45"
          >
            + Ajouter un document
          </button>
        )}
        <SessionReadiness
          sessionId={sessionId}
          sessionStatus={paperwork.sessionStatus}
          healthSigned={paperwork.healthSigned}
          consentSigned={paperwork.consentSigned}
          readiness={paperwork.readiness}
          reason={paperwork.readinessReason}
          validatedAt={paperwork.readinessValidatedAt}
          readOnly={readOnly}
          onValidated={onValidated}
        />
      </div>
    </section>
  );
}
