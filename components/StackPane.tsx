"use client";
import { motion, AnimatePresence } from "framer-motion";
import type { StackFrame } from "@/lib/engine-types";
import { PanelShell, PanelBadge } from "./ui/Panel";

export function StackPane({
  stack,
  onSelectVariable,
  font,
}: {
  stack: StackFrame[];
  onSelectVariable?: (v: any, frameName: string, rect: DOMRect) => void;
  font?: string;
}) {
  return (
    <PanelShell
      title="STACK"
      titleColor="var(--stack)"
      font={font}
      badge={
        <PanelBadge>
          {stack.length} frame{stack.length !== 1 ? "s" : ""} • 0x7FFD
        </PanelBadge>
      }
    >
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {stack.length === 0 && (
          <div className="bg-[var(--bg)] p-4 text-center">
            <div className="text-[12px] font-mono text-[var(--text-muted)]">empty</div>
          </div>
        )}
        <AnimatePresence mode="popLayout" initial={false}>
          {stack.slice().reverse().map((frame, idx) => {
            const isTop = idx === 0;
            return (
              <motion.div
                key={frame.id}
                layout
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ scaleY: 0.85, opacity: 0, transition: { duration: 0.18 } }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: idx * 0.02 }}
                className="bg-[var(--bg)] overflow-hidden"
                style={{ transformOrigin: "top" }}
              >
                <div className="h-7 flex items-center px-3 text-[11px] font-mono" style={{ background: isTop ? "color-mix(in srgb, var(--stack) 8%, transparent)" : "var(--elevated)", color: isTop ? "var(--stack)" : "var(--text-secondary)" }}>
                  <span className="font-semibold">{isTop ? "▶" : "▷"} {frame.functionName}()</span>
                  <span className="ml-auto text-[10px]">#{stack.length - idx}</span>
                </div>
                <motion.div layout className="p-2 space-y-2">
                  {frame.variables.length === 0 && <div className="text-[11px] text-[var(--text-muted)] italic px-2 py-2">no locals</div>}
                  <AnimatePresence initial={false}>
                    {frame.variables.map((v, vi) => (
                      <motion.div
                        key={v.name}
                        layout
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.2, delay: vi * 0.015 }}
                        data-address={v.address}
                        data-var={v.name}
                        onClick={e => onSelectVariable?.(v, frame.functionName, (e.currentTarget as HTMLElement).getBoundingClientRect())}
                        className="bg-[var(--surface)] px-2.5 py-2 flex flex-col gap-1 cursor-pointer hover:bg-[var(--elevated)] transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2 pointer-events-none">
                          <span className="text-[12px] font-mono font-semibold text-[var(--text)]">{v.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 border font-mono" style={{ borderColor: v.isPointer ? "rgba(125,207,255,0.3)" : v.isReference ? "rgba(187,154,247,0.3)" : "var(--border)", color: v.isPointer ? "#7dcfff" : v.isReference ? "#bb9af7" : "var(--text-secondary)", background: v.isPointer ? "rgba(125,207,255,0.08)" : v.isReference ? "rgba(187,154,247,0.08)" : "var(--surface)" }}>{v.type}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 pointer-events-none">
                          <span className="text-[11px] font-mono tabular-nums">
                            {v.isPointer ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span className={`${v.isNull ? "text-[var(--text-muted)]" : "text-[var(--pointer)]"}`}>{v.isNull ? "nullptr" : v.value}</span>
                                {!v.isNull && v.pointsTo && <span className="text-[var(--pointer)] text-[10px]">→ {v.type.replace("*","").trim()}</span>}
                              </span>
                            ) : v.isReference ? (
                              <span className="inline-flex items-center gap-1"><span className="text-[var(--reference)]">{v.value}</span><span className="text-[var(--reference)] text-[10px]">↗ {v.type.replace("*","").trim()}</span></span>
                            ) : (
                              <span className="text-[var(--current)]">{v.value}</span>
                            )}
                          </span>
                          <span className="hidden group-hover:inline text-[10px] font-mono text-[var(--text-muted)] tabular-nums" title={v.address}>{v.address.slice(0, 6)}…</span>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </PanelShell>
  );
}
