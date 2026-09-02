import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Memory Inspector — C++ Memory Visualizer",
  description: "Visualize stack, heap, pointers and references.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false as const,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-screen flex flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)] selection:bg-[var(--border)] selection:text-[var(--text)]" style={{ fontFamily: "'Iosevka Nerd Font','Iosevka','JetBrains Mono',ui-monospace,monospace" }}>
        {children}
      </body>
    </html>
  );
}
