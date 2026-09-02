"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import type { EngineSnapshot, HeapObject, Variable } from "@/lib/engine-types";

type HeapNodeLayout = {
  id: string;
  obj: HeapObject;
  x: number;
  y: number;
};

export function MemoryGraph({ snapshot, font }: { snapshot: EngineSnapshot | null; font?: string }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1.15);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const prevHeapRef = useRef<string>("");
  const prevSnapshotRef = useRef<EngineSnapshot | null>(null);

  // zoom centered on cursor
  const onWheel = useCallback((e: React.WheelEvent) => {
    const isPinch = (e as any).ctrlKey;
    const factor = isPinch ? 0.008 : 0.0012;
    e.preventDefault();
    const delta = -e.deltaY * factor;
    setScale(s => Math.min(2.2, Math.max(0.6, s + delta)));
  }, []);

  const getTouchDist = (touches: React.TouchList | TouchList) => {
    const a = touches[0] as any;
    const b = touches[1] as any;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };
  const initialPinchDist = useRef<number | null>(null);
  const initialPinchScale = useRef(1);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      initialPinchDist.current = getTouchDist(e.touches as any);
      initialPinchScale.current = scale;
    }
  }, [scale]);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialPinchDist.current !== null) {
      e.preventDefault();
      const dist = getTouchDist(e.touches as any);
      const ratio = dist / (initialPinchDist.current || dist);
      setScale(Math.min(2.2, Math.max(0.6, initialPinchScale.current * ratio)));
    }
  }, []);
  const onTouchEnd = useCallback(() => { initialPinchDist.current = null; }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // only pan with primary button and not on node
    const target = e.target as HTMLElement;
    if (target.closest("[data-node]")) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
  }, []);
  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  // fit to graph on snapshot change
  useEffect(() => {
    if (!snapshot) return;
    // center linked list
    setPan({ x: 0, y: 0 });
    // slight scale adjust to fit
    if (snapshot.heap.length >= 4) setScale(1.15);
    else setScale(1.15);
  }, [snapshot?.currentStep, snapshot?.heap.length]);

  // detect linked list — only live heap, ignore freed
  const liveHeap = useMemo(() => snapshot ? snapshot.heap.filter(h => !h.isFreed) : [], [snapshot]);
  const isLinkedList = useMemo(() => {
    if (!snapshot || liveHeap.length < 2) return false;
    const firstType = liveHeap[0].typeName.split(" ")[0];
    if (!liveHeap.every(h => h.typeName.split(" ")[0] === firstType)) return false;
    for (const h of liveHeap) {
      const ptrFields = h.fields.filter(f => (f as any).kind === "pointer");
      if (ptrFields.length !== 1) return false;
    }
    const heapAddrs = new Set(liveHeap.map(h => h.address));
    const pointedAddrs = new Set<string>();
    liveHeap.forEach(h => h.fields.forEach(f => {
      const target = (f as any).targetObjectId as string | null;
      if (target && heapAddrs.has(target)) pointedAddrs.add(target);
    }));
    const heads = liveHeap.filter(h => !pointedAddrs.has(h.address));
    const stackPointers = snapshot.stack.flatMap(s => s.variables.filter(v => v.isPointer && v.pointsTo && heapAddrs.has(v.pointsTo!)).map(v => v.pointsTo!));
    if (heads.length === 1 && stackPointers.includes(heads[0].address)) return true;
    if (heads.length === 1) return true;
    return false;
  }, [snapshot, liveHeap]);

  // detect tree — only live heap
  const isTree = useMemo(() => {
    if (!snapshot || liveHeap.length < 3) return false;
    if (isLinkedList) return false;
    const firstType = liveHeap[0].typeName.split(" ")[0];
    if (!liveHeap.every(h => h.typeName.split(" ")[0] === firstType)) return false;
    for (const h of liveHeap) {
      const ptrFields = h.fields.filter(f => (f as any).kind === "pointer");
      if (ptrFields.length !== 2) return false;
    }
    const heapAddrs = new Set(liveHeap.map(h => h.address));
    const pointed = new Set<string>();
    let edgeCount = 0;
    liveHeap.forEach(h => h.fields.forEach(f => {
      const t = (f as any).targetObjectId as string | null;
      if (t && heapAddrs.has(t)) { pointed.add(t); edgeCount++; }
    }));
    const roots = liveHeap.filter(h => !pointed.has(h.address));
    if (roots.length !== 1) return false;
    if (edgeCount !== liveHeap.length - 1) return false;
    return true;
  }, [snapshot, liveHeap, isLinkedList]);

  const heapLayouts: HeapNodeLayout[] = useMemo(() => {
    if (!snapshot) return [];
    const live = liveHeap;
    if (isTree) {
      const addrToObj = new Map(live.map(h => [h.address, h] as const));
      const heapAddrs = new Set(live.map(h => h.address));
      const pointed = new Set<string>();
      live.forEach(h => h.fields.forEach(f => {
        const t = (f as any).targetObjectId as string | null;
        if (t && heapAddrs.has(t)) pointed.add(t);
      }));
      let root: HeapObject | undefined = live.find(h => !pointed.has(h.address));
      if (!root) root = live[0];
      const levels: HeapObject[][] = [];
      const visited = new Set<string>();
      let currentLevel: HeapObject[] = root ? [root] : [];
      if (root) visited.add(root.address);
      while (currentLevel.length > 0) {
        levels.push(currentLevel);
        const nextLevel: HeapObject[] = [];
        for (const node of currentLevel) {
          for (const f of node.fields.filter(f => (f as any).kind === "pointer")) {
            const tid = (f as any).targetObjectId as string | null;
            if (tid && heapAddrs.has(tid) && !visited.has(tid)) {
              const child = addrToObj.get(tid);
              if (child) { nextLevel.push(child); visited.add(tid); }
            }
          }
        }
        currentLevel = nextLevel;
      }
      live.forEach(h => { if (!visited.has(h.address)) { if (levels.length === 0) levels.push([]); levels[levels.length - 1].push(h); visited.add(h.address); } });
      const layouts: HeapNodeLayout[] = [];
      const levelHeight = 96;
      const startY = 110;
      levels.forEach((level, depth) => {
        const spacingX = 138;
        const rowW = (level.length - 1) * spacingX;
        const startX = 480 - rowW / 2;
        level.forEach((obj) => {
          const idx = live.indexOf(obj);
          layouts.push({ id: obj.address, obj: { ...obj, typeName: `${obj.typeName.split(" ")[0]} ${idx + 1}` } as HeapObject, x: startX + level.indexOf(obj) * spacingX, y: startY + depth * levelHeight });
        });
      });
      // append freed as faded at bottom row
      const freed = snapshot.heap.filter(h => h.isFreed);
      freed.forEach((obj, i) => {
        layouts.push({ id: obj.address, obj: { ...obj, typeName: `${obj.typeName.split(" ")[0]} ${live.length + i + 1}` } as HeapObject, x: 120 + i * 110, y: 420 });
      });
      return layouts;
    }
    if (isLinkedList) {
      const perRow = 4;
      const spacingX = 138;
      const spacingY = 96;
      const addrToObj = new Map(live.map(h => [h.address, h] as const));
      const heapAddrs = new Set(live.map(h => h.address));
      const pointed = new Set<string>();
      live.forEach(h => h.fields.forEach(f => {
        const t = (f as any).targetObjectId as string | null;
        if (t && heapAddrs.has(t)) pointed.add(t);
      }));
      let head: HeapObject | undefined = live.find(h => !pointed.has(h.address));
      if (!head) head = live[0];
      const ordered: HeapObject[] = [];
      const visited = new Set<string>();
      let cur: HeapObject | undefined = head;
      while (cur && !visited.has(cur.address)) {
        ordered.push(cur);
        visited.add(cur.address);
        const nextField = cur.fields.find(f => (f as any).kind === "pointer");
        const nextAddr = (nextField as any)?.targetObjectId as string | null;
        cur = nextAddr ? addrToObj.get(nextAddr) : undefined;
      }
      live.forEach(h => { if (!visited.has(h.address)) ordered.push(h); });
      const layouts = ordered.map((obj, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const rowWidth = Math.min(perRow, ordered.length - row * perRow) * spacingX - spacingX;
        const startX = 480 - rowWidth / 2;
        return {
          id: obj.address,
          obj: { ...obj, typeName: `${obj.typeName.split(" ")[0]} ${live.indexOf(obj) + 1}` } as HeapObject,
          x: startX + col * spacingX,
          y: 140 + row * spacingY,
        };
      });
      // freed at bottom
      const freed = snapshot.heap.filter(h => h.isFreed);
      freed.forEach((obj, i) => {
        layouts.push({ id: obj.address, obj: { ...obj, typeName: `${obj.typeName.split(" ")[0]} ${live.length + i + 1}` } as HeapObject, x: 120 + i * 110, y: 420 });
      });
      return layouts;
    } else {
      const perRow = 4;
      const spacingX = 138;
      const spacingY = 88;
      const layouts = live.map((obj, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const rowW = Math.min(perRow, live.length - row * perRow) * spacingX - spacingX;
        const sx = 500 - rowW / 2;
        return {
          id: obj.address,
          obj: { ...obj, typeName: `${obj.typeName.split(" ")[0]} ${live.indexOf(obj) + 1}` } as HeapObject,
          x: sx + col * spacingX,
          y: 120 + row * spacingY + (snapshot.stack.length > 2 ? 60 : 0),
        };
      });
      const freed = snapshot.heap.filter(h => h.isFreed);
      freed.forEach((obj, i) => {
        layouts.push({ id: obj.address, obj: { ...obj, typeName: `${obj.typeName.split(" ")[0]} ${live.length + i + 1}` } as HeapObject, x: 120 + i * 110, y: 420 });
      });
      return layouts;
    }
  }, [snapshot, liveHeap, isLinkedList, isTree]);

  const stackNodes = useMemo(() => {
    if (!snapshot) return [];
    const nodes: { id: string; v: Variable; frame: string; x: number; y: number }[] = [];
    let y = 64;
    snapshot.stack.forEach(frame => {
      y += 22;
      frame.variables.forEach(v => {
        nodes.push({ id: v.address, v, frame: frame.functionName, x: 110, y });
        y += 40;
      });
      y += 8;
    });
    return nodes;
  }, [snapshot]);

  const addrToHeapLayout = useMemo(() => new Map(heapLayouts.map(h => [h.id, h])), [heapLayouts]);
  const varIdToPos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    stackNodes.forEach(n => m.set(n.id, { x: n.x + 56, y: n.y })); // right edge of stack card
    return m;
  }, [stackNodes]);

  const prevSnapshot = prevSnapshotRef.current;
  useEffect(() => { prevSnapshotRef.current = snapshot; }, [snapshot]);

  // detect insertion / deletion for animation hints - before early return
  const newHeapIds = useMemo(() => {
    if (!prevSnapshot || !snapshot) return new Set<string>();
    const prevAddrs = new Set(prevSnapshot.heap.map(h => h.address));
    return new Set(snapshot.heap.filter(h => !prevAddrs.has(h.address)).map(h => h.address));
  }, [snapshot, prevSnapshot]);
  const deletedHeapIds = useMemo(() => {
    if (!prevSnapshot || !snapshot) return new Set<string>();
    const curAddrs = new Set(snapshot.heap.map(h => h.address));
    return new Set(prevSnapshot.heap.filter(h => !curAddrs.has(h.address)).map(h => h.address));
  }, [snapshot, prevSnapshot]);

  if (!snapshot || (snapshot.stack.length === 0 && snapshot.heap.length === 0)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 bg-[var(--surface)] text-[var(--text-muted)]" style={{ fontFamily: font ? `'${font}',monospace` : "'Iosevka Nerd Font',monospace" }}>
        <div className="w-12 h-12 bg-[var(--bg)] flex items-center justify-center text-[var(--text)] text-xl">◈</div>
        <div className="text-[13px] text-[var(--text-secondary)]">Graph empty</div>
        <div className="text-[11px]">Run a program to see object graph</div>
      </div>
    );
  }

  // helper to get target for heap field
  const getFieldTargetPos = (field: any, heapObj: HeapObject) => {
    const targetId = (field as any).targetObjectId as string | null;
    if (!targetId) return null;
    const layout = addrToHeapLayout.get(targetId);
    if (layout) return { x: layout.x - 56, y: layout.y };
    return null;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--surface)] overflow-hidden relative" style={{ fontFamily: font ? `'${font}',monospace` : undefined }}>
      <div className="h-7 flex items-center justify-between px-3 bg-[var(--elevated)] shrink-0">
        <span className="text-[11px] font-bold tracking-[0.14em] text-[var(--text)]" style={{ fontFamily: font ? `'${font}',monospace` : "'Iosevka Nerd Font',monospace" }}>STACK AND HEAP</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono px-2 py-0.5 bg-[var(--bg)] text-[var(--text-secondary)]">{snapshot.stack.reduce((a, f) => a + f.variables.length, 0)} vars • {snapshot.heap.length} objects</span>
          <button onClick={() => setScale(s => Math.min(2.2, s * 1.15))} className="w-6 h-6 bg-[var(--bg)] text-[var(--text-secondary)] hover:text-[var(--text)] text-[12px]">+</button>
          <button onClick={() => setScale(s => Math.max(0.6, s / 1.15))} className="w-6 h-6 bg-[var(--bg)] text-[var(--text-secondary)] hover:text-[var(--text)] text-[12px]">−</button>
          <button onClick={() => { setScale(1.15); setPan({ x: 0, y: 0 }); }} className="px-2 h-6 bg-[var(--bg)] text-[var(--text-secondary)] hover:text-[var(--text)] text-[10px]">Fit</button>
        </div>
      </div>

      <div
        className="flex-1 relative overflow-hidden bg-[var(--surface)] cursor-grab active:cursor-grabbing touch-none select-none graph-viewport"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ touchAction: "none" }}
      >

        <svg viewBox="0 0 760 520" className="absolute inset-0 w-full h-full select-none" style={{ fontFamily: font ? `'${font}',monospace` : "'Iosevka Nerd Font',monospace" }}>
          <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
            <defs>
              <marker id="arrow-pointer" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--pointer)" opacity={0.95} />
              </marker>
              <marker id="arrow-reference" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--reference)" opacity={0.95} />
              </marker>
              <marker id="arrow-heap" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--heap)" opacity={0.9} />
              </marker>
            </defs>

            {/* Heap objects */}
            <AnimatePresence>
              {heapLayouts.map(layout => {
                const isNew = newHeapIds.has(layout.id);
                const isDeleted = deletedHeapIds.has(layout.id);
                const isSelected = selectedId === layout.id;
                const isHighlighted = hovered === layout.id || selectedId === layout.id;
                // traversal highlight: if stack variable 'current' points here, gold outline
                const isCurrentTarget = snapshot.stack.some(f => f.variables.some(v => v.name === "current" && v.pointsTo === layout.id));
                const isMiddleTarget = snapshot.stack.some(f => f.variables.some(v => v.name === "middle" && v.pointsTo === layout.id));

                return (
                  <g
                    key={layout.id}
                    transform={`translate(${layout.x},${layout.y})`}
                    onClick={() => {
                      setSelectedId(layout.id);
                      // also trigger inspector via parent? For now just highlight
                      // find heap object and pass to inspector via custom event
                      const heapObj = snapshot.heap.find(h => h.address === layout.id);
                      if (heapObj) {
                        const el = document.querySelector(`[data-heap-node="${layout.id}"]`);
                        // dispatch to parent handler via window event
                        window.dispatchEvent(new CustomEvent("heap-select", { detail: { heapObj, rect: { left: layout.x, top: layout.y, width: 110, height: 48 } } }));
                      }
                    }}
                    data-heap-node={layout.id}
                    onMouseEnter={() => setHovered(layout.id)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ cursor: "pointer" }}
                  >
                    <motion.g
                      initial={isNew ? { scale: 0.7, opacity: 0, y: 12 } : false}
                      animate={{ scale: isDeleted ? 0.85 : 1, opacity: isDeleted ? 0.5 : 1, y: 0 }}
                      exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.28 } }}
                      transition={{ duration: isNew ? 0.38 : 0.26, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {/* card — smaller */}
                      <rect
                        x={-48}
                        y={-20}
                        width={96}
                        height={36 + layout.obj.fields.length * 16}
                        rx={0}
                        fill={isDeleted ? "var(--bg)" : "var(--surface)"}
                        stroke={isCurrentTarget || isMiddleTarget ? "#e0af68" : isHighlighted ? "var(--text)" : "var(--border)"}
                        strokeWidth={isCurrentTarget || isMiddleTarget ? 1.6 : 1}
                        style={{ filter: isCurrentTarget ? "drop-shadow(0 0 7px rgba(224,175,104,0.45))" : isMiddleTarget ? "drop-shadow(0 0 5px rgba(224,175,104,0.32))" : undefined }}
                      />
                      {/* title */}
                      <rect x={-48} y={-20} width={96} height={16} fill={isCurrentTarget ? "rgba(224,175,104,0.15)" : "var(--elevated)"} />
                      <text x={-42} y={-9} fontSize="11" fontWeight={700} fill={isCurrentTarget ? "#e0af68" : "var(--text-secondary)"} fontFamily={font ? `'${font}',monospace` : "Iosevka Nerd Font,monospace"}>{layout.obj.typeName}</text>
                      
                      {/* fields — bigger text, more legible spacing */}
                      {layout.obj.fields.map((f: any, idx) => {
                        const isPtr = f.kind === "pointer";
                        const y = -4 + idx * 16;
                        return (
                          <g key={f.name}>
                            <text x={-42} y={y + 10} fontSize="10.5" fill="var(--text-secondary)" fontFamily={font ? `'${font}',monospace` : "Iosevka Nerd Font,monospace"}>{f.name}</text>
                            {isPtr ? (
                              <>
                                <text x={-2} y={y + 10} fontSize="9" fill={f.targetObjectId ? "var(--pointer)" : "var(--text-muted)"} textAnchor="start" opacity={f.targetObjectId ? 1 : 0.9}>{f.targetObjectId ? "•" : "∅"}</text>
                                {f.targetObjectId ? (
                                  <circle cx={48} cy={y + 6} r={2.8} fill="var(--pointer)" stroke="var(--pointer)" strokeWidth={1} />
                                ) : (
                                  <g>
                                    <circle cx={48} cy={y + 6} r={2.8} fill="transparent" stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="2 2" opacity={0.7} />
                                    <text x={56} y={y + 10} fontSize="7.5" fill="var(--text-muted)" textAnchor="start" dx={4}>nullptr</text>
                                  </g>
                                )}
                              </>
                            ) : (
                              <text x={48} y={y + 10} fontSize="10.5" fill="var(--text)" textAnchor="end">{String(f.value).slice(0, 12)}</text>
                            )}
                          </g>
                        );
                      })}
                      {isNew && <rect x={-48} y={-20} width={96} height={36 + layout.obj.fields.length * 16} fill="none" stroke="var(--heap)" strokeWidth={1.2} strokeDasharray="4 3" opacity={0.6} />}
                      {isDeleted && <line x1={-48} y1={-20} x2={48} y2={16 + layout.obj.fields.length * 16} stroke="var(--stack)" strokeWidth={1.2} opacity={0.7} />}
                    </motion.g>
                  </g>
                );
              })}
            </AnimatePresence>

            {/* Stack variables — smaller box, bigger text, more spacing */}
            {stackNodes.map(n => {
              const isHovered = hovered === n.id;
              const isSelected = selectedId === n.id;
              const v = (n as any).v as Variable;
              const isPointer = v.isPointer || v.isReference;
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  onMouseEnter={() => setHovered(n.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => {
                    setSelectedId(n.id);
                    const el = document.querySelector(`[data-var="${v.name}"]`);
                  }}
                  data-var={v.name}
                  data-address={v.address}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={-48}
                    y={-14}
                    width={96}
                    height={28}
                    fill={isSelected ? "var(--elevated)" : "var(--surface)"}
                    stroke={isHovered || isSelected ? "var(--text)" : "var(--border)"}
                    strokeWidth={isSelected ? 1.2 : 1}
                    opacity={0.98}
                  />
                  <text x={-42} y={-1} fontSize="12.5" fontWeight={600} fill="var(--text)" fontFamily={font ? `'${font}',monospace` : "Iosevka Nerd Font,monospace"}>{v.name}</text>
                  <text x={-42} y={10} fontSize="9.5" fill="var(--text-muted)" fontFamily={font ? `'${font}',monospace` : "Iosevka Nerd Font,monospace"}>{v.type}</text>
                  <text x={42} y={10} fontSize="9.5" fill={isPointer ? (v.isNull ? "var(--text-muted)" : "var(--pointer)") : "var(--current)"} textAnchor="end" fontFamily={font ? `'${font}',monospace` : "Iosevka Nerd Font,monospace"}>
                    {isPointer ? (v.isNull ? "null" : "ptr") : v.value.slice(0, 10)}
                  </text>
                  {isPointer && !v.isNull && <circle cx={48} cy={0} r={2.2} fill="var(--pointer)" />}
                </g>
              );
            })}

            {/* Edges: stack -> heap */}
            <AnimatePresence>
              {snapshot.stack.flatMap(frame =>
                frame.variables
                  .filter(v => (v.isPointer || v.isReference) && v.pointsTo && !v.isNull)
                  .map(v => {
                    const fromNode = stackNodes.find(n => n.id === v.address);
                    const toLayout = addrToHeapLayout.get(v.pointsTo!);
                    if (!fromNode || !toLayout) return null;
                    const sx = fromNode.x + 56;
                    const sy = fromNode.y;
                    const tx = toLayout.x - 56;
                    const ty = toLayout.y;
                    const mx = (sx + tx) / 2;
                    const d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
                    const isActive = hovered === v.address || hovered === v.pointsTo || selectedId === v.address || selectedId === v.pointsTo;
                    const isRef = v.isReference;
                    return (
                      <g key={`edge-${v.address}-${v.pointsTo}`}>
                        <path d={d} fill="none" stroke={isRef ? "var(--reference)" : "var(--pointer)"} strokeOpacity={0.08} strokeWidth={isActive ? 2.2 : 1} strokeLinecap="round" />
                        <motion.path
                          d={d}
                          fill="none"
                          stroke={isRef ? "var(--reference)" : "var(--pointer)"}
                          strokeWidth={isRef ? 1.3 : 1.1}
                          strokeDasharray={isRef ? "7 4" : undefined}
                          opacity={0.9}
                          markerEnd={`url(#arrow-${isRef ? "reference" : "pointer"})`}
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.9, ease: [0.25, 0.1, 0.25, 1] }}
                        />
                      </g>
                    );
                  })
                  .filter(Boolean) as any
              )}
            </AnimatePresence>

            {/* Edges: heap field -> heap */}
            <AnimatePresence>
              {heapLayouts.flatMap(layout =>
                layout.obj.fields
                  .filter((f: any) => f.kind === "pointer" && (f as any).targetObjectId)
                  .map((field: any) => {
                    const target = addrToHeapLayout.get(field.targetObjectId);
                    if (!target) return null;
                    const sx = layout.x + 56;
                    const sy = layout.y - 6 + layout.obj.fields.indexOf(field) * 18 + 6;
                    const tx = target.x - 56;
                    const ty = target.y;
                    // for linked list, use horizontal bezier with slight offset
                    const mx = (sx + tx) / 2;
                    const d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
                    const isActive = hovered === layout.id || hovered === target.id;
                    // detect bypass edge for deletion (when victim exists but edge bypasses it)
                    return (
                      <g key={`heap-edge-${layout.id}-${field.name}-${field.targetObjectId}`}>
                        <path d={d} fill="none" stroke="var(--heap)" strokeOpacity={0.07} strokeWidth={1} />
                        <motion.path
                          d={d}
                          fill="none"
                          stroke="var(--heap)"
                          strokeWidth={1}
                          markerEnd="url(#arrow-heap)"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
                          opacity={0.85}
                        />
                      </g>
                    );
                  })
                  .filter(Boolean) as any
              )}
            </AnimatePresence>
          </g>
        </svg>

        <div className="absolute bottom-2 left-2 flex items-center gap-2 text-[10px] font-mono bg-[var(--surface)] px-2 py-1">
          <span className="flex items-center gap-1"><span className="w-2 h-2" style={{ background: "var(--stack)" }} /> stack</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2" style={{ background: "var(--heap)" }} /> heap</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2" style={{ background: "var(--pointer)" }} /> ptr</span>
        </div>
        <div className="absolute bottom-2 right-2 text-[10px] font-mono text-[var(--text-muted)] bg-[var(--surface)] px-2 py-1 hidden sm:block">pinch / scroll to zoom • drag to pan • Fit to center</div>
      </div>
    </div>
  );
}
