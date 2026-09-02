"use client";
import { useState, useEffect, useRef } from "react";
import { AboutModal } from "./AboutModal";

export function TitleBar({
  onRun, onStep, onReset, canStep, isAnimating, font, setFont, theme, setTheme, vimMode, setVimMode, viewMode, setViewMode,
}: {
  onRun: () => void; onStep: () => void; onReset: () => void;
  status: string; canStep: boolean; isAnimating?: boolean;
  font: string; setFont: (v: string) => void;
  theme: string; setTheme: (v: string) => void;
  vimMode: boolean; setVimMode: (v: boolean) => void;
  viewMode: "split" | "graph"; setViewMode: (v: "split" | "graph") => void;
}) {
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => {
    if (!viewOpen) return;
    const onDown = (e: MouseEvent) => {
      if (viewWrapRef.current && !viewWrapRef.current.contains(e.target as Node)) setViewOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setViewOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [viewOpen]);

  return (
    <>
      <header className="h-[48px] flex items-center justify-between px-5 bg-[var(--surface)] shrink-0 gap-4 border-b border-[var(--border)]" style={{ fontFamily: `'${font}',monospace` }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 bg-[var(--elevated)] flex items-center justify-center text-[12px] text-[var(--text)]">◈</div>
          <div className="text-[13px] font-semibold tracking-tight text-[var(--text)]">Memory Inspector</div>
        </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="relative" ref={viewWrapRef}>
          <button onClick={() => setViewOpen(v => !v)} className="px-3 py-1.5 text-[11px] font-mono bg-[var(--bg)] text-[var(--text-secondary)] border border-[var(--border)] hover:border-[var(--text-muted)] transition min-w-[92px] flex items-center justify-between gap-2">
            <span>{viewMode === "graph" ? "◈ Graph" : "▦ Split"}</span>
            <span className="text-[10px]">▾</span>
          </button>
          {viewOpen && (
            <div className="absolute right-0 top-[36px] w-40 bg-[var(--bg)] border border-[var(--border)] flex flex-col z-20">
              <button onClick={() => { setViewMode("split"); setViewOpen(false); }} className={`text-left px-3 py-2 text-[11px] font-mono hover:bg-[var(--surface)] ${viewMode==="split" ? "bg-[var(--surface)] text-[var(--text)]" : "text-[var(--text-muted)]"}`}>▦ Split — stack & heap</button>
              <button onClick={() => { setViewMode("graph"); setViewOpen(false); }} className={`text-left px-3 py-2 text-[11px] font-mono hover:bg-[var(--surface)] ${viewMode==="graph" ? "bg-[var(--surface)] text-[var(--text)]" : "text-[var(--text-muted)]"}`}>◈ Graph — stacked</button>
            </div>
          )}
        </div>
        <button onClick={onRun} disabled={!!isAnimating} className="px-4 py-1.5 text-[12px] font-semibold bg-[var(--heap)] text-[#1a1b26] hover:bg-[#a7d67a] disabled:opacity-60 disabled:cursor-wait transition min-w-[72px]">{isAnimating ? "● RUNNING" : "▶ RUN"}</button>
        <button onClick={onStep} disabled={!canStep} className="px-4 py-1.5 text-[12px] font-medium bg-[var(--elevated)] text-[var(--text)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition">↻ STEP</button>
        <button onClick={onReset} className="px-3.5 py-1.5 text-[12px] font-medium bg-[var(--bg)] text-[var(--text-secondary)] hover:bg-[var(--surface)] transition">RESET</button>
        <div className="w-px h-6 bg-[var(--border)] mx-1 hidden sm:block" />
        <button onClick={() => setAboutOpen(true)} className="hidden sm:inline px-3 py-1.5 text-[11px] font-mono bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)]">About</button>
        <div className="relative" ref={wrapRef}>
          <button onClick={() => setOpen(v => !v)} className="w-8 h-8 bg-[var(--bg)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] transition" title="Customise">
            ⚙
          </button>
          {open && (
            <div className="absolute right-0 top-[40px] w-64 bg-[var(--bg)] border border-[var(--border)] p-3 flex flex-col gap-3 shadow-[4px_4px_0px_var(--border)] z-20">
              <div className="text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)]">CUSTOMISE</div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[var(--text-muted)]">Font</span>
                <select value={font} onChange={e => setFont(e.target.value)} className="bg-[var(--surface)] text-[var(--text)] text-[12px] px-2 py-1.5 border border-[var(--border)] outline-none">
                  <option value="Iosevka Nerd Font">Iosevka Nerd Font</option>
                  <option value="JetBrains Mono">JetBrains Mono</option>
                  <option value="Geist Mono">Geist Mono</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[var(--text-muted)]">Colorscheme</span>
                <select value={theme} onChange={e => setTheme(e.target.value)} className="bg-[var(--surface)] text-[var(--text)] text-[12px] px-2 py-1.5 border border-[var(--border)] outline-none">
                  <option value="tokyo">Tokyo Night</option>
                  <option value="everforest">Everforest</option>
                  <option value="catppuccin">Catppuccin Mocha</option>
                  <option value="gruvbox">Gruvbox</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-2 bg-[var(--surface)] px-2 py-2">
                <span className="text-[11px] text-[var(--text-secondary)]">Vim keybindings</span>
                <button onClick={() => setVimMode(!vimMode)} className={`w-9 h-5 flex items-center px-0.5 transition ${vimMode ? "bg-[#7aa2f7] justify-end" : "bg-[var(--border)] justify-start"}`}>
                  <span className="w-4 h-4 bg-white block" />
                </button>
              </label>
              <div className="text-[10px] text-[var(--text-muted)] leading-tight">Vim hidden for clean header. Toggle for modal editing.</div>
              <button onClick={() => { setAboutOpen(true); setOpen(false); }} className="mt-1 w-full py-1.5 bg-[var(--surface)] text-[var(--text)] text-[11px] hover:bg-[var(--elevated)]">About this app →</button>
            </div>
          )}
        </div>
      </div>
    </header>
    <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}
