import { formatTimestamp } from "../../lib/format";
import {
  changeLines,
  describeEntry,
  entryTarget,
  hiddenDetailNote,
  localTime,
  type EntryTarget,
} from "../../lib/audit";
import type { AuditEntry } from "../../stores/audit-store";
import { useUIStore } from "../../stores/ui-store";

const TARGET_LABELS: Record<EntryTarget["kind"], string> = {
  client: "Ouvrir le client",
  session: "Ouvrir la séance",
  lot: "Ouvrir le lot",
};

function sameTarget(a: EntryTarget | null, b: EntryTarget | null | undefined) {
  return a !== null && b !== null && b !== undefined && a.kind === b.kind && a.id === b.id;
}

/**
 * Une entrée du journal : heure, ce qui s'est passé, sur quoi, et le détail des champs.
 * `current` : fiche déjà affichée (pas de lien vers elle-même).
 */
export function AuditEntryRow({
  entry,
  names,
  showDate = false,
  current,
}: {
  entry: AuditEntry;
  names: Record<string, string>;
  showDate?: boolean;
  current?: EntryTarget | null;
}) {
  const { openClient, openSession, openLot } = useUIStore();
  const lines = changeLines(entry, names);
  const note = hiddenDetailNote(entry);
  const target = entryTarget(entry);
  const showLink = target !== null && !sameTarget(target, current);

  function open() {
    if (!target) return;
    if (target.kind === "client") openClient(target.id);
    else if (target.kind === "session") openSession(target.id);
    else openLot(target.id);
  }

  return (
    <li className="flex gap-3 px-4 py-2.5">
      <time
        dateTime={`${entry.occurredAt}Z`}
        className={`shrink-0 pt-px text-[12px] text-fg-faint tabular-nums ${showDate ? "w-[132px]" : "w-11"}`}
      >
        {showDate ? formatTimestamp(entry.occurredAt) : localTime(entry.occurredAt)}
      </time>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] text-fg">
          <span className="font-medium">{describeEntry(entry)}</span>
          {entry.label && <span className="text-fg-muted"> · {entry.label}</span>}
        </p>
        {lines.length > 0 && (
          <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
            {lines.map((line) => (
              <div key={line.field} className="contents">
                <dt className="text-fg-faint">{line.label}</dt>
                <dd className="break-words whitespace-pre-line text-fg-muted">
                  {line.before !== null && (
                    <>
                      <span>{line.before}</span>
                      <span aria-label="devient" className="mx-1.5 text-fg-faint">
                        →
                      </span>
                    </>
                  )}
                  <span className={line.before !== null ? "text-fg" : undefined}>{line.after}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {note && <p className="mt-1 text-[12px] text-fg-faint">{note}</p>}
      </div>
      {showLink && (
        <button
          type="button"
          onClick={open}
          className="shrink-0 self-start rounded-sm px-2 py-1 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          {TARGET_LABELS[target.kind]}
        </button>
      )}
    </li>
  );
}
