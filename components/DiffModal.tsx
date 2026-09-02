"use client";
import { useMemo } from "react";
import type { ExecutionSnapshot } from "@/lib/engine-types";

function diffSnapshots(a: ExecutionSnapshot, b: ExecutionSnapshot) {
  const changedVars: { name: string; type: string; from: string; to: string; frame: string }[] = [];
  const changedPointers: { name: string; from: string | null; to: string | null }[] = [];
  const changedHeap: { addr: string; type: string; fields: { name: string; from: string; to: string }[] }[] = [];

  const mapA = new Map<string, { v: any; frame: string }>();
  a.stack.forEach(f => f.variables.forEach(v => mapA.set(`${f.functionName}:${v.name}`, { v, frame: f.functionName })));
  const mapB = new Map<string, { v: any; frame: string }>();
  b.stack.forEach(f => f.variables.forEach(v => mapB.set(`${f.functionName}:${v.name}`, { v, frame: f.functionName })));

  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
  for (const k of allKeys) {
    const av = mapA.get(k);
    const bv = mapB.get(k);
    if (!av && bv) changedVars.push({ name: bv.v.name, type: bv.v.type, from: "—", to: bv.v.value, frame: bv.frame });
    else if (av && !bv) changedVars.push({ name: av.v.name, type: av.v.type, from: av.v.value, to: "—", frame: av.frame });
    else if (av && bv && (av.v.value !== bv.v.value || av.v.type !== bv.v.type)) {
      changedVars.push({ name: av.v.name, type: av.v.type, from: av.v.value, to: bv.v.value, frame: av.frame });
    }
    if (av && bv && av.v.pointsTo !== bv.v.pointsTo) {
      changedPointers.push({ name: av.v.name, from: av.v.pointsTo, to: bv.v.pointsTo });
    } else if (!av && bv && bv.v.pointsTo) {
      changedPointers.push({ name: bv.v.name, from: null, to: bv.v.pointsTo });
    } else if (av && !bv && av.v.pointsTo) {
      changedPointers.push({ name: av.v.name, from: av.v.pointsTo, to: null });
    }
  }

  const heapA = new Map(a.heap.map(h => [h.address, h]));
  const heapB = new Map(b.heap.map(h => [h.address, h]));
  const allAddrs = new Set([...heapA.keys(), ...heapB.keys()]);
  for (const addr of allAddrs) {
    const ha = heapA.get(addr);
    const hb = heapB.get(addr);
    if (!ha && hb) changedHeap.push({ addr, type: hb.typeName, fields: hb.fields.map(f => ({ name: f.name, from: "—", to: f.value })) });
    else if (ha && !hb) changedHeap.push({ addr, type: ha.typeName, fields: ha.fields.map(f => ({ name: f.name, from: f.value, to: "—" })) });
    else if (ha && hb) {
      const fieldDiffs: { name: string; from: string; to: string }[] = [];
      const max = Math.max(ha.fields.length, hb.fields.length);
      for (let i = 0; i < max; i++) {
        const fa = ha.fields[i];
        const fb = hb.fields[i];
        if (!fa && fb) fieldDiffs.push({ name: fb.name, from: "—", to: fb.value });
        else if (fa && !fb) fieldDiffs.push({ name: fa.name, from: fa.value, to: "—" });
        else if (fa && fb && fa.value !== fb.value) fieldDiffs.push({ name: fa.name, from: fa.value, to: fb.value });
      }
      if (fieldDiffs.length || ha.isFreed !== hb.isFreed) changedHeap.push({ addr, type: hb.typeName, fields: fieldDiffs });
    }
  }

  return { changedVars, changedPointers, changedHeap };
}

export function DiffModal({
  a,
  b,
  onClose,
}: {
  a: ExecutionSnapshot | null;
  b: ExecutionSnapshot | null;
  onClose: () => void;
}) {
  const diff = useMemo(() => (a && b ? diffSnapshots(a, b) : null), [a, b]);

  if (!a || !b || !diff) return null;

  const hasChanges = diff.changedVars.length > 0 || diff.changedPointers.length > 0 || diff.changedHeap.length > 0;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[80vh] bg-[var(--bg)] border border-[var(--border)] flex flex-col overflow-hidden" style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.6)" }}>
        <div className="h-9 flex items-center justify-between px-4 bg-[var(--surface)] border-b border-[var(--border)] shrink-0">
          <span className="text-[11px] font-bold tracking-[0.12em] text-[var(--text)]">COMPARE SNAPSHOTS</span>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text)]">✕</button>
        </div>
        <div className="px-4 py-2 flex items-center gap-2 text-[11px] font-mono bg-[var(--surface-alt)] border-b border-[var(--border)]">
          <span className="px-2 py-1 bg-[var(--elevated)] text-[var(--text)]">{a.id} • line {a.lineNumber} • {a.event.slice(0, 32)}</span>
          <span className="text-[var(--text-muted)]">→</span>
          <span className="px-2 py-1 bg-[#7aa2f7] text-[#1a1b26] font-semibold">{b.id} • line {b.lineNumber} • {b.event.slice(0, 32)}</span>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4 bg-[var(--bg)]">
          {!hasChanges && <div className="text-[13px] text-[var(--text-muted)] text-center py-8">No differences</div>}
          {diff.changedVars.length > 0 && (
            <div>
              <div className="text-[11px] font-bold tracking-[0.1em] text-[var(--current)] mb-2">VARIABLES ({diff.changedVars.length})</div>
              <div className="space-y-1">
                {diff.changedVars.map(v => (
                  <div key={`${v.frame}:${v.name}`} className="flex items-center gap-2 text-[12px] font-mono bg-[var(--surface)] px-3 py-2">
                    <span className="text-[var(--text-secondary)]">{v.frame}::{v.name}</span>
                    <span className="text-[var(--text-muted)] text-[10px]">{v.type}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <span className="text-[var(--stack)] line-through decoration-[var(--stack)]/50">{v.from}</span>
                      <span className="text-[var(--text-muted)]">→</span>
                      <span className="text-[var(--heap)]">{v.to}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {diff.changedPointers.length > 0 && (
            <div>
              <div className="text-[11px] font-bold tracking-[0.1em] text-[var(--pointer)] mb-2">POINTERS ({diff.changedPointers.length})</div>
              <div className="space-y-1">
                {diff.changedPointers.map(p => (
                  <div key={p.name} className="flex items-center gap-2 text-[12px] font-mono bg-[var(--surface)] px-3 py-2">
                    <span className="text-[var(--text)]">{p.name}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <span className="text-[var(--text-muted)]">{p.from ?? "null"}</span>
                      <span className="text-[var(--text)]">→</span>
                      <span className="text-[var(--pointer)]">{p.to ?? "null"}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {diff.changedHeap.length > 0 && (
            <div>
              <div className="text-[11px] font-bold tracking-[0.1em] text-[var(--heap)] mb-2">HEAP ({diff.changedHeap.length})</div>
              <div className="space-y-2">
                {diff.changedHeap.map(h => (
                  <div key={h.addr} className="bg-[var(--surface)] px-3 py-2">
                    <div className="text-[11px] font-mono text-[var(--heap)]">{h.type} • {h.addr}</div>
                    <div className="mt-1 space-y-1">
                      {h.fields.map(f => (
                        <div key={f.name} className="flex items-center gap-2 text-[11px] font-mono">
                          <span className="text-[var(--text-secondary)]">{f.name}</span>
                          <span className="ml-auto flex items-center gap-1">
                            <span className="text-[var(--stack)] line-through">{f.from}</span>
                            <span className="text-[var(--text-muted)]">→</span>
                            <span className="text-[var(--heap)]">{f.to}</span>
                          </span>
                        </div>
                      ))}
                      {h.fields.length === 0 && <div className="text-[11px] text-[var(--text-muted)]">allocation / free changed</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="h-9 flex items-center justify-end px-3 bg-[var(--surface)] border-t border-[var(--border)] shrink-0">
          <button onClick={onClose} className="px-4 py-1 text-[12px] font-mono bg-[var(--elevated)] text-[var(--text)] hover:bg-[var(--border)]">Close</button>
        </div>
      </div>
    </div>
  );
}
