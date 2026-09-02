"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { TimelineWidget } from "./TimelineWidget";
import type { ExecutionSnapshot } from "@/lib/engine-types";

export function HistoryOverlay({
  history,
  selectedId,
  onSelect,
  height,
  setHeight,
  onCompare,
}: {
  history: ExecutionSnapshot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  height: number;
  setHeight: (h: number) => void;
  onCompare: () => void;
  open?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onClose?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startH = useRef(96);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    setDragging(true);
    startY.current = e.clientY;
    startH.current = height;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }, [height]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const dy = startY.current - e.clientY;
      const next = Math.min(220, Math.max(56, startH.current + dy));
      setHeight(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, setHeight]);

  const h = height;

  return (
    <div
      className="w-full bg-[var(--surface)] flex flex-col overflow-hidden shrink-0 border-t border-[var(--border)]"
      style={{ height: h, borderRadius: 0 }}
    >
      {/* drag handle — thin, centered */}
      <div
        onPointerDown={onPointerDown}
        className="h-[6px] bg-[var(--surface)] hover:bg-[var(--border)] cursor-ns-resize flex items-center justify-center shrink-0 border-b border-[var(--border)]/50"
      >
        <div className="w-10 h-1 bg-[var(--border)]" />
      </div>

      {/* header — matches Stack/Heap: h-7, bg elevated, px-3 */}
      <div className="h-7 flex items-center justify-between px-3 bg-[var(--elevated)] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-[0.14em] text-[var(--text-secondary)]">HISTORY</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[var(--bg)] text-[var(--text-muted)]">{history.length} snapshots</span>
          {history.length > 0 && selectedId && (
            <span className="hidden sm:inline text-[10px] font-mono px-1.5 py-0.5 bg-[var(--bg)] text-[var(--text-secondary)]">
              {history.findIndex(h => h.id === selectedId) + 1} / {history.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { if (history.length >= 2) onCompare(); }}
            aria-disabled={history.length < 2}
            className={`px-2 py-0.5 text-[11px] font-mono bg-[var(--bg)] text-[var(--text-secondary)] hover:text-[var(--text)] ${history.length < 2 ? "opacity-40 pointer-events-none" : ""}`}
          >
            Compare…
          </button>
        </div>
      </div>

      {/* timeline area — centered, equal px-3 like header, gap-2 for breathing */}
      <div className="flex-1 min-h-0 flex flex-col px-3 py-2 gap-2 bg-[var(--surface)] overflow-hidden justify-center">
        <TimelineWidget history={history} selectedId={selectedId} onSelect={onSelect} />
        {(() => {
          const cur = history.find(h => h.id === selectedId);
          return cur ? (
            <div className="text-[11px] font-mono text-[var(--text-secondary)] truncate text-center leading-none">
              <span className="text-[var(--current)] font-medium">line {cur.lineNumber}</span>
              <span className="text-[var(--text-muted)] mx-1.5">•</span>
              <span className="truncate">{cur.event}</span>
            </div>
          ) : (
            <div className="h-[16px]" />
          );
        })()}
      </div>
    </div>
  );
}
