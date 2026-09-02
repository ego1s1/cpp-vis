"use client";
import { useRef, useCallback, useEffect } from "react";
import type { ExecutionSnapshot } from "@/lib/engine-types";

export function TimelineWidget({
  history,
  selectedId,
  onSelect,
}: {
  history: ExecutionSnapshot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selectedIndex = history.findIndex(h => h.id === selectedId);
  const idx = selectedIndex === -1 ? history.length - 1 : selectedIndex;

  const selectByX = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el || history.length === 0) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width);
    const frac = x / Math.max(1, rect.width);
    const i = Math.round(frac * (history.length - 1));
    const id = history[Math.min(Math.max(0, i), history.length - 1)]?.id;
    if (id) onSelect(id);
  }, [history, onSelect]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    selectByX(e.clientX);
    const onMove = (ev: PointerEvent) => selectByX(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [selectByX]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (history.length === 0) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    const next = Math.min(history.length - 1, Math.max(0, idx + dir));
    onSelect(history[next].id);
  }, [history, idx, onSelect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).closest(".cm-editor")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const next = Math.max(0, idx - 1);
        onSelect(history[next].id);
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        const next = Math.min(history.length - 1, idx + 1);
        onSelect(history[next].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, idx, onSelect]);

  if (history.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-[11px] text-[var(--text-muted)] py-2">No snapshots — run to begin</div>;
  }

  const w = 760;
  const h = 32;
  const pad = 16;

  return (
    <div ref={ref} className="w-full flex flex-col gap-1 select-none" onWheel={onWheel}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[32px] block overflow-visible" style={{ fontFamily: "'Iosevka Nerd Font',monospace" }}>
        {/* track */}
        <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke="var(--border)" strokeWidth={1.5} strokeLinecap="round" opacity={0.9} />
        {/* progress */}
        {history.length > 1 && (
          <line x1={pad} y1={h / 2} x2={pad + (idx / Math.max(1, history.length - 1)) * (w - pad * 2)} y2={h / 2} stroke="var(--text)" strokeWidth={2} strokeLinecap="round" opacity={0.95} />
        )}
        {/* dots */}
        {history.map((s, i) => {
          const x = pad + (history.length > 1 ? (i / (history.length - 1)) * (w - pad * 2) : (w - pad * 2) / 2);
          const isSelected = i === idx;
          const isPast = i < idx;
          return (
            <g key={s.id} transform={`translate(${x},${h / 2})`} onPointerDown={onPointerDown} style={{ cursor: "pointer" }}>
              {/* hit area */}
              <circle r={14} fill="transparent" onClick={() => onSelect(s.id)} />
              {/* outer halo for selected */}
              {isSelected && <circle r={10} fill="none" stroke="var(--text)" strokeOpacity={0.15} strokeWidth={1} />}
              <circle
                r={isSelected ? 6 : 4}
                fill={isSelected ? "var(--text)" : isPast ? "var(--border)" : "var(--elevated)"}
                stroke={isSelected ? "var(--bg)" : "var(--text-muted)"}
                strokeWidth={isSelected ? 1.2 : 1}
                style={{ filter: isSelected ? "drop-shadow(0 0 6px color-mix(in srgb, var(--text) 35%, transparent))" : undefined }}
              />
              <circle r={isSelected ? 2 : 1.2} fill="var(--bg)" opacity={isSelected ? 1 : 0.6} />
            </g>
          );
        })}
      </svg>
      <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)] leading-none px-1">
        <span className="tabular-nums">← {idx + 1} / {history.length}</span>
        <span className="hidden sm:inline tabular-nums">drag • wheel • ←→ / space</span>
        <span className="tabular-nums">{history.length - idx - 1} remaining →</span>
      </div>
    </div>
  );
}
