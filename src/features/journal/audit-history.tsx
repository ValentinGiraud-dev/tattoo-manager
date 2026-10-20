import { useState } from "react";
import { btnGhost, cardClass } from "../../components/styles";
import type { EntryTarget } from "../../lib/audit";
import { appendPage, fetchAuditPage, type AuditPage } from "../../stores/audit-store";
import { errorMessage } from "../../stores/security-store";
import { AuditEntryRow } from "./audit-entry-row";

const PAGE_SIZE = 20;

type State =
  | { status: "closed" }
  | { status: "loading"; page: AuditPage | null }
  | { status: "ready"; page: AuditPage }
  | { status: "error"; page: AuditPage | null; message: string };

/**
 * Historique d'une fiche (client, séance ou lot), replié par défaut.
 * Chaque ouverture relit le journal : il montre toujours l'état à jour.
 */
export function AuditHistory({ target }: { target: EntryTarget }) {
  const [state, setState] = useState<State>({ status: "closed" });
  const page = state.status === "closed" ? null : state.page;

  function fetch(previous: AuditPage | null) {
    const last = previous?.entries[previous.entries.length - 1];
    setState({ status: "loading", page: previous });
    fetchAuditPage({
      clientId: target.kind === "client" ? target.id : null,
      sessionId: target.kind === "session" ? target.id : null,
      lotId: target.kind === "lot" ? target.id : null,
      beforeSeq: last?.seq ?? null,
      limit: PAGE_SIZE,
    })
      .then((next) =>
        setState({ status: "ready", page: previous ? appendPage(previous, next) : next }),
      )
      .catch((error: unknown) =>
        setState({ status: "error", page: previous, message: errorMessage(error) }),
      );
  }

  const open = state.status !== "closed";

  return (
    <section className={cardClass}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => (open ? setState({ status: "closed" }) : fetch(null))}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-[14px] font-medium text-fg">
            Historique des modifications
          </span>
          <span className="block text-[12px] text-fg-faint">
            Tout ce qui a été créé, modifié ou annulé sur cette fiche.
          </span>
        </span>
        <span aria-hidden="true" className="text-[12px] text-fg-faint">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="border-t border-line">
          {page && page.entries.length > 0 && (
            <ul className="divide-y divide-line">
              {page.entries.map((entry) => (
                <AuditEntryRow
                  key={entry.seq}
                  entry={entry}
                  names={page.names}
                  showDate
                  current={target}
                />
              ))}
            </ul>
          )}
          {state.status === "ready" && page?.entries.length === 0 && (
            <p className="px-4 py-4 text-[13px] text-fg-muted">
              Rien dans le journal pour cette fiche : elle n'a pas changé depuis l'arrivée du
              journal.
            </p>
          )}
          {state.status === "loading" && (
            <p className="px-4 py-3 text-[13px] text-fg-faint">Chargement…</p>
          )}
          {state.status === "error" && (
            <div className="flex items-center gap-3 px-4 py-3">
              <p role="alert" className="text-[13px] text-danger">
                {state.message}
              </p>
              <button type="button" onClick={() => fetch(page)} className={btnGhost}>
                Réessayer
              </button>
            </div>
          )}
          {state.status === "ready" && page?.hasMore && (
            <div className="border-t border-line px-4 py-3">
              <button type="button" onClick={() => fetch(page)} className={btnGhost}>
                Afficher plus
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
