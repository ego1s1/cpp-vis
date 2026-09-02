"use client";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { MemoryEngine } from "@/lib/engine";
import type { EngineSnapshot } from "@/lib/engine-types";

export function useMemoryEngine(initialCode: string) {
  const engineRef = useRef<MemoryEngine | null>(null);
  // Initialize engine synchronously so server and client match (avoid hydration mismatch)
  if (!engineRef.current) {
    engineRef.current = new MemoryEngine();
    engineRef.current.loadProgram(initialCode);
    // auto-run to final for initial heap visibility
    while (engineRef.current.getState().status === "running") {
      if (!engineRef.current.step()) break;
      if (engineRef.current.getState().status === "finished" || engineRef.current.getState().status === "error") break;
    }
  }
  const [history, setHistory] = useState<import("@/lib/engine-types").ExecutionSnapshot[]>(() => engineRef.current!.getExecutionHistory());
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const h = engineRef.current!.getExecutionHistory();
    return h.length > 0 ? h[h.length - 1].id : null;
  });
  const [code, setCode] = useState(initialCode);
  const codeRef = useRef(code);
  codeRef.current = code;

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new MemoryEngine();
    return engineRef.current;
  }, []);

  const syncHistory = useCallback(() => {
    const eng = getEngine();
    const h = eng.getExecutionHistory();
    setHistory(h);
    if (h.length > 0) setSelectedId(h[h.length - 1].id);
  }, [getEngine]);

  const load = useCallback(
    (src?: string) => {
      const source = src ?? codeRef.current;
      const eng = getEngine();
      eng.loadProgram(source);
      const h = eng.getExecutionHistory();
      setHistory(h);
      if (h.length > 0) setSelectedId(h[h.length - 1].id);
    },
    [getEngine]
  );

  const step = useCallback(() => {
    const eng = getEngine();
    const ok = eng.step();
    const h = eng.getExecutionHistory();
    setHistory(h);
    if (h.length > 0) setSelectedId(h[h.length - 1].id);
    return ok;
  }, [getEngine]);

  const reset = useCallback(() => {
    const eng = getEngine();
    eng.reset();
    const h = eng.getExecutionHistory();
    setHistory(h);
    if (h.length > 0) setSelectedId(h[h.length - 1].id);
  }, [getEngine]);

  const updateCode = useCallback((newCode: string) => {
    setCode(newCode);
    codeRef.current = newCode;
  }, []);

  const selectSnapshot = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const selectedSnapshot = useMemo(() => {
    if (history.length === 0) return null;
    if (!selectedId) return history[history.length - 1];
    return history.find(h => h.id === selectedId) ?? history[history.length - 1];
  }, [history, selectedId]);

  // snapshot is selectedSnapshot mapped to EngineSnapshot shape for existing consumers
  const snapshot: import("@/lib/engine-types").EngineSnapshot | null = useMemo(() => {
    if (!selectedSnapshot) return null;
    return {
      currentLine: selectedSnapshot.lineNumber,
      stack: selectedSnapshot.stack,
      heap: selectedSnapshot.heap,
      timeline: [], // not needed for base rendering except for history overlay
      currentStep: parseInt(selectedSnapshot.id.split("-")[1] || "0"),
      totalSteps: history.length,
      status: selectedSnapshot.status,
      sourceLines: selectedSnapshot.sourceLines,
      historyLength: history.length,
      pointers: selectedSnapshot.pointers,
    } as any;
  }, [selectedSnapshot, history.length]);

  // initial history already set synchronously above; keep effect for HMR
  useEffect(() => {
    // no-op: history already initialized synchronously to avoid hydration mismatch
  }, []);

  const run = useCallback(async (src?: string, onStepDelay = 900) => {
    const source = src ?? codeRef.current;
    const eng = getEngine();
    eng.loadProgram(source);
    let h = eng.getExecutionHistory();
    setHistory(h);
    if (h.length > 0) setSelectedId(h[h.length - 1].id);
    while (true) {
      const s = eng.getState();
      if (s.status !== "running") break;
      await new Promise<void>(r => setTimeout(r, onStepDelay));
      if (eng.getState().status !== "running") break;
      const didStep = eng.step();
      h = eng.getExecutionHistory();
      setHistory(h);
      setSelectedId(h[h.length - 1].id);
      if (!didStep) break;
      const after = eng.getState();
      if (after.status === "finished" || after.status === "error") break;
    }
  }, [getEngine]);

  return {
    snapshot,
    selectedSnapshot,
    history,
    selectedId,
    selectSnapshot,
    code,
    setCode: updateCode,
    load,
    step,
    reset,
    run,
    getEngine,
    engine: engineRef.current,
  };
}
