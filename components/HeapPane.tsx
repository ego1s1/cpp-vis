"use client";
import { motion, AnimatePresence } from "framer-motion";
import type { HeapObject } from "@/lib/engine-types";
import { PanelShell, PanelBadge } from "./ui/Panel";

export function HeapPane({ heap, onSelectHeap, font }: { heap: HeapObject[]; onSelectHeap?: (h: HeapObject, rect: DOMRect) => void; font?: string; }) {
  return (
    <PanelShell
      title="HEAP"
      titleColor="var(--heap)"
      font={font}
      badge={<PanelBadge>{heap.filter(h => !h.isFreed).length} live • {heap.length} total</PanelBadge>}
    >
      <div className="flex-1 overflow-auto p-3 space-y-2.5">
        {heap.length === 0 && (
          <div className="bg-[var(--bg)] p-4 text-center">
            <div className="text-[12px] font-mono text-[var(--text-muted)]">no allocations</div>
          </div>
        )}
        <AnimatePresence mode="popLayout">
          {heap.map(obj => (
            <motion.div
              key={obj.address}
              layout
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: obj.isFreed ? 0.45 : 1, y: 0, scale: 1, filter: obj.isFreed ? "grayscale(0.6)" : "grayscale(0)" }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.26, ease: [0.25, 0.1, 0.25, 1] }}
              data-address={obj.address}
              onClick={e => onSelectHeap?.(obj, (e.currentTarget as HTMLElement).getBoundingClientRect())}
              className="bg-[var(--bg)] overflow-hidden cursor-pointer hover:brightness-110 transition"
            >
              <div className="h-7 flex items-center px-3 text-[11px] font-mono" style={{ background: obj.isFreed ? "var(--elevated)" : "color-mix(in srgb, var(--heap) 8%, transparent)", color: obj.isFreed ? "var(--text-muted)" : "#9ece6a" }}>
                <span className="font-semibold">{obj.typeName}</span>
                <span className="ml-2 text-[10px] tabular-nums opacity-80">{obj.address}</span>
                <span className="ml-auto text-[10px]">{obj.sizeBytes}B</span>
                {obj.isFreed && <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-[var(--stack)] text-white">FREED</span>}
              </div>
              <motion.div layout className="p-2 space-y-0">
                {obj.fields.map((f, fi) => (
                  <motion.div
                    key={f.name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: fi * 0.03 }}
                    className="flex items-center justify-between gap-2 text-[11px] font-mono border-b border-[var(--border)]/20 last:border-0 py-2"
                  >
                    <span className="text-[var(--text-secondary)]">{f.name}</span>
                    <span className="text-[var(--text)] tabular-nums bg-[var(--surface)] border border-[var(--border)] px-1.5 py-0.5">{String(f.value).length > 20 ? String(f.value).slice(0, 20) + "…" : f.value}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">{f.type}</span>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </PanelShell>
  );
}
