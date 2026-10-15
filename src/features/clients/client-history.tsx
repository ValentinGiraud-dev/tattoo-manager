import { useEffect, useState } from "react";
import { SESSION_STATUS_LABELS } from "../../lib/labels";
import { formatIsoDate } from "../../lib/format";
import { useClientsStore } from "../../stores/clients-store";
import { useUIStore } from "../../stores/ui-store";
import type { SessionUsageItem } from "../../stores/products-store";
import type { SessionListItem } from "../../stores/sessions-store";

type History = { sessions: SessionListItem[]; usages: SessionUsageItem[] };

/**
 * Traçabilité d'un client : ses séances et, pour chacune, les lots et pièces utilisés.
 * Monté avec `key={client.id}` : l'état repart de zéro pour chaque client.
 */
export function ClientHistory({ clientId }: { clientId: string }) {
  const { listSessions, listUsages } = useClientsStore();
  const openSession = useUIStore((state) => state.openSession);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  return (
    <section>
      <h2 className="text-[14px] font-medium">Séances et produits utilisés</h2>
      <p className="mt-0.5 mb-3 text-[12.5px] text-fg-muted">
        Historique de traçabilité : lots et pièces utilisés à chaque séance.
      </p>

      {error ? (
        <p className="text-[13px] text-danger">{error}</p>
      ) : history === null ? (
        <p className="text-[13px] text-fg-muted">Chargement…</p>
      ) : history.sessions.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[13px] text-fg-muted">
          Aucune séance pour ce client.
        </p>
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
                  {session.bodyArea ? ` · ${session.bodyArea}` : ""}
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
                        <span
                          className={usage.voidReason ? "text-fg-muted line-through" : "text-fg"}
                        >
                          {usage.name} · lot {usage.lotNumber}
                          {usage.singleUse && !usage.voidReason ? ` · ${usage.quantity}` : ""}
                        </span>
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
