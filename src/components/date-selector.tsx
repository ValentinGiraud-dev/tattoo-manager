import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

type DateSelectorProps = {
  name?: string;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /** Année min / max (défaut : 1920 → année courante) */
  minYear?: number;
  maxYear?: number;
};

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplay(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

/** Lundi = 0 … Dimanche = 6 */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function clampYear(year: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, year));
}

export function DateSelector({
  name,
  value,
  defaultValue = null,
  onChange,
  placeholder = "Choisir une date",
  id,
  disabled = false,
  minYear = 1920,
  maxYear = new Date().getFullYear(),
}: DateSelectorProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string | null>(defaultValue ?? null);
  const selectedIso = isControlled ? (value ?? null) : internal;
  const selected = useMemo(() => parseIso(selectedIso), [selectedIso]);

  const [open, setOpen] = useState(false);
  const initialCursor = selected ?? new Date();
  const [cursorYear, setCursorYear] = useState(() =>
    clampYear(initialCursor.getFullYear(), minYear, maxYear),
  );
  const [cursorMonth, setCursorMonth] = useState(() => initialCursor.getMonth());

  /** Ouvre le calendrier sur le mois de la date choisie (ou du jour). */
  function openPicker() {
    const focus = selected ?? new Date();
    setCursorYear(clampYear(focus.getFullYear(), minYear, maxYear));
    setCursorMonth(focus.getMonth());
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function commit(next: string | null) {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }

  function selectDay(day: number) {
    commit(toIso(new Date(cursorYear, cursorMonth, day)));
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    const date = new Date(cursorYear, cursorMonth + delta, 1);
    setCursorYear(clampYear(date.getFullYear(), minYear, maxYear));
    setCursorMonth(date.getMonth());
  }

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = maxYear; y >= minYear; y -= 1) list.push(y);
    return list;
  }, [minYear, maxYear]);

  const cells = useMemo(() => {
    const first = startOfMonth(cursorYear, cursorMonth);
    const offset = mondayIndex(first);
    const total = daysInMonth(cursorYear, cursorMonth);
    const today = new Date();
    const items: {
      day: number | null;
      iso: string | null;
      isToday: boolean;
      isSelected: boolean;
    }[] = [];

    for (let i = 0; i < offset; i += 1) {
      items.push({ day: null, iso: null, isToday: false, isSelected: false });
    }
    for (let day = 1; day <= total; day += 1) {
      const date = new Date(cursorYear, cursorMonth, day);
      items.push({
        day,
        iso: toIso(date),
        isToday: sameDay(date, today),
        isSelected: selected ? sameDay(date, selected) : false,
      });
    }
    while (items.length % 7 !== 0) {
      items.push({ day: null, iso: null, isToday: false, isSelected: false });
    }
    return items;
  }, [cursorYear, cursorMonth, selected]);

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  }

  return (
    <div ref={rootRef} className="relative mt-1.5">
      {name ? <input type="hidden" name={name} value={selectedIso ?? ""} /> : null}

      <div className="flex gap-2">
        <button
          id={fieldId}
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openPicker())}
          onKeyDown={onTriggerKeyDown}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md border border-line-strong bg-bg px-3 py-2 text-left text-[14px] text-fg transition-colors outline-none hover:border-accent focus-visible:border-accent active:scale-[0.995] disabled:opacity-45"
        >
          <span className={`truncate ${selected ? "text-fg" : "text-fg-faint"}`}>
            {selected ? formatDisplay(selected) : placeholder}
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="shrink-0 text-fg-faint"
          >
            <rect
              x="2"
              y="3"
              width="12"
              height="11"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M5 1.5v3M11 1.5v3"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {selected && !disabled ? (
          <button
            type="button"
            aria-label="Effacer la date"
            onClick={() => commit(null)}
            className="rounded-md border border-line-strong px-3 text-[12.5px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg active:scale-[0.97]"
          >
            Effacer
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          role="dialog"
          aria-label="Choisir une date"
          className="absolute z-40 mt-2 w-[min(100%,320px)] rounded-lg border border-line-strong bg-surface p-3 shadow-[0_20px_50px_-28px_rgba(0,0,0,.55)]"
        >
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              aria-label="Mois précédent"
              onClick={() => shiftMonth(-1)}
              className="grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg active:scale-[0.97]"
            >
              ‹
            </button>

            <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
              <label className="sr-only" htmlFor={`${fieldId}-month`}>
                Mois
              </label>
              <select
                id={`${fieldId}-month`}
                value={cursorMonth}
                onChange={(event) => setCursorMonth(Number(event.target.value))}
                className="max-w-[9.5rem] rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-fg outline-none focus:border-accent"
              >
                {MONTHS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>

              <label className="sr-only" htmlFor={`${fieldId}-year`}>
                Année
              </label>
              <select
                id={`${fieldId}-year`}
                value={cursorYear}
                onChange={(event) => setCursorYear(Number(event.target.value))}
                className="rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[13px] text-fg outline-none focus:border-accent"
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              aria-label="Mois suivant"
              onClick={() => shiftMonth(1)}
              className="grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg active:scale-[0.97]"
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="grid h-8 place-items-center text-[11px] font-medium tracking-wide text-fg-faint uppercase"
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((cell, index) =>
              cell.day === null ? (
                <div key={`empty-${index}`} className="h-9" />
              ) : (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => selectDay(cell.day!)}
                  className={[
                    "grid h-9 place-items-center rounded-md text-[13px] transition-colors active:scale-[0.97]",
                    cell.isSelected
                      ? "bg-accent font-medium text-accent-fg"
                      : cell.isToday
                        ? "bg-surface-2 font-medium text-fg"
                        : "text-fg hover:bg-surface-2",
                  ].join(" ")}
                >
                  {cell.day}
                </button>
              ),
            )}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[12.5px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              onClick={() => {
                const today = new Date();
                const year = clampYear(today.getFullYear(), minYear, maxYear);
                setCursorYear(year);
                setCursorMonth(today.getMonth());
                if (year === today.getFullYear()) {
                  commit(toIso(today));
                  setOpen(false);
                }
              }}
            >
              Aujourd’hui
            </button>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[12.5px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              onClick={() => {
                commit(null);
                setOpen(false);
              }}
            >
              Effacer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
