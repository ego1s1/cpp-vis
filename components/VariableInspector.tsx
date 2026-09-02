"use client";
import { useEffect, useRef } from "react";
import type { Variable, HeapObject } from "@/lib/engine-types";

export type InspectedTarget =
  | { kind: "variable"; data: Variable; frameName: string; referencedBy: string[] }
  | { kind: "heap"; data: HeapObject; referencedBy: string[] };

export function VariableInspector({
  target,
  anchorRect,
  onClose,
}: {
  target: InspectedTarget | null;
  anchorRect: DOMRect | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, [target, onClose]);

  if (!target || !anchorRect) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(window.innerWidth - 300, Math.max(8, anchorRect.right + 10)),
    top: Math.min(window.innerHeight - 220, Math.max(8, anchorRect.top)),
    width: 280,
    zIndex: 40,
  };

  return (
    <div ref={ref} className="bg-[var(--bg)] border border-[var(--border)] p-3 flex flex-col gap-2" style={{ ...style, boxShadow: "0 12px 32px rgba(0,0,0,0.5)", borderRadius: 0, fontFamily: "'Iosevka Nerd Font',monospace" }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.1em] text-[var(--text)]">{target.kind === "variable" ? "VARIABLE" : "HEAP OBJECT"}</span>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
      </div>

      {target.kind === "variable" ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-[var(--text)]">{target.data.name}</span>
            <span className="text-[11px] px-1.5 py-0.5 bg-[var(--surface)] text-[var(--text-secondary)]">{target.data.type}</span>
          </div>
          <div className="grid grid-cols-[90px_1fr] gap-1 text-[11px] font-mono">
            <span className="text-[var(--text-muted)]">Value</span><span className="text-[var(--current)] break-all">{target.data.value}</span>
            <span className="text-[var(--text-muted)]">Address</span><span className="text-[var(--text)]">{target.data.address}</span>
            <span className="text-[var(--text-muted)]">Points To</span><span className="text-[var(--heap)]">{target.data.pointsTo ?? "—"}</span>
            <span className="text-[var(--text-muted)]">Frame</span><span className="text-[var(--text-secondary)]">{target.frameName}</span>
            <span className="text-[var(--text-muted)]">Referenced By</span><span className="text-[var(--reference)]">{target.referencedBy.length ? target.referencedBy.join(", ") : "—"}</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-[var(--text)]">{target.data.typeName}</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-[var(--surface)] text-[var(--text-muted)]">{target.data.address}</span>
          </div>
          <div className="space-y-1">
            {target.data.fields.map(f => (
              <div key={f.name} className="flex justify-between text-[11px] font-mono border-b border-[var(--border)]/30 last:border-0 py-1">
                <span className="text-[var(--text-secondary)]">{f.name}</span><span className="text-[var(--text)]">{f.value}</span><span className="text-[var(--text-muted)] text-[10px]">{f.type}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[90px_1fr] gap-1 text-[11px] font-mono pt-1 border-t border-[var(--border)]/30">
            <span className="text-[var(--text-muted)]">Referenced By</span><span className="text-[var(--reference)]">{target.referencedBy.length ? target.referencedBy.join(", ") : "—"}</span>
          </div>
        </>
      )}
    </div>
  );
}
