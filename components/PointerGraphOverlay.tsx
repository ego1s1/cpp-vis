"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { EngineSnapshot } from "@/lib/engine-types";

type Edge = { id: string; fromEl: Element; toEl: Element; color: string; isRef: boolean };

export function PointerGraphOverlay({
  snapshot,
  containerId,
}: {
  snapshot: EngineSnapshot | null;
  containerId: string;
}) {
  const [edges, setEdges] = useState<{ id: string; d: string; color: string; isRef: boolean }[]>([]);
  const prevEdgesRef = useRef<Map<string, string>>(new Map());

  // Only update when selected snapshot changes (id)
  const snapshotId = snapshot ? `${snapshot.currentStep}-${snapshot.currentLine}-${snapshot.pointers?.length ?? 0}` : "empty";

  useLayoutEffect(() => {
    if (!snapshot) { setEdges([]); return; }
    const container = document.getElementById(containerId);
    if (!container) return;
    const cRect = container.getBoundingClientRect();

    const newEdges: typeof edges = [];
    // Find pointer vars in snapshot
    snapshot.stack.forEach(frame => {
      frame.variables.forEach(v => {
        if ((v.isPointer || v.isReference) && v.pointsTo && !v.isNull) {
          const fromSel = `[data-var="${v.name}"][data-address="${v.address}"]`;
          // There may be multiple with same name, pick first in frame
          const fromEl = container.querySelector(`[data-var="${v.name}"]`) as HTMLElement | null;
          const toEl = container.querySelector(`[data-address="${v.pointsTo}"]`) as HTMLElement | null;
          if (fromEl && toEl) {
            const fr = fromEl.getBoundingClientRect();
            const tr = toEl.getBoundingClientRect();
            const sx = fr.right - cRect.left;
            const sy = fr.top + fr.height / 2 - cRect.top;
            const tx = tr.left - cRect.left;
            const ty = tr.top + tr.height / 2 - cRect.top;
            const mx = (sx + tx) / 2;
            const d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
            newEdges.push({ id: `ptr-${v.address}-${v.pointsTo}`, d, color: v.isReference ? "#bb9af7" : "#7dcfff", isRef: !!v.isReference });
          }
        }
      });
    });

    setEdges(newEdges);
  }, [snapshotId, snapshot, containerId]);

  if (!snapshot || edges.length === 0) return null;

  return (
    <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
      <defs>
        {edges.map(e => (
          <marker key={e.id} id={`ov-arrow-${e.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={e.color} opacity={0.95} />
          </marker>
        ))}
      </defs>
      <AnimatePresence>
        {edges.map(e => {
          const isRef = e.isRef;
          return (
            <motion.path
              key={e.id}
              d={e.d}
              fill="none"
              stroke={e.color}
              strokeWidth={isRef ? 1.4 : 1.6}
              strokeDasharray={isRef ? "8 4" : undefined}
              opacity={isRef ? 0.85 : 0.9}
              markerEnd={`url(#ov-arrow-${e.id})`}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              exit={{ pathLength: 0, opacity: 0 }}
              transition={{ duration: 0.9, ease: [0.25, 0.1, 0.25, 1] }}
              style={{
                filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))",
              }}
            />
          );
        })}
      </AnimatePresence>
    </svg>
  );
}
