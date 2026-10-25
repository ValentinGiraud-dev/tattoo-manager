import { useEffect, useState } from "react";
import { ArchiveMention } from "../../components/archive-controls";
import { btnPrimary } from "../../components/styles";
import { SESSION_STATUS_LABELS } from "../../lib/labels";
import { formatIsoDate } from "../../lib/format";
import { todayIso } from "../../stores/billing-store";
import { useClientsStore } from "../../stores/clients-store";
import { useUIStore } from "../../stores/ui-store";
import type { SessionUsageItem } from "../../stores/products-store";
import type { SessionListItem } from "../../stores/sessions-store";

type History = { sessions: SessionListItem[]; usages: SessionUsageItem[] };

function EmptySessions({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-line bg-surface px-4 py-10 text-center">
      <p className="text-[13px] text-fg-muted">Aucune séance pour ce client.</p>
      {onAdd ? (
        <button type="button" onClick={onAdd} className={btnPrimary}>
          Ajouter une séance
        </button>
      ) : null}
    </div>
  );
}

/**
 * Traçabilité d'un client : ses séances et, pour chacune, les lots et pièces utilisés.
 * Sans `clientId` (fiche pas encore enregistrée) : carte vide, sans bouton.
 * Monté avec `key={client.id}` : l'état repart de zéro pour chaque client.
 */
export function ClientHistory({
  clientId,
  canAdd = false,
}: {
  clientId?: string;
  canAdd?: boolean;
}) {
  const { listSessions, listUsages } = useClientsStore();
  const openSession = useUIStore((state) => state.openSession);
  const openLot = useUIStore((state) => state.openLot);
  const newSession = useUIStore((state) => state.newSession);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    Promise.all([listSessions(clientId), listUsages(clientId)])
      .then(([sessions, usages]) => {
        if (!cancelled) setHistory({ sessions, usages });
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, listSessions, listUsages]);

  function addSession() {
    if (!clientId) return;
    newSession({ date: todayIso(), startTime: null, clientId });
  }

  const showAdd = canAdd && clientId !== undefined;
  const hasSessions = history !== null && history.sessions.length > 0;

  return (
    <section>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-medium">Séances liées et produits utilisés</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            Historique de traçabilité : lots et pièces utilisés à chaque séance.
          </p>
        </div>
        {showAdd && hasSessions ? (
          <button type="button" onClick={addSession} className={`${btnPrimary} shrink-0`}>
            Ajouter une séance
          </button>
        ) : null}
      </div>

      {!clientId ? (
        <EmptySessions />
      ) : error ? (
        <p className="text-[13px] text-danger">{error}</p>
      ) : history === null ? (
        <p className="text-[13px] text-fg-muted">Chargement…</p>
      ) : history.sessions.length === 0 ? (
        <EmptySessions onAdd={showAdd ? addSession : undefined} />
      ) : (
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {history.sessions.map((session, index) => {
            const usages = history.usages.filter((usage) => usage.sessionId === session.id);
            return (
              <li
                key={session.id}
                className={index > 0 ? "border-t border-line px-4 py-3" : "px-4 py-3"}
              >
                <button
                  type="button"
                  onClick={() => openSession(session.id)}
                  className="text-left text-[14px] font-medium hover:underline"
                >
                  {formatIsoDate(session.date)}
                  {session.startTime ? ` · ${session.startTime}` : ""}
                  {session.title ? ` · ${session.title}` : ""}
                  {session.bodyArea ? ` · ${session.bodyArea}` : ""}
                  {session.archivedAt && <ArchiveMention>séance archivée</ArchiveMention>}
                </button>
                <p className="mt-0.5 text-[12.5px] text-fg-muted">
                  {SESSION_STATUS_LABELS[session.status]}
                  {" · "}
                  {usages.length === 0
                    ? "aucun produit lié"
                    : `${usages.length} produit${usages.length > 1 ? "s" : ""} lié${usages.length > 1 ? "s" : ""}`}
                </p>
                {usages.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1.5 border-l border-line pl-3">
                    {usages.map((usage) => (
                      <li key={usage.id} className="text-[12.5px]">
                        <button
                          type="button"
                          onClick={() => openLot(usage.lotRef)}
                          className={`text-left underline-offset-2 hover:underline ${usage.voidReason ? "text-fg-muted line-through" : "text-fg"}`}
                        >
                          {usage.name} · lot {usage.lotNumber}
                          {usage.singleUse && !usage.voidReason ? ` · ${usage.quantity}` : ""}
                          {usage.lotArchived && <ArchiveMention>lot archivé</ArchiveMention>}
                          {usage.productArchived && <ArchiveMention>fiche archivée</ArchiveMention>}
                        </button>
                        {usage.voidReason && (
                          <span className="text-fg-muted"> · lien annulé : {usage.voidReason}</span>
                        )}
                        {!usage.voidReason && usage.expired && (
                          <span className="text-warning">
                            {" "}
                            <span aria-hidden="true">⚠︎</span> périmé à la date de la séance
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
