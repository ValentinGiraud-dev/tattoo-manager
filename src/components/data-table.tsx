import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  clampPage,
  pageCount,
  pageSlice,
  rangeLabel,
  visiblePages,
} from "../lib/pagination";

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Classes de la cellule (largeur, couleur). */
  className?: string;
}

export interface DataTableAction {
  id: string;
  label: string;
  onSelect: () => void;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Nom lu par le lecteur d'écran, et dans le bouton d'actions. */
  rowLabel: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Menu « … » en fin de ligne. Le clic n'ouvre pas la fiche. */
  rowActions?: (row: T) => DataTableAction[];
  /** Remet la page à 1 quand la recherche ou le filtre change. */
  pageResetKey?: string;
  label?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowLabel,
  onRowClick,
  rowActions,
  pageResetKey = "",
  label,
}: DataTableProps<T>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [seenReset, setSeenReset] = useState(pageResetKey);

  let nextPage = page;
  if (pageResetKey !== seenReset) {
    setSeenReset(pageResetKey);
    nextPage = 1;
  }
  const bounded = clampPage(nextPage, rows.length, pageSize);
  if (bounded !== page) setPage(bounded);

  const current = bounded;
  const slice = pageSlice(rows, current, pageSize);
  const pages = visiblePages(current, rows.length, pageSize);
  const lastPage = pageCount(rows.length, pageSize);

  function onRowKeyDown(event: ReactKeyboardEvent<HTMLTableRowElement>, row: T) {
    if (!onRowClick || event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onRowClick(row);
  }

  return (
    <div className="rounded-lg border border-line bg-surface">
      <table className="w-full table-fixed border-collapse text-left" aria-label={label}>
        <thead>
          <tr className="border-b border-line">
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={`px-4 py-3 text-[12.5px] font-normal whitespace-nowrap text-fg-faint ${column.className ?? ""}`}
              >
                {column.header}
              </th>
            ))}
            {rowActions ? <th scope="col" className="w-14 px-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {slice.map((row) => {
            const key = rowKey(row);
            const name = rowLabel(row);
            const actions = rowActions?.(row) ?? [];
            return (
              <tr
                key={key}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (event) => onRowKeyDown(event, row) : undefined}
                className={`border-b border-line last:border-b-0 ${
                  onRowClick ? "cursor-pointer hover:bg-surface-2" : ""
                }`}
              >
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={`px-4 py-3 text-[13.5px] text-fg-muted ${column.className ?? ""}`}
                  >
                    <span className="block truncate">{column.cell(row)}</span>
                  </td>
                ))}
                {rowActions ? (
                  <td className="px-2 py-2 text-right">
                    {actions.length > 0 ? <RowMenu label={name} actions={actions} /> : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line px-4 py-2.5 text-[13px] text-fg-muted">
        <p>{rangeLabel(current, rows.length, pageSize)}</p>
        <div className="flex items-center gap-2">
          <select
            aria-label="Résultats par page"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
            className="h-7 rounded-md border border-line-strong bg-surface pl-2 text-[13px] text-fg outline-none focus-visible:border-accent"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span>par page</span>
        </div>
        <nav aria-label="Pagination" className="flex items-center justify-end gap-1">
          <PageStep
            label="Page précédente"
            direction="previous"
            disabled={current <= 1}
            onClick={() => setPage(current - 1)}
          />
          <ol className="flex items-center">
            {pages.map((number, index) => (
              <li key={number} className="flex items-center">
                {index > 0 ? (
                  <span aria-hidden="true" className="px-0.5 text-fg-faint">
                    |
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={`Page ${number}`}
                  aria-current={number === current ? "page" : undefined}
                  onClick={() => setPage(number)}
                  className={`grid h-7 min-w-7 place-items-center rounded-sm px-1.5 text-[13px] ${
                    number === current ? "border border-fg text-fg" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {number}
                </button>
              </li>
            ))}
          </ol>
          <PageStep
            label="Page suivante"
            direction="next"
            disabled={current >= lastPage}
            onClick={() => setPage(current + 1)}
          />
        </nav>
      </div>
    </div>
  );
}

function PageStep({
  label,
  direction,
  disabled,
  onClick,
}: {
  label: string;
  direction: "previous" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-35"
    >
      <Chevron direction={direction} />
    </button>
  );
}

function RowMenu({ label, actions }: { label: string; actions: DataTableAction[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target)) return;
      const element = target instanceof Element ? target : target.parentElement;
      if (element?.closest("[data-row-menu]")) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function toggle(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + 4, left: rect.right });
    setOpen(true);
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']");
    const index = Array.from(items).findIndex((item) => item === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = items[(index + step + items.length) % items.length];
    next?.focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Actions pour ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        onKeyDown={(event) => event.stopPropagation()}
        className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
      >
        <Dots />
      </button>
      {open && position
        ? createPortal(
            <div
              id={menuId}
              data-row-menu=""
              role="menu"
              aria-label={`Actions pour ${label}`}
              onKeyDown={onMenuKeyDown}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              style={{ top: position.top, left: position.left }}
              className="fixed z-30 min-w-36 -translate-x-full rounded-md border border-line bg-surface p-1"
            >
              {actions.map((action, index) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  autoFocus={index === 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    action.onSelect();
                  }}
                  className="block w-full rounded-sm px-3 py-1.5 text-left text-[13px] text-fg hover:bg-surface-2"
                >
                  {action.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function Dots() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.15" fill="currentColor" />
      <circle cx="8" cy="8" r="1.15" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.15" fill="currentColor" />
    </svg>
  );
}

function Chevron({ direction }: { direction: "previous" | "next" }) {
  const left = direction === "previous";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      <path
        d={left ? "M8.5 3.2 4.8 7l3.7 3.8" : "M5.5 3.2 9.2 7 5.5 10.8"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

