# Memory Inspector

A modern UNIX workstation memory visualizer. See how C++ memory actually works — stack frames slide, heap objects fade in, pointers grow as bezier edges.

![Next.js 15](https://img.shields.io/badge/Next.js-15-black) ![React 19](https://img.shields.io/badge/React-19-58c4dc) ![Bun](https://img.shields.io/badge/Bun-1.4-f472b6) ![Tailwind 4](https://img.shields.io/badge/Tailwind-4-38bdf8)

Built like `htop` + Apple Instruments + Tokyo Night, but for the web. No glossy glass.

## What it does

Paste any C++14 and step through it:

```cpp
struct Node { int data; Node* next; };
int main() {
  Node* list = new Node{10, nullptr};
  list->next = new Node{20, nullptr};
}
```

- **Stack** — variables as compact cards (name / type / value / address). Pointers show `→ Node` not `0x...`.
- **Heap** — each `new` is its own node (`data`, `next•`). Tail `next` shows `∅ nullptr` terminator.
- **Edges** — stack→heap and `heap.field→heap` as SVG beziers (`#7dcfff` pointer / `#bb9af7` reference / `#9ece6a` heap). Linked lists auto-layout horizontally (4 per row, wraps), trees BFS by level.
- **Graph** — pinch / scroll to zoom, drag to pan, `Fit` centers. Only new edges animate (1.25s, then static).

## Quick start

```bash
bun install
bun dev      # http://localhost:3000
bun run build && bun start
```

Requires Bun 1.4+, Node 20+.

## How to use

1. **Edit** `MAIN.CPP` (CodeMirror 6, C++ highlight, lint, indent guides, `Iosevka Nerd Font`).
2. **RUN** — animates all steps to `finished` (900ms/step). **STEP** — one line. **RESET** — clear. `⌘+Enter` / `Space` shortcuts.
3. **History** — bottom bar (96px, drag to resize, like Stack/Heap). Click dot to jump, drag to scrub, wheel or `←`/`→`/`Space`.
4. **Inspect** — click any stack var or heap card → popover (`Name / Type / Value / Address / Points To / Referenced By`, `Esc` to close).
5. **Compare** — `History → Compare…` pick two dots → modal shows only changed vars/pointers/heap.
6. **View** — header `▦ Split` (Code | Stack | Heap) vs `◈ Graph` (Code + Stack-and-Heap graph, 38/62).

## Vim & theming

Header `⚙` → **Customise**:

- **Font:** Iosevka Nerd Font (bundled in `public/fonts`), JetBrains Mono, Geist Mono
- **Colorscheme:** Tokyo Night (default), Everforest, Catppuccin, Gruvbox — all via `lib/themes.ts` → CSS `--bg/--surface/--text` with `.35s` transition, code editor follows `var(--surface)`.
- **Vim:** toggle `CodeMirror + @replit/codemirror-vim` (full `hjkl w b dd yy p u :w` etc, no `vim.wasm`).

## Stack

- **Engine:** `lib/engine.ts` is source of truth (parses `struct`/`class`, handles `new`/`delete`, `*`/`&`/`->`/`.` and `BinaryTree`/`LinkedList` demo sugar). Emits immutable `ExecutionSnapshot {id, lineNumber, event, stack, heap, pointers}` every line — React only renders snapshots.
- **C++14 → WASM:** `wasm/MemoryEngine.{h,cpp}` mirrors the TS engine (compile with `emcc --bind -std=c++14` if you have Emscripten; TS engine is used at runtime).
- **UI:** Next.js 15 App Router, React 19, Tailwind 4 (`@theme inline` → `bg-bg` etc), Framer Motion (`layout` for stack frames), `react-resizable-panels` (square `0px` floating cards, `bg-[var(--surface)]` vs page `bg-[var(--bg)]`).

## Project layout

```
app/            ← page.tsx (three-pane base, no redesign), globals.css, fonts.css
components/     ← CodePane, StackPane, HeapPane, MemoryGraph, HistoryOverlay, TimelineWidget, VariableInspector, PointerGraphOverlay, DiffModal, ui/Panel
hooks/          ← useMemoryEngine (immutable history, selectedSnapshot)
lib/            ← engine.ts, engine-types.ts, themes.ts
wasm/           ← MemoryEngine.h/cpp
public/fonts/   ← IosevkaNerdFont
```

## Deploy

```bash
vercel --prod
# or
vercel deploy
```

Works on Vercel out of the box (Turbopack, Bun). No env vars.

---

Built by [@ego1s1](https://github.com/ego1s1) — [ego1s1/cpp-vis](https://github.com/ego1s1/cpp-vis) • MIT
