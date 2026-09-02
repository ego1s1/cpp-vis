"use client";
import * as React from "react";

export function PanelShell({
  title,
  badge,
  children,
  className = "",
  headerActions,
  font,
  titleColor,
}: {
  title: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerActions?: React.ReactNode;
  font?: string;
  titleColor?: string;
}) {
  const ff = font ? `${font},` + "'Iosevka','JetBrains Mono',monospace" : "'Iosevka Nerd Font',monospace";
  return (
    <div className={`flex flex-col h-full bg-[var(--surface)] min-h-0 overflow-hidden ${className}`} style={{ borderRadius: 0, fontFamily: ff }}>
      <div className="h-7 flex items-center justify-between px-3 bg-[var(--elevated)] shrink-0">
        <span className="text-[11px] font-bold tracking-[0.14em]" style={{ fontFamily: ff, color: titleColor ?? "var(--text-secondary)" }}>
          {title}
        </span>
        <div className="flex items-center gap-2">
          {badge}
          {headerActions}
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col bg-[var(--surface)] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export function PanelBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[var(--bg)] text-[var(--text-muted)]" style={{ borderRadius: 0 }}>
      {children}
    </span>
  );
}
