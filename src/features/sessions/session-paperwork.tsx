import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type ReactNode } from "react";
import { btnGhost, btnPrimary, cardClass } from "../../components/styles";
import { useConfirm } from "../../components/use-confirm";
import { formatTimestamp } from "../../lib/format";
import {
  usePaperworkStore,
  type DocumentKind,
  type FormKind,
  type Paperwork,
  type SessionDocument,
} from "../../stores/paperwork-store";
import { toast } from "../../stores/toast-store";

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

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-surface-3 text-fg-muted",
    warning: "bg-warning/15 text-warning",
    success: "bg-success/15 text-success",
  };
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[12px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
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
  if (signed) return { tone: "success", label: "Signé" };
  if (!exists) return { tone: "neutral", label: "À remplir" };
  if (missing > 0)
    return {
      tone: "warning",
      label: `Incomplet · ${missing} réponse${missing > 1 ? "s" : ""} manquante${missing > 1 ? "s" : ""}`,
    };
  return { tone: "neutral", label: "Prêt à imprimer et signer" };
}

/**
 * Questionnaire de santé, consentement et documents signés d'une séance.
 * Monté avec une `key` qui change après chaque retour de formulaire : rechargement.
 */
export function SessionPaperwork({
  sessionId,
  onOpenForm,
  aftercareExplained,
  onAftercareExplained,
  aftercareBusy = false,
  readOnly = false,
}: {
  sessionId: string;
  onOpenForm: (kind: FormKind, paperwork: Paperwork) => void;
  aftercareExplained: boolean;
  onAftercareExplained: (explained: boolean) => void;
  aftercareBusy?: boolean;
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
    return <p className="text-[13px] text-danger">{error}</p>;
  }
  if (!paperwork) {
    return <p className="text-[13px] text-fg-muted">Chargement des documents…</p>;
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

  const formCard = (
    kind: FormKind,
    title: string,
    state: { tone: Tone; label: string },
    exists: boolean,
    signed: boolean,
    signedKind: DocumentKind,
  ) => (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[14px] font-medium">{title}</p>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {(exists || !readOnly) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpenForm(kind, paperwork)}
            className={exists || readOnly ? btnGhost : btnPrimary}
          >
            {signed || readOnly ? "Voir les réponses" : exists ? "Modifier" : "Remplir"}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => store.print(sessionId, kind))}
          className={btnGhost}
        >
          Imprimer
        </button>
        {!signed && !readOnly && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void attach(signedKind)}
            className={btnGhost}
          >
            Joindre le scan signé
          </button>
        )}
      </div>
    </li>
  );

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[14px] font-medium">Documents</h2>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">
          Remplis avec le client, imprime, fais signer, puis joins le scan ou une photo.
        </p>
      </div>
      <label className="flex items-start gap-2.5 text-[13.5px] text-fg">
        <input
          type="checkbox"
          checked={aftercareExplained}
          disabled={readOnly || busy || aftercareBusy}
          onChange={(event) => onAftercareExplained(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
        />
        J’ai expliqué les règles d’hygiène après le tatouage.
      </label>

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

      <ul className={`${cardClass} divide-y divide-line`}>
        {formCard(
          "HEALTH",
          "Questionnaire de santé",
          health,
          paperwork.health !== null,
          paperwork.healthSigned,
          "HEALTH_SIGNED",
        )}
        {formCard(
          "CONSENT",
          "Consentement éclairé",
          consent,
          paperwork.consent !== null,
          paperwork.consentSigned,
          "CONSENT_SIGNED",
        )}
        <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-[14px] font-medium">Conseils de cicatrisation</p>
            <p className="mt-0.5 text-[12.5px] text-fg-muted">Fiche à remettre au client.</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => store.openAftercare())}
            className={btnGhost}
          >
            Ouvrir la fiche
          </button>
        </li>
      </ul>

      <div className="mt-2 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium text-fg-muted">Fichiers joints</h3>
        {!readOnly && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void attach("OTHER")}
            className={btnGhost}
          >
            Joindre un autre document
          </button>
        )}
      </div>
      {paperwork.documents.length === 0 ? (
        <p className={`${cardClass} px-4 py-5 text-center text-[13px] text-fg-muted`}>
          Aucun fichier joint.
        </p>
      ) : (
        <ul className={`${cardClass} divide-y divide-line`}>
          {paperwork.documents.map((document) => (
            <li key={document.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-[13.5px] font-medium ${document.voidReason ? "text-fg-muted line-through" : ""}`}
                >
                  {document.originalName}
                </p>
                <p className="mt-0.5 text-[12.5px] text-fg-muted">
                  {DOCUMENT_LABELS[document.kind]} · {formatTimestamp(document.createdAt)} ·{" "}
                  {formatSize(document.sizeBytes)}
                </p>
                {document.voidReason && (
                  <p className="mt-0.5 text-[12.5px] text-fg-muted">
                    Annulé
                    {document.voidedAt ? ` le ${formatTimestamp(document.voidedAt)}` : ""} :{" "}
                    {document.voidReason}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => store.open(document.id))}
                  className={btnGhost}
                >
                  Ouvrir
                </button>
                {!readOnly && !document.voidReason && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void voidDocument(document)}
                    className={btnGhost}
                  >
                    Annuler
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
