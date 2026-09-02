"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { applyTheme, getInitialTheme } from "@/lib/themes";
import { TitleBar } from "@/components/TitleBar";
import { CodePane } from "@/components/CodePane";
import { StackPane } from "@/components/StackPane";
import { HeapPane } from "@/components/HeapPane";
import { useMemoryEngine } from "@/hooks/useMemoryEngine";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { HistoryOverlay } from "@/components/HistoryOverlay";
import { VariableInspector, InspectedTarget } from "@/components/VariableInspector";
import { PointerGraphOverlay } from "@/components/PointerGraphOverlay";
import { DiffModal } from "@/components/DiffModal";
import { MemoryGraph } from "@/components/MemoryGraph";
import type { ExecutionSnapshot } from "@/lib/engine-types";

const DEFAULT_CODE = `#include <iostream>
#include <string>
using namespace std;

struct Node {
    int data;
    Node* next;
    Node(int value) : data(value), next(nullptr) {}
};

class LinkedList {
private:
    Node* head;
public:
    LinkedList() : head(nullptr) {}
    void pushFront(int value) {
        Node* newNode = new Node(value);
        newNode->next = head;
        head = newNode;
    }
    void insertAfter(Node* prev, int value) {
        if (!prev) return;
        Node* newNode = new Node(value);
        newNode->next = prev->next;
        prev->next = newNode;
    }
    Node* find(int value) {
        Node* current = head;
        while (current != nullptr) {
            if (current->data == value) return current;
            current = current->next;
        }
        return nullptr;
    }
    int recursiveSum(Node* node) {
        if (node == nullptr) return 0;
        return node->data + recursiveSum(node->next);
    }
    void deleteValue(int value) {
        if (!head) return;
        if (head->data == value) {
            Node* temp = head;
            head = head->next;
            delete temp;
            return;
        }
        Node* current = head;
        while (current->next && current->next->data != value)
            current = current->next;
        if (current->next) {
            Node* victim = current->next;
            current->next = victim->next;
            delete victim;
        }
    }
    Node* getHead() { return head; }
};

int main() {
    LinkedList list;
    list.pushFront(30);
    list.pushFront(20);
    list.pushFront(10);
    Node* middle = list.find(20);
    list.insertAfter(middle, 25);
    int total = list.recursiveSum(list.getHead());
    list.deleteValue(20);
    return 0;
}
`;

export default function Home() {
  const { snapshot, code, setCode, step, reset, load, run, history, selectedId, selectSnapshot, selectedSnapshot } = useMemoryEngine(DEFAULT_CODE);
  const [vimMode, setVimMode] = useState(false);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [font, setFont] = useState<string>("Iosevka Nerd Font");
  const [theme, setTheme] = useState<string>(getInitialTheme);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showGraph, setShowGraph] = useState(true);

  // overlay states — independent (history now permanent at bottom, no minimise)
  const [historyHeight, setHistoryHeight] = useState(96);
  const [selectedVariable, setSelectedVariable] = useState<InspectedTarget | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [diffModalOpen, setDiffModalOpen] = useState(false);

  const isRunning = snapshot?.status === "running";
  const canStep = isRunning && !isAnimating;

  const handleRun = useCallback(async () => {
    if (isAnimating) return;
    setIsAnimating(true);
    try {
      await run(code, 900);
    } finally {
      setIsAnimating(false);
    }
  }, [run, code, isAnimating]);

  const handleStep = useCallback(() => {
    if (isAnimating) return;
    if (snapshot?.status === "idle") load(code);
    else step();
  }, [snapshot?.status, load, code, step, isAnimating]);

  const handleReset = useCallback(() => {
    reset();
    setIsAnimating(false);
    setSelectedVariable(null);
    setAnchorRect(null);
    setInspectorOpen(false);
  }, [reset]);

  const toggleBreakpoint = (n: number) => {
    setBreakpoints(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  };

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-mono", `'${font}', 'Iosevka','JetBrains Mono',ui-monospace,monospace`);
    localStorage.setItem("mi-font", font);
  }, [font]);

  useEffect(() => {
    const savedFont = localStorage.getItem("mi-font");
    if (savedFont) setFont(savedFont);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleRun(); }
      if (e.key === " " && !vimMode && document.activeElement?.tagName !== "TEXTAREA" && (document.activeElement as HTMLElement)?.getAttribute("contenteditable") !== "true") {
        const el = document.activeElement as HTMLElement | null;
        const isEditor = el?.closest?.(".cm-editor");
        if (!isEditor) { e.preventDefault(); handleStep(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleRun, handleStep, vimMode]);

  // Prevent page zoom on pinch — only graph viewport should zoom
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        // Always prevent page zoom; graph handles its own zoom via its own handler
        e.preventDefault();
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Prevent page handling of two-finger pinch outside graph; graph handles its own
        e.preventDefault();
      }
    };
    // Use document to catch all, but allow graph's own touch handler to run first via bubbling
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const readOnly = !!(snapshot && snapshot.status === "running" && snapshot.currentStep > 0 && snapshot.sourceLines.join("\n") === code);

  // Use selectedSnapshot for visualization (immutable history) — unify lineNumber/currentLine
  const vizSnapshot: any = selectedSnapshot ?? snapshot;
  const vizLine: number = vizSnapshot ? (vizSnapshot.lineNumber ?? vizSnapshot.currentLine ?? 0) : 0;
  const vizStepId: string | null = selectedId ?? (vizSnapshot ? (vizSnapshot.id ?? `snap-${vizSnapshot.currentStep ?? 0}`) : null);
  const allHistory: ExecutionSnapshot[] = history ?? [];

  const handleSelectVariable = useCallback((v: import("@/lib/engine-types").Variable, frameName: string, rect: DOMRect) => {
    const referencedBy: string[] = [];
    const cur = vizSnapshot;
    if (cur) {
      cur.stack.forEach((f: import("@/lib/engine-types").StackFrame) => f.variables.forEach((vv: import("@/lib/engine-types").Variable) => {
        if (vv.pointsTo === v.address) referencedBy.push(`${f.functionName}::${vv.name}`);
      }));
    }
    setSelectedVariable({ kind: "variable", data: v, frameName, referencedBy });
    setAnchorRect(rect);
    setInspectorOpen(true);
  }, [vizSnapshot]);

  const handleSelectHeap = useCallback((h: import("@/lib/engine-types").HeapObject, rect: DOMRect) => {
    const referencedBy: string[] = [];
    const cur = vizSnapshot;
    if (cur) {
      cur.stack.forEach((f: import("@/lib/engine-types").StackFrame) => f.variables.forEach((vv: import("@/lib/engine-types").Variable) => {
        if (vv.pointsTo === h.address) referencedBy.push(`${f.functionName}::${vv.name}`);
      }));
    }
    setSelectedVariable({ kind: "heap", data: h, referencedBy });
    setAnchorRect(rect);
    setInspectorOpen(true);
  }, [vizSnapshot]);

  const handleHistorySelect = useCallback((id: string) => {
    if (compareMode) {
      if (!compareA) setCompareA(id);
      else if (!compareB && id !== compareA) {
        setCompareB(id);
        setDiffModalOpen(true);
      } else {
        setCompareA(id);
        setCompareB(null);
      }
      return;
    }
    selectSnapshot(id);
  }, [compareMode, compareA, compareB, selectSnapshot]);

  const vizForOverlay = vizSnapshot;

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text overflow-hidden" style={{ fontFamily: `'${font}',` + "'Iosevka','JetBrains Mono',monospace", touchAction: "pan-x pan-y" }}>
      <TitleBar
        onRun={handleRun}
        onStep={handleStep}
        onReset={handleReset}
        status={snapshot?.status ?? "idle"}
        canStep={canStep || snapshot?.status === "idle"}
        isAnimating={isAnimating}
        font={font}
        setFont={setFont}
        theme={theme}
        setTheme={setTheme}
        vimMode={vimMode}
        setVimMode={setVimMode}
        viewMode={showGraph ? "graph" : "split"}
        setViewMode={(v: "split" | "graph") => setShowGraph(v === "graph")}
      />

      {/* Base three-pane — preserved */}
      <div className="flex-1 flex flex-col min-h-0 w-full px-5 lg:px-8 py-3 gap-3 relative bg-bg">
        <div className="flex-1 min-h-[380px] flex flex-col overflow-hidden" id="viz-container">
          {showGraph ? (
            <PanelGroup orientation="horizontal" id="mi-layout-graph" className="flex-1 min-h-0 gap-3">
              <Panel defaultSize={38} minSize={28} className="overflow-hidden bg-[var(--surface)] flex flex-col" style={{ borderRadius: 0 }}>
                <CodePane
                  code={code}
                  onChange={setCode}
                  currentLine={vizLine}
                  breakpoints={breakpoints}
                  onToggleBreakpoint={toggleBreakpoint}
                  vimMode={vimMode}
                  readOnly={readOnly}
                  font={font}
                />
              </Panel>
              <PanelResizeHandle className="w-3 flex items-center justify-center group shrink-0 bg-transparent">
                <div className="w-[2px] h-12 bg-[var(--surface)] group-hover:bg-[var(--border)] group-data-[resize-handle-active]:bg-[#7aa2f7] transition" />
              </PanelResizeHandle>
              <Panel defaultSize={62} minSize={36} className="overflow-hidden bg-[var(--surface)] flex flex-col" style={{ borderRadius: 0 }}>
                <MemoryGraph snapshot={vizSnapshot as any} font={font} />
              </Panel>
            </PanelGroup>
          ) : (
            <>
              <PanelGroup orientation="horizontal" id="mi-layout" className="flex-1 min-h-0 gap-3">
                <Panel defaultSize={36} minSize={28} className="overflow-hidden bg-[var(--surface)] flex flex-col" style={{ borderRadius: 0 }}>
                  <CodePane
                    code={code}
                    onChange={setCode}
                    currentLine={vizLine}
                    breakpoints={breakpoints}
                    onToggleBreakpoint={toggleBreakpoint}
                    vimMode={vimMode}
                    readOnly={readOnly}
                    font={font}
                  />
                </Panel>

                <PanelResizeHandle className="w-3 flex items-center justify-center group shrink-0 bg-transparent">
                  <div className="w-[2px] h-12 bg-[var(--surface)] group-hover:bg-[var(--border)] group-data-[resize-handle-active]:bg-[#7aa2f7] transition" />
                </PanelResizeHandle>

                <Panel defaultSize={32} minSize={22} className="overflow-hidden bg-[var(--surface)] flex flex-col" style={{ borderRadius: 0 }}>
                  <StackPane stack={vizSnapshot?.stack ?? []} onSelectVariable={handleSelectVariable} font={font} />
                </Panel>

                <PanelResizeHandle className="w-3 flex items-center justify-center group shrink-0 bg-transparent">
                  <div className="w-[2px] h-12 bg-[var(--surface)] group-hover:bg-[var(--border)] group-data-[resize-handle-active]:bg-[#7aa2f7] transition" />
                </PanelResizeHandle>

                <Panel defaultSize={32} minSize={22} className="overflow-hidden bg-[var(--surface)] flex flex-col" style={{ borderRadius: 0 }}>
                  <HeapPane heap={vizSnapshot?.heap ?? []} onSelectHeap={handleSelectHeap as any} font={font} />
                </Panel>
              </PanelGroup>
              <PointerGraphOverlay snapshot={vizForOverlay} containerId="viz-container" />
            </>
          )}
        </div>

        {/* Floating History Overlay — does not push layout */}
                <HistoryOverlay
          history={allHistory}
          selectedId={vizStepId}
          onSelect={handleHistorySelect}
          height={historyHeight}
          setHeight={setHistoryHeight}
          onCompare={() => {
            setCompareMode(v => !v);
            setCompareA(null);
            setCompareB(null);
          }}
        />
        {/* Compare hint */}
        {compareMode && (
          <div className="fixed bottom-[108px] left-1/2 -translate-x-1/2 bg-[#7aa2f7] text-[#1a1b26] text-[11px] font-mono px-3 py-1" style={{ borderRadius: 0 }}>
            Compare: select two snapshots {compareA ? "• 1 selected" : ""} {compareB ? "• 2 selected" : ""}
            <button onClick={() => { setCompareMode(false); setCompareA(null); setCompareB(null); }} className="ml-2 underline">Exit</button>
          </div>
        )}
      </div>

      {/* Floating Variable Inspector */}
      {inspectorOpen && selectedVariable && (
        <VariableInspector target={selectedVariable} anchorRect={anchorRect} onClose={() => { setInspectorOpen(false); setSelectedVariable(null); }} />
      )}

      {/* Diff Modal */}
      {diffModalOpen && compareA && compareB && (
        <DiffModal
          a={allHistory.find(h => h.id === compareA) ?? null}
          b={allHistory.find(h => h.id === compareB) ?? null}
          onClose={() => { setDiffModalOpen(false); setCompareMode(false); setCompareA(null); setCompareB(null); }}
        />
      )}
    </div>
  );
}
