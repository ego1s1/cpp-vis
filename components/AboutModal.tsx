"use client";

export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden" style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-alt)]">
          <span className="text-[12px] font-bold tracking-[0.12em] text-[var(--text)]">ABOUT</span>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
        </div>
        <div className="p-5 space-y-4 text-[13px] leading-relaxed" style={{ fontFamily: "'Iosevka Nerd Font',monospace" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[var(--elevated)] flex items-center justify-center text-[16px] text-[var(--text)]">◈</div>
            <div>
              <div className="text-[14px] font-semibold text-[var(--text)]">Memory Inspector</div>
              <div className="text-[11px] text-[var(--text-muted)]">C++14 • WebAssembly • Next.js 15 • React 19</div>
            </div>
          </div>
          <p className="text-[var(--text-secondary)]">
            A modern UNIX workstation memory visualizer. Stack, heap, pointers and references rendered as an interactive graph. The C++ engine is the source of truth — React only renders snapshots.
          </p>
          <div className="bg-[var(--bg)] border border-[var(--border)] p-3 space-y-2">
            <div className="text-[11px] font-bold tracking-[0.1em] text-[var(--text-muted)]">REPOSITORY</div>
            <a href="https://github.com/ego1s1/cpp-vis" target="_blank" rel="noopener noreferrer" className="text-[12px] font-mono text-[var(--text)] hover:text-[var(--text)] break-all">
              github.com/ego1s1/cpp-vis
            </a>
            <div className="text-[11px] text-[var(--text-muted)]">MIT Licensed • Built with Tailwind, Framer Motion, CodeMirror 6</div>
          </div>
          <div className="flex items-center gap-3 bg-[var(--surface-alt)] border border-[var(--border)] p-3">
            <img src="https://github.com/ego1s1.png" alt="ego1s1" className="w-9 h-9 rounded-none object-cover" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-[var(--text)]">Priyanshu Sharma</div>
              <a href="https://github.com/ego1s1" target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono text-[var(--text)] hover:underline">@ego1s1</a>
            </div>
            <a href="https://github.com/ego1s1" target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 bg-[#7aa2f7] text-[#1a1b26] text-[11px] font-semibold">GitHub</a>
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">Crafted with Iosevka Nerd Font • Tokyo Night • Everforest • Catppuccin • Gruvbox</div>
        </div>
      </div>
    </div>
  );
}
