import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const OPEN_DELAY_MS = 280;
const CLOSE_DELAY_MS = 160;
const PANEL_WIDTH = 288;
const GAP = 8;

type TimerIds = { open: number | null; close: number | null };

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clearKind(timers: TimerIds, kind: "open" | "close") {
  const id = timers[kind];
  if (id !== null) window.clearTimeout(id);
  timers[kind] = null;
}

/**
 * Explication stable, à côté d'un titre. S'ouvre au survol (après un court délai),
 * au focus clavier et au clic. Un bouton serait ignoré dans un formulaire archivé
 * (`fieldset disabled`) : le déclencheur est donc un contrôle au rôle bouton.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const noteId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openBeforePointer = useRef(false);
  const overRef = useRef(false);
  const focusRef = useRef(false);
  const suppressedRef = useRef(false);
  const timers = useRef<TimerIds>({ open: null, close: null });

  const [hoverOpen, setHoverOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  const [suppressed, setSuppressed] = useState(false);

  const open = !suppressed && (hoverOpen || focusOpen || forceOpen);

  const dismiss = useCallback(() => {
    clearKind(timers.current, "open");
    clearKind(timers.current, "close");
    suppressedRef.current = true;
    setSuppressed(true);
    setHoverOpen(false);
    setForceOpen(false);
  }, []);

  const reveal = useCallback(() => {
    clearKind(timers.current, "open");
    suppressedRef.current = false;
    setSuppressed(false);
    setForceOpen(true);
  }, []);

  function pointerEnter() {
    overRef.current = true;
    clearKind(timers.current, "close");
    if (suppressedRef.current || hoverOpen || focusOpen || forceOpen) return;
    clearKind(timers.current, "open");
    const delay = prefersReducedMotion() ? 0 : OPEN_DELAY_MS;
    timers.current.open = window.setTimeout(() => setHoverOpen(true), delay);
  }

  function pointerLeave() {
    overRef.current = false;
    clearKind(timers.current, "open");
    const delay = prefersReducedMotion() ? 0 : CLOSE_DELAY_MS;
    timers.current.close = window.setTimeout(() => {
      setHoverOpen(false);
      setForceOpen(false);
      if (!focusRef.current) {
        suppressedRef.current = false;
        setSuppressed(false);
      }
    }, delay);
  }

  useEffect(() => {
    const current = timers.current;
    return () => {
      clearKind(current, "open");
      clearKind(current, "close");
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    function place() {
      const anchor = triggerRef.current;
      const current = panelRef.current;
      if (!anchor || !current) return;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const width = Math.min(PANEL_WIDTH, viewport.width - GAP * 2);
      current.style.width = `${width}px`;
      const height = current.offsetHeight;
      const spaceBelow = viewport.height - anchor.getBoundingClientRect().bottom - GAP;
      const rect = anchor.getBoundingClientRect();
      const openUp = spaceBelow < height && rect.top > spaceBelow;
      const preferred = openUp ? rect.top - GAP - height : rect.bottom + GAP;
      const top = Math.max(GAP, Math.min(preferred, viewport.height - height - GAP));
      const left = Math.max(GAP, Math.min(rect.left, viewport.width - width - GAP));
      current.style.top = `${top}px`;
      current.style.left = `${left}px`;
    }

    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      dismiss();
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      dismiss();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, dismiss]);

  function onMouseDown(event: ReactMouseEvent<HTMLSpanElement>) {
    // Le clic souris n'enlève pas le focus clavier : le survol peut se refermer tout seul.
    event.preventDefault();
    event.stopPropagation();
    openBeforePointer.current = open;
  }

  function onClick(event: ReactMouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (openBeforePointer.current) dismiss();
    else reveal();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLSpanElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    if (open) dismiss();
    else reveal();
  }

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-label={`Informations : ${label}`}
        aria-expanded={open}
        aria-controls={open ? noteId : undefined}
        onMouseEnter={pointerEnter}
        onMouseLeave={pointerLeave}
        onMouseDown={onMouseDown}
        onClick={onClick}
        onFocus={() => {
          focusRef.current = true;
          setFocusOpen(true);
        }}
        onBlur={() => {
          focusRef.current = false;
          setFocusOpen(false);
          if (!overRef.current) {
            suppressedRef.current = false;
            setSuppressed(false);
            setForceOpen(false);
          }
        }}
        onKeyDown={onKeyDown}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-info hover:bg-info/10"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 7.25V11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8" cy="5.15" r="0.75" fill="currentColor" />
        </svg>
      </span>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={noteId}
              role="note"
              aria-label={label}
              onMouseEnter={pointerEnter}
              onMouseLeave={pointerLeave}
              className="fixed z-[60] rounded-md border border-line-strong bg-surface px-3 py-2 text-left text-[13px] leading-snug text-fg shadow-[0_12px_40px_-24px_rgba(0,0,0,.6)]"
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
