"use client";
import { useEffect, useMemo, useRef } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { EditorState, Compartment, StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import { cpp } from "@codemirror/lang-cpp";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { linter, Diagnostic } from "@codemirror/lint";
import { lineNumbers as cmLineNumbers, gutter, GutterMarker, Decoration, DecorationSet } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { PanelShell } from "./ui/Panel";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";

// Iosevka + Tokyo Night - strict dark, no white flash
const tokyoHighlight = HighlightStyle.define([
  { tag: tags.comment, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--reference)" },
  { tag: tags.typeName, color: "var(--pointer)" },
  { tag: tags.string, color: "var(--heap)" },
  { tag: tags.number, color: "#e0af68" },
  { tag: tags.operator, color: "#89ddff" },
  { tag: tags.bracket, color: "var(--text-secondary)" },
  { tag: tags.variableName, color: "var(--text)" },
  { tag: tags.definition(tags.variableName), color: "var(--pointer)" },
  { tag: tags.propertyName, color: "#73daca" },
]);

const makeTokyoTheme = (fontFamily: string) => EditorView.theme({
  "&": {
    backgroundColor: "var(--surface) !important",
    color: "var(--text) !important",
    fontFamily: `'${fontFamily}',` + "'Iosevka','JetBrains Mono',ui-monospace,monospace",
    fontSize: "13px",
    lineHeight: "1.7",
  },
  ".cm-content": { backgroundColor: "var(--surface) !important", caretColor: "var(--text)", padding: "12px 0" },
  ".cm-cursor": { borderLeftColor: "var(--current)", borderLeftWidth: "2px" },
  ".cm-gutters": { backgroundColor: "var(--surface) !important", color: "var(--text-muted)", borderRight: "1px solid var(--border)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px", fontSize: "12px", minWidth: "36px", textAlign: "right", color: "var(--text-muted)", fontFamily: `'${fontFamily}',monospace` },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--current) 8%, transparent)", color: "var(--current)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--current) 6%, transparent)" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--border) 30%, transparent)" },
  ".cm-current-line": { backgroundColor: "color-mix(in srgb, var(--current) 8%, transparent)", outline: "1px solid color-mix(in srgb, var(--current) 14%, transparent)" },
  ".cm-breakpoint-gutter .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  ".cm-breakpoint-marker": { width: "9px", height: "9px", background: "var(--stack)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--stack) 18%, transparent)", display: "block" },
  ".cm-breakpoint-gutter": { width: "28px" },
  ".cm-diagnostic": { fontFamily: `'${fontFamily}',monospace` },
}, { dark: true });

// breakpoint gutter
class BpMarker extends GutterMarker {
  toDOM() { const dot = document.createElement("span"); dot.className = "cm-breakpoint-marker"; return dot; }
}
const bpGutterMarker = new BpMarker();
const toggleBreakpointEffect = StateEffect.define<number>();
const breakpointField = StateField.define<Set<number>>({
  create() { return new Set(); },
  update(val, tr) {
    const next = new Set(val);
    for (const e of tr.effects) if (e.is(toggleBreakpointEffect)) {
      if (next.has(e.value)) next.delete(e.value); else next.add(e.value);
    }
    return next;
  },
  provide: f => gutter({
    class: "cm-breakpoint-gutter",
    markers: view => {
      const builder = new RangeSetBuilder<GutterMarker>();
      const bps = view.state.field(f);
      const doc = view.state.doc;
      for (let i=1; i<=doc.lines; i++) if (bps.has(i)) {
        const line = doc.line(i);
        builder.add(line.from, line.from, bpGutterMarker);
      }
      return builder.finish();
    },
    initialSpacer: () => bpGutterMarker,
    domEventHandlers: {
      mousedown(view, line) {
        view.dispatch({ effects: toggleBreakpointEffect.of(view.state.doc.lineAt(line.from).number) });
        return true;
      }
    }
  })
});

const currentLineEffect = StateEffect.define<number | null>();
const currentLineField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(deco, tr) {
    let line: number | null = null;
    for (const e of tr.effects) if (e.is(currentLineEffect)) line = e.value;
    if (line !== null) {
      if (line <= 0) return Decoration.none;
      try {
        const docLine = tr.state.doc.line(line);
        return Decoration.set([Decoration.line({ class: "cm-current-line" }).range(docLine.from)]);
      } catch { return Decoration.none; }
    }
    if (deco.size && tr.docChanged) return deco.map(tr.changes);
    return deco;
  },
  provide: f => EditorView.decorations.from(f)
});

function cppLinter(view: EditorView): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const text = view.state.doc.toString();
  const lines = text.split("\n");
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) return;
    if (/^(int|float|double|char|bool|string|auto|Person|Node|void)\b.*[^;{}]$/.test(trimmed) && !trimmed.endsWith("{") && !trimmed.includes("struct")) {
      if (!trimmed.match(/\)\s*\{?\s*$/)) {
        diags.push({ from: view.state.doc.line(line).from, to: view.state.doc.line(line).to, severity: "warning", message: "Missing semicolon" });
      }
    }
  });
  const open = (text.match(/\{/g) || []).length;
  const close = (text.match(/\}/g) || []).length;
  if (open !== close) {
    diags.push({ from: 0, to: Math.min(10, text.length), severity: "error", message: `Mismatched braces: ${open} { vs ${close} }` });
  }
  return diags;
}

const vimCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const editableCompartment = new Compartment();

export function CodePane({
  code, onChange, currentLine, breakpoints, onToggleBreakpoint, vimMode, readOnly, font
}: {
  code: string; onChange: (v: string) => void; currentLine: number;
  breakpoints: Set<number>; onToggleBreakpoint: (n: number)=>void;
  vimMode: boolean; readOnly?: boolean; font?: string;
}) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onToggleRef = useRef(onToggleBreakpoint);
  onToggleRef.current = onToggleBreakpoint;

  const debouncedOnChange = useMemo(() => {
    return (val: string) => onChangeRef.current(val);
  }, []);

  const tokyoTheme = useMemo(() => makeTokyoTheme(font ?? "Iosevka Nerd Font"), [font]);
  const extensions = useMemo(() => {
    return [
      cpp(),
      cmLineNumbers(),
      breakpointField,
      currentLineField,
      syntaxHighlighting(tokyoHighlight, { fallback: true }),
      tokyoTheme,
      linter(cppLinter, { delay: 400 }),
      indentationMarkers({
        highlightActiveBlock: true,
        hideFirstIndent: false,
        markerType: "fullScope",
        thickness: 1.2,
        colors: { dark: "var(--border)", activeDark: "var(--text)", light: "var(--border)", activeLight: "var(--text)" },
      }),
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      EditorView.theme({ "&.cm-focused": { outline: "none" }, ".cm-scroller": { fontVariantLigatures: "none" } }),
      vimCompartment.of(vimMode ? vim() : []),
      readOnlyCompartment.of(EditorState.readOnly.of(!!readOnly)),
      editableCompartment.of(EditorView.editable.of(!readOnly)),
      EditorView.updateListener.of(update => {
        if (update.docChanged) debouncedOnChange(update.state.doc.toString());
        if (update.transactions.some(tr => tr.effects.some(e => e.is(toggleBreakpointEffect)))) {
          setTimeout(() => {
            const view = ref.current?.view;
            if (!view) return;
            const bps: Set<number> = view.state.field(breakpointField);
            const parentSet = breakpoints;
            for (const n of bps) if (!parentSet.has(n)) onToggleRef.current(n);
            for (const n of parentSet) if (!bps.has(n)) onToggleRef.current(n);
          }, 0);
        }
      }),
    ];
  }, [readOnly, breakpoints, debouncedOnChange, vimMode, tokyoTheme]);

  useEffect(() => {
    const view = ref.current?.view;
    if (!view) return;
    view.dispatch({ effects: vimCompartment.reconfigure(vimMode ? vim() : []) });
  }, [vimMode]);

  useEffect(() => {
    const view = ref.current?.view;
    if (!view) return;
    view.dispatch({ effects: [readOnlyCompartment.reconfigure(EditorState.readOnly.of(!!readOnly)), editableCompartment.reconfigure(EditorView.editable.of(!readOnly))] });
  }, [readOnly]);

  useEffect(() => {
    const view = ref.current?.view;
    if (!view) return;
    const cur: Set<number> = view.state.field(breakpointField);
    if (cur.size !== breakpoints.size || [...cur].some(v => !breakpoints.has(v))) {
      for (const n of breakpoints) if (!cur.has(n)) view.dispatch({ effects: toggleBreakpointEffect.of(n) });
      for (const n of cur) if (!breakpoints.has(n)) view.dispatch({ effects: toggleBreakpointEffect.of(n) });
    }
  }, [breakpoints]);

  useEffect(() => {
    const view = ref.current?.view;
    if (!view) return;
    view.dispatch({ effects: currentLineEffect.of(readOnly ? currentLine : null) });
    if (readOnly && currentLine > 0) {
      try {
        const line = view.state.doc.line(currentLine);
        view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "nearest" }) });
      } catch {}
    }
  }, [currentLine, readOnly]);

  useEffect(() => {
    const view = ref.current?.view;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== code) view.dispatch({ changes: { from: 0, to: cur.length, insert: code } });
  }, [code]);

  return (
    <PanelShell title="MAIN.CPP" font={font} className="h-full">
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-[var(--surface)]">
        <CodeMirror
          ref={ref}
          value={code}
          height="100%"
          theme="dark"
          basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, bracketMatching: true, autocompletion: true, closeBrackets: true }}
          extensions={extensions}
          style={{ height: "100%", backgroundColor: "var(--surface)" }}
        />
      </div>
    </PanelShell>
  );
}
