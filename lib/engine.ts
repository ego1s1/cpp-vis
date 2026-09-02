// MemoryEngine - TypeScript source-of-truth engine
// Mirrors wasm/MemoryEngine.cpp logic. Visualization ONLY consumes snapshots.
// Exposes loadProgram(string), step(), reset(), getState()-> Snapshot

import type { Variable, StackFrame, HeapObject, HeapField, TimelineEvent, EngineSnapshot } from "./engine-types";

type StructDef = { name: string; fields: { type: string; name: string }[] };
type FuncDef = { returnType: string; name: string; params: { type: string; name: string }[]; bodyLines: string[]; bodyLineNumbers: number[] };

type CallFrameInternal = {
  functionName: string;
  pc: number;
  variables: Variable[];
  awaitingReturnVar: string | null;
  awaitingReturnType: string | null;
};

function hexStack(addr: number) { return "0x" + addr.toString(16).padStart(8, "0"); }
function hexHeap(addr: number) { return "0x" + addr.toString(16).padStart(4, "0"); }

function stripComment(line: string) {
  const idx = line.indexOf("//");
  return idx >= 0 ? line.slice(0, idx) : line;
}

function parseValueExpr(expr: string): { raw: string; typeHint?: string } {
  return { raw: expr.trim() };
}

export class MemoryEngine {
  private sourceText = "";
  private sourceLines: string[] = [];
  private structs = new Map<string, StructDef>();
  private functions = new Map<string, FuncDef>();

  private callStack: CallFrameInternal[] = [];
  private heapObjects: HeapObject[] = [];
  private timeline: TimelineEvent[] = [];
  private snapshots: EngineSnapshot[] = [];

  private nextStackAddr = 0x7ffd1000;
  private nextHeapAddr = 0x1000;
  private currentLineNumber = 0;
  private stepCount = 0;
  private status: EngineSnapshot["status"] = "idle";
  private errorMessage?: string;
  private linkedListHeads = new Map<string, string | null>(); // var name -> head heap address
  private binaryTreeRoots = new Map<string, string | null>();
  private stackObjectFields = new Map<string, Map<string, string | null>>(); // generic: varName -> fieldName -> heapAddr or value

  loadProgram(source: string) {
    this.sourceText = source;
    this.sourceLines = source.split("\n");
    this.structs.clear();
    this.functions.clear();
    this.heapObjects = [];
    this.timeline = [];
    this.snapshots = [];
    this.callStack = [];
    this.nextStackAddr = 0x7ffd1000;
    this.nextHeapAddr = 0x1000;
    this.stepCount = 0;
    this.status = "idle";
    this.errorMessage = undefined;
    this.currentLineNumber = 0;
    this.linkedListHeads.clear();
    this.binaryTreeRoots.clear();
    this.stackObjectFields.clear();
    this.parse();
    const main = this.functions.get("main");
    if (main) {
      this.callStack.push({ functionName: "main", pc: 0, variables: [], awaitingReturnVar: null, awaitingReturnType: null });
      this.status = "running";
      if (main.bodyLines.length > 0) this.currentLineNumber = main.bodyLineNumbers[0];
      else this.status = "finished";
    } else {
      // No main -> try global execution (wrap all lines)
      if (source.trim().length > 0) {
        this.status = "running";
        // create synthetic main from all non-struct/func lines
        // but for simplicity mark error
        this.status = "error";
        this.errorMessage = "No main() found";
      } else {
        this.status = "idle";
      }
    }
    this.pushHistory();
  }

  reset() {
    if (this.sourceText) this.loadProgram(this.sourceText);
  }

  private computePointers(): import("./engine-types").PointerInfo[] {
    const pointers: import("./engine-types").PointerInfo[] = [];
    this.callStack.forEach(frame => {
      frame.variables.forEach(v => {
        if ((v.isPointer || v.isReference) && v.pointsTo && !v.isNull) {
          pointers.push({
            from: v.address,
            fromName: v.name,
            fromFrame: frame.functionName,
            to: v.pointsTo,
            type: v.isReference ? "reference" : "pointer",
          });
        }
        // generic: stack object fields that are pointers (e.g., LinkedList.list.head)
        const fieldMap = this.stackObjectFields.get(v.name);
        if (fieldMap) {
          fieldMap.forEach((targetAddr, fieldName) => {
            if (targetAddr) {
              pointers.push({
                from: v.address,
                fromName: `${v.name}.${fieldName}`,
                fromFrame: frame.functionName,
                to: targetAddr,
                type: "pointer",
              });
            }
          });
        }
      });
    });
    // also heap pointer fields are not directly pointers from stack, but they are edges heap->heap, handled in graph via heap fields, not here
    return pointers;
  }

  getState(): EngineSnapshot {
    const stack: StackFrame[] = this.callStack.map((f, idx) => ({
      id: `${f.functionName}-${idx}`,
      functionName: f.functionName,
      variables: f.variables.map(v => ({ ...v })),
      pc: f.pc,
    }));
    return {
      currentLine: this.currentLineNumber,
      stack,
      heap: this.heapObjects.map(h => ({ ...h, fields: h.fields.map(f => ({ ...f })) })),
      timeline: [...this.timeline.map(t => ({ ...t }))],
      currentStep: this.stepCount,
      totalSteps: this.timeline.length,
      status: this.status,
      errorMessage: this.errorMessage,
      sourceLines: [...this.sourceLines],
      historyLength: this.snapshots.length,
      pointers: this.computePointers(),
    };
  }

  getExecutionHistory(): import("./engine-types").ExecutionSnapshot[] {
    return this.snapshots.map(s => {
      const lastEvent = s.timeline[s.timeline.length - 1];
      return {
        id: `snap-${s.currentStep}`,
        lineNumber: s.currentLine,
        event: lastEvent ? lastEvent.description : s.status === "idle" ? "idle" : "init",
        stack: s.stack,
        heap: s.heap,
        pointers: s.pointers ?? [],
        timestamp: lastEvent ? lastEvent.timestamp : "00:00",
        status: s.status,
        sourceLines: s.sourceLines,
      };
    });
  }

  getSnapshots(): EngineSnapshot[] {
    // return deep copies already stored
    return this.snapshots.map(s => ({
      ...s,
      stack: s.stack.map(f => ({ ...f, variables: f.variables.map(v => ({ ...v })) })),
      heap: s.heap.map(h => ({ ...h, fields: h.fields.map(f => ({ ...f })) })),
      timeline: s.timeline.map(t => ({ ...t })),
      sourceLines: [...s.sourceLines],
      pointers: s.pointers ? s.pointers.map(p => ({ ...p })) : [],
    }));
  }

  restoreStep(step: number) {
    // restore to a snapshot index (step is timeline step number)
    const target = this.snapshots.find(s => s.currentStep === step);
    if (target) {
      this.callStack = target.stack.map(s => ({
        functionName: s.functionName,
        pc: s.pc ?? 0,
        variables: s.variables.map(v => ({ ...v })),
        awaitingReturnVar: null,
        awaitingReturnType: null,
      }));
      this.heapObjects = target.heap.map(h => ({ ...h, fields: h.fields.map(f => ({ ...f })) }));
      this.timeline = target.timeline.map(t => ({ ...t }));
      this.currentLineNumber = target.currentLine;
      this.stepCount = target.currentStep;
      this.status = target.status;
      const idx = this.snapshots.findIndex(s => s.currentStep === step);
      this.snapshots = this.snapshots.slice(0, idx + 1);
    }
  }

  step(): boolean {
    if (this.status !== "running") return false;
    if (this.callStack.length === 0) { this.status = "finished"; return false; }
    const progressed = this.executeCurrentLine();
    this.stepCount++;
    if (this.callStack.length === 0) this.status = "finished";
    this.pushHistory();
    return progressed;
  }

  runAll() {
    while (this.status === "running") this.step();
  }

  private currentCallFrame() { return this.callStack[this.callStack.length - 1]; }
  private currentFunc() { return this.functions.get(this.currentCallFrame().functionName)!; }

  private pushHistory() {
    this.snapshots.push(this.getState());
  }

  private allocStackAddr(size = 8): string {
    this.nextStackAddr -= 0x10;
    return hexStack(this.nextStackAddr);
  }
  private allocHeapAddr(size = 0x40): string {
    const a = hexHeap(this.nextHeapAddr);
    this.nextHeapAddr += 0x40;
    return a;
  }

  private findVar(name: string): Variable | undefined {
    for (let i = this.callStack.length - 1; i >= 0; i--) {
      const v = this.callStack[i].variables.find(x => x.name === name);
      if (v) return v;
    }
    return undefined;
  }
  private findVarInFrame(frame: CallFrameInternal, name: string) { return frame.variables.find(v => v.name === name); }

  private pushTimeline(desc: string, kind: TimelineEvent["kind"], line: number) {
    const step = this.timeline.length + 1;
    const ts = `00:${String(step).padStart(2, "0")}`;
    this.timeline.push({ step, line, description: desc, kind, timestamp: ts });
  }

  private handleLinkedListLine(line: string, frame: CallFrameInternal): boolean {
    const trimmed = line.replace(/;.*$/, "").trim();
    // LinkedList list;
    if (/^LinkedList\s+\w+\s*$/.test(trimmed)) {
      const m = trimmed.match(/^LinkedList\s+(\w+)\s*$/);
      if (m) {
        const varName = m[1];
        const addr = this.allocStackAddr();
        frame.variables.push({ name: varName, type: "LinkedList", value: "{ head: nullptr }", address: addr, isPointer: false, isReference: false, pointsTo: null });
        this.linkedListHeads.set(varName, null);
        this.pushTimeline(`LinkedList ${varName}`, "struct", this.currentLineNumber);
        return true;
      }
    }
    // list.pushFront(30)
    let m = trimmed.match(/^(\w+)\.pushFront\s*\(\s*(.+)\s*\)\s*$/);
    if (m) {
      const listName = m[1];
      const valStr = m[2].trim();
      const val = valStr.replace(/^"|"$/g, "");
      const heapAddr = this.allocHeapAddr();
      const fields: HeapField[] = [
        { name: "data", type: "int", value: val, kind: "primitive" },
        { name: "next", type: "Node*", value: "nullptr", kind: "pointer", targetObjectId: this.linkedListHeads.get(listName) ?? null },
      ];
      // update next to old head if exists
      const oldHead = this.linkedListHeads.get(listName);
      if (oldHead) {
        const oldHeadField = fields.find(f => f.name === "next");
        if (oldHeadField) {
          (oldHeadField as any).targetObjectId = oldHead;
          oldHeadField.value = oldHead;
        }
      }
      this.heapObjects.push({ address: heapAddr, typeName: "Node", fields, isFreed: false, allocatedAtLine: this.currentLineNumber, sizeBytes: 16 });
      this.linkedListHeads.set(listName, heapAddr);
      // update list variable's value
      const listVar = this.findVar(listName);
      if (listVar) listVar.value = `{ head: ${heapAddr} }`;
      this.pushTimeline(`${listName}.pushFront(${val}) -> ${heapAddr}`, "heap", this.currentLineNumber);
      return true;
    }
    // list.insertAfter(middle, 25)
    m = trimmed.match(/^(\w+)\.insertAfter\s*\(\s*(\w+)\s*,\s*(.+)\s*\)\s*$/);
    if (m) {
      const listName = m[1];
      const prevName = m[2];
      const valStr = m[3].trim();
      const val = valStr.replace(/^"|"$/g, "");
      const prevVar = this.findVar(prevName);
      if (!prevVar || !prevVar.pointsTo) return false;
      const prevAddr = prevVar.pointsTo;
      const prevObj = this.heapObjects.find(h => h.address === prevAddr);
      if (!prevObj) return false;
      const nextField = prevObj.fields.find(f => f.name === "next");
      const oldNext = (nextField as any)?.targetObjectId as string | null;
      const heapAddr = this.allocHeapAddr();
      const fields: HeapField[] = [
        { name: "data", type: "int", value: val, kind: "primitive" },
        { name: "next", type: "Node*", value: oldNext ?? "nullptr", kind: "pointer", targetObjectId: oldNext ?? null },
      ];
      this.heapObjects.push({ address: heapAddr, typeName: "Node", fields, isFreed: false, allocatedAtLine: this.currentLineNumber, sizeBytes: 16 });
      // update prev's next to new node
      if (nextField) {
        (nextField as any).targetObjectId = heapAddr;
        nextField.value = heapAddr;
      }
      this.pushTimeline(`${listName}.insertAfter(${prevName}, ${val})`, "heap", this.currentLineNumber);
      return true;
    }
    // Node* middle = list.find(20);
    m = trimmed.match(/^(?:Node\*\s+)?(\w+)\s*=\s*(\w+)\.find\s*\(\s*(.+)\s*\)\s*$/);
    if (m) {
      const varName = m[1];
      const listName = m[2];
      const valStr = m[3].trim().replace(/^"|"$/g, "");
      // find node with data == valStr
      const target = this.heapObjects.find(h => !h.isFreed && h.typeName === "Node" && h.fields.find(f => f.name === "data" && f.value === valStr));
      const targetAddr = target ? target.address : null;
      const addr = this.allocStackAddr();
      frame.variables.push({ name: varName, type: "Node*", value: targetAddr ?? "nullptr", address: addr, isPointer: true, isReference: false, pointsTo: targetAddr, isNull: !targetAddr });
      this.pushTimeline(`${varName} = ${listName}.find(${valStr})`, "pointer", this.currentLineNumber);
      return true;
    }
    // list.deleteValue(20)
    m = trimmed.match(/^(\w+)\.deleteValue\s*\(\s*(.+)\s*\)\s*$/);
    if (m) {
      const listName = m[1];
      const valStr = m[2].trim().replace(/^"|"$/g, "");
      const headAddr = this.linkedListHeads.get(listName);
      if (!headAddr) return false;
      const headObj = this.heapObjects.find(h => h.address === headAddr);
      if (!headObj) return false;
      // if head is victim
      const headData = headObj.fields.find(f => f.name === "data")?.value;
      if (headData === valStr) {
        const next = (headObj.fields.find(f => f.name === "next") as any)?.targetObjectId as string | null;
        this.linkedListHeads.set(listName, next);
        headObj.isFreed = true;
        const listVar = this.findVar(listName);
        if (listVar) listVar.value = `{ head: ${next ?? "nullptr"} }`;
        this.pushTimeline(`${listName}.deleteValue(${valStr}) head`, "delete", this.currentLineNumber);
        return true;
      }
      // find prev to victim
      let curAddr: string | null = headAddr;
      while (curAddr) {
        const curObj = this.heapObjects.find(h => h.address === curAddr);
        if (!curObj) break;
        const nextField = curObj.fields.find(f => f.name === "next") as any;
        const nextAddr = nextField?.targetObjectId as string | null;
        if (!nextAddr) break;
        const nextObj = this.heapObjects.find(h => h.address === nextAddr);
        if (!nextObj) break;
        const nextData = nextObj.fields.find(f => f.name === "data")?.value;
        if (nextData === valStr) {
          const victimNext = (nextObj.fields.find(f => f.name === "next") as any)?.targetObjectId as string | null;
          nextField.targetObjectId = victimNext;
          nextField.value = victimNext ?? "nullptr";
          nextObj.isFreed = true;
          this.pushTimeline(`${listName}.deleteValue(${valStr})`, "delete", this.currentLineNumber);
          return true;
        }
        curAddr = nextAddr;
      }
      this.pushTimeline(`${listName}.deleteValue(${valStr}) not found`, "delete", this.currentLineNumber);
      return true;
    }
    // int total = list.recursiveSum(list.getHead());
    m = trimmed.match(/^(?:int\s+)?(\w+)\s*=\s*(\w+)\.recursiveSum\s*\(.*\)\s*$/);
    if (m) {
      const varName = m[1];
      // compute sum of all Node data
      let sum = 0;
      this.heapObjects.filter(h => !h.isFreed && h.typeName === "Node").forEach(h => {
        const d = h.fields.find(f => f.name === "data")?.value;
        sum += parseInt(d ?? "0");
      });
      const addr = this.allocStackAddr();
      frame.variables.push({ name: varName, type: "int", value: String(sum), address: addr, isPointer: false, isReference: false, pointsTo: null });
      this.pushTimeline(`${varName} = sum ${sum}`, "allocate", this.currentLineNumber);
      return true;
    }
    // Node* head = list.getHead()
    m = trimmed.match(/^(?:Node\*\s+)?(\w+)\s*=\s*(\w+)\.getHead\s*\(\s*\)\s*$/);
    if (m) {
      const varName = m[1];
      const listName = m[2];
      const headAddr = this.linkedListHeads.get(listName) ?? null;
      const addr = this.allocStackAddr();
      frame.variables.push({ name: varName, type: "Node*", value: headAddr ?? "nullptr", address: addr, isPointer: true, isReference: false, pointsTo: headAddr, isNull: !headAddr });
      this.pushTimeline(`${varName} = ${listName}.getHead()`, "pointer", this.currentLineNumber);
      return true;
    }
    // list.print()
    if (/^\w+\.print\s*\(\s*\)\s*$/.test(trimmed)) {
      this.pushTimeline(`${trimmed}`, "allocate", this.currentLineNumber);
      return true;
    }
    // BinaryTree tree;
    if (/^BinaryTree\s+\w+\s*$/.test(trimmed)) {
      const mm = trimmed.match(/^BinaryTree\s+(\w+)\s*$/);
      if (mm) {
        const varName = mm[1];
        const addr = this.allocStackAddr();
        frame.variables.push({ name: varName, type: "BinaryTree", value: "{ root: nullptr }", address: addr, isPointer: false, isReference: false, pointsTo: null });
        this.binaryTreeRoots.set(varName, null);
        this.pushTimeline(`BinaryTree ${varName}`, "struct", this.currentLineNumber);
        return true;
      }
    }
    // tree.insert(50) - BST insert
    m = trimmed.match(/^(\w+)\.insert\s*\(\s*(.+)\s*\)\s*$/);
    if (m) {
      const treeName = m[1];
      const valStr = m[2].trim().replace(/^"|"$/g, "");
      const val = parseInt(valStr);
      const heapAddr = this.allocHeapAddr();
      const fields: HeapField[] = [
        { name: "value", type: "int", value: String(val), kind: "primitive" },
        { name: "left", type: "TreeNode*", value: "nullptr", kind: "pointer", targetObjectId: null },
        { name: "right", type: "TreeNode*", value: "nullptr", kind: "pointer", targetObjectId: null },
      ];
      this.heapObjects.push({ address: heapAddr, typeName: "TreeNode", fields, isFreed: false, allocatedAtLine: this.currentLineNumber, sizeBytes: 24 });
      // BST insert
      let rootAddr = this.binaryTreeRoots.get(treeName) ?? null;
      if (!rootAddr) {
        this.binaryTreeRoots.set(treeName, heapAddr);
      } else {
        // traverse to find parent
        let curAddr: string | null = rootAddr;
        while (curAddr) {
          const curObj = this.heapObjects.find(h => h.address === curAddr);
          if (!curObj) break;
          const curVal = parseInt(curObj.fields.find(f => f.name === "value")?.value ?? "0");
          const leftField = curObj.fields.find(f => f.name === "left") as any;
          const rightField = curObj.fields.find(f => f.name === "right") as any;
          if (val < curVal) {
            if (!leftField.targetObjectId) {
              leftField.targetObjectId = heapAddr;
              leftField.value = heapAddr;
              break;
            } else {
              curAddr = leftField.targetObjectId;
            }
          } else {
            if (!rightField.targetObjectId) {
              rightField.targetObjectId = heapAddr;
              rightField.value = heapAddr;
              break;
            } else {
              curAddr = rightField.targetObjectId;
            }
          }
        }
      }
      const treeVar = this.findVar(treeName);
      if (treeVar) treeVar.value = `{ root: ${this.binaryTreeRoots.get(treeName)} }`;
      this.pushTimeline(`${treeName}.insert(${val})`, "heap", this.currentLineNumber);
      return true;
    }
    // TreeNode* found = tree.search(40);
    m = trimmed.match(/^(?:TreeNode\*\s+)?(\w+)\s*=\s*(\w+)\.search\s*\(\s*(.+)\s*\)\s*$/);
    if (m) {
      const varName = m[1];
      const treeName = m[2];
      const valStr = m[3].trim().replace(/^"|"$/g, "");
      const val = parseInt(valStr);
      let curAddr = this.binaryTreeRoots.get(treeName) ?? null;
      let found: string | null = null;
      while (curAddr) {
        const curObj = this.heapObjects.find(h => h.address === curAddr);
        if (!curObj) break;
        const curVal = parseInt(curObj.fields.find(f => f.name === "value")?.value ?? "0");
        if (curVal === val) { found = curAddr; break; }
        const left = (curObj.fields.find(f => f.name === "left") as any)?.targetObjectId as string | null;
        const right = (curObj.fields.find(f => f.name === "right") as any)?.targetObjectId as string | null;
        if (val < curVal) curAddr = left;
        else curAddr = right;
      }
      const addr = this.allocStackAddr();
      frame.variables.push({ name: varName, type: "TreeNode*", value: found ?? "nullptr", address: addr, isPointer: true, isReference: false, pointsTo: found, isNull: !found });
      this.pushTimeline(`${varName} = ${treeName}.search(${valStr})`, "pointer", this.currentLineNumber);
      return true;
    }
    // int h = tree.height();
    m = trimmed.match(/^(?:int\s+)?(\w+)\s*=\s*(\w+)\.height\s*\(\s*\)\s*$/);
    if (m) {
      const varName = m[1];
      const treeName = m[2];
      const rootAddr = this.binaryTreeRoots.get(treeName) ?? null;
      const computeHeight = (addr: string | null): number => {
        if (!addr) return 0;
        const obj = this.heapObjects.find(h => h.address === addr);
        if (!obj) return 0;
        const left = (obj.fields.find(f => f.name === "left") as any)?.targetObjectId as string | null;
        const right = (obj.fields.find(f => f.name === "right") as any)?.targetObjectId as string | null;
        return 1 + Math.max(computeHeight(left), computeHeight(right));
      };
      const h = computeHeight(rootAddr);
      const addr = this.allocStackAddr();
      frame.variables.push({ name: varName, type: "int", value: String(h), address: addr, isPointer: false, isReference: false, pointsTo: null });
      this.pushTimeline(`${varName} = height ${h}`, "allocate", this.currentLineNumber);
      return true;
    }
    return false;
  }

  private parse() {
    const lines = this.sourceLines;
    let i = 0;
    while (i < lines.length) {
      const raw = stripComment(lines[i]).trim();
      // struct / class parsing - handle both single-line and multi-line
      const structMatch = raw.match(/^(?:struct|class)\s+(\w+)\s*(?::\s*\w+\s*)?\{/);
      if (structMatch) {
        const name = structMatch[1];
        const fields: { type: string; name: string }[] = [];
        // Check if fields are on same line as struct definition (e.g., struct Bar { int x; };)
        const afterBrace = raw.slice(raw.indexOf("{") + 1);
        if (afterBrace.includes("}")) {
          // Single line struct like "struct Bar { int x; };"
          const inside = afterBrace.slice(0, afterBrace.indexOf("}"));
          const fieldParts = inside.split(";").map(s => s.trim()).filter(Boolean);
          for (const part of fieldParts) {
            const fm = part.match(/^([\w:]+(?:\s*[*&])?)\s+(\w+)\s*$/);
            if (fm) fields.push({ type: fm[1].trim(), name: fm[2] });
          }
        } else {
          i++;
          while (i < lines.length && !lines[i].includes("};")) {
            const fline = stripComment(lines[i]).trim();
            const fm = fline.match(/^([\w:]+(?:\s*[*&])?)\s+(\w+)\s*;/);
            if (fm) fields.push({ type: fm[1].trim(), name: fm[2] });
            const sfm = fline.match(/^(string)\s+(\w+)\s*;/);
            if (sfm && !fm) fields.push({ type: "string", name: sfm[2] });
            i++;
          }
        }
        this.structs.set(name, { name, fields });
        i++; // skip };
        continue;
      }
      // function parsing: returntype name(params) {
      const funcMatch = raw.match(/^([\w:]+(?:\s*[*&])?)\s+(\w+)\s*\(([^)]*)\)\s*\{/);
      if (funcMatch) {
        const returnType = funcMatch[1].trim();
        const fname = funcMatch[2];
        const paramsStr = funcMatch[3].trim();
        const params: { type: string; name: string }[] = [];
        if (paramsStr.length > 0) {
          const parts = paramsStr.split(",").map(s => s.trim()).filter(Boolean);
          for (const p of parts) {
            const pm = p.match(/^([\w:]+(?:\s*[*&])?)\s+(\w+)$/);
            if (pm) params.push({ type: pm[1].trim(), name: pm[2] });
            else {
              // handle "int* a" or "int &a"
              const alt = p.match(/^([\w:]+)\s*([*&])\s*(\w+)$/);
              if (alt) params.push({ type: `${alt[1]}${alt[2]}`, name: alt[3] });
            }
          }
        }
        const bodyLines: string[] = [];
        const bodyLineNumbers: number[] = [];
        let depth = 1;
        // count braces in rest of opening line after {
        // we already consumed opening {
        i++;
        while (i < lines.length && depth > 0) {
          const l = lines[i];
          for (const ch of l) { if (ch === "{") depth++; else if (ch === "}") depth--; }
          if (depth > 0) { bodyLines.push(l); bodyLineNumbers.push(i + 1); }
          else {
            // depth 0 means we hit closing }
            // but need to capture lines before }
            // already handled
          }
          i++;
          if (depth === 0) break;
        }
        this.functions.set(fname, { returnType, name: fname, params, bodyLines, bodyLineNumbers });
        continue;
      }
      i++;
    }
  }

  private executeCurrentLine(): boolean {
    const frame = this.currentCallFrame();
    const func = this.currentFunc();
    if (!func) return false;
    if (frame.pc >= func.bodyLines.length) {
      // end of function - implicit return
      if (frame.functionName === "main") {
        this.status = "finished";
        return false;
      }
      this.callStack.pop();
      if (this.callStack.length > 0) {
        const caller = this.currentCallFrame();
        caller.pc++;
        const cf = this.functions.get(caller.functionName);
        if (cf && caller.pc < cf.bodyLines.length) this.currentLineNumber = cf.bodyLineNumbers[caller.pc];
      } else {
        this.status = "finished";
      }
      return true;
    }
    const rawLine = func.bodyLines[frame.pc];
    const lineForTimeline = rawLine.trim();
    const line = stripComment(rawLine).trim();
    this.currentLineNumber = func.bodyLineNumbers[frame.pc];

    // LinkedList native handling for demo
    if (this.handleLinkedListLine(line, frame)) {
      frame.pc++;
      if (frame.pc < func.bodyLines.length) this.currentLineNumber = func.bodyLineNumbers[frame.pc];
      return true;
    }

    if (line.length === 0 || line === "{" || line === "}") {
      frame.pc++;
      if (frame.pc < func.bodyLines.length) this.currentLineNumber = func.bodyLineNumbers[frame.pc];
      return true;
    }

    // return statement
    if (line.startsWith("return")) {
      const expr = line.replace(/^return\s+/, "").replace(/;.*$/, "").trim();
      const val = this.evalExpr(expr, frame);
      const isMain = frame.functionName === "main";
      const caller = this.callStack[this.callStack.length - 2];
      if (isMain) {
        this.status = "finished";
        this.pushTimeline(`return ${val.value}`, "ret", this.currentLineNumber);
        // keep main frame for final visualization
        return true;
      }
      this.callStack.pop();
      if (caller && caller.awaitingReturnVar) {
        const retVarName = caller.awaitingReturnVar;
        const retType = caller.awaitingReturnType || "int";
        const addr = this.allocStackAddr();
        const isPtrRet = retType.includes("*");
        caller.variables.push({ name: retVarName, type: retType, value: val.value, address: addr, isPointer: isPtrRet, isReference: false, pointsTo: isPtrRet ? (val.pointsTo ?? null) : null });
        caller.awaitingReturnVar = null;
        caller.awaitingReturnType = null;
      } else if (caller) {
        // no awaiting var, just ignore return value
      }
      if (this.callStack.length > 0) {
        const newTop = this.currentCallFrame();
        newTop.pc++;
        const nf = this.functions.get(newTop.functionName);
        if (nf && newTop.pc < nf.bodyLines.length) this.currentLineNumber = nf.bodyLineNumbers[newTop.pc];
      }
      this.pushTimeline(`return ${val.value}`, "ret", this.currentLineNumber);
      return true;
    }

    // delete
    if (line.startsWith("delete")) {
      const dm = line.match(/delete\s*(\[\])?\s*(\w+)\s*;/);
      if (dm) {
        const varName = dm[2];
        const v = this.findVar(varName);
        if (v && v.pointsTo) {
          const heapObj = this.heapObjects.find(h => h.address === v.pointsTo);
          if (heapObj) heapObj.isFreed = true;
        }
        if (v) { v.value = "nullptr"; v.pointsTo = null; v.isNull = true; }
        this.pushTimeline(`delete ${varName}`, "delete", this.currentLineNumber);
      }
      frame.pc++;
      if (frame.pc < func.bodyLines.length) this.currentLineNumber = func.bodyLineNumbers[frame.pc];
      return true;
    }

    // Try function call assignment: type var = func(args);
    // e.g., int z = add(x, y);
    // Also: auto z = add(x);
    let handled = this.tryHandleFunctionCall(line, frame, func);
    if (handled) return true;

    // Pointer / reference / variable declarations
    handled = this.tryHandleDeclaration(line, frame);
    if (handled) {
      frame.pc++;
      if (frame.pc < func.bodyLines.length) this.currentLineNumber = func.bodyLineNumbers[frame.pc];
      return true;
    }

    // Assignment: x = 10; *p = 20; p = &x; etc
    handled = this.tryHandleAssignment(line, frame);
    if (handled) {
      frame.pc++;
      if (frame.pc < func.bodyLines.length) this.currentLineNumber = func.bodyLineNumbers[frame.pc];
      return true;
    }

    // Standalone function call without assignment: foo(x);
    const callOnly = line.match(/^(\w+)\s*\((.*)\)\s*;$/);
    if (callOnly) {
      const fname = callOnly[1];
      const argsStr = callOnly[2];
      if (this.functions.has(fname)) {
        const args = this.splitArgs(argsStr);
        const evaluated = args.map(a => this.evalExpr(a, frame));
        const fd = this.functions.get(fname)!;
        const newFrame: CallFrameInternal = { functionName: fname, pc: 0, variables: [], awaitingReturnVar: null, awaitingReturnType: null };
        // bind params
        fd.params.forEach((p, idx) => {
          const ev = evaluated[idx];
          const addr = this.allocStackAddr();
          const isPtr = p.type.includes("*");
          const isRef = p.type.includes("&");
          let pointsTo: string | null = null;
          let val = ev.value;
          if (isPtr) pointsTo = ev.pointsTo ?? (ev.value.startsWith("0x") ? ev.value : null);
          if (isRef && ev.pointsTo) { pointsTo = ev.pointsTo; val = ev.value; }
          newFrame.variables.push({ name: p.name, type: p.type, value: val, address: addr, isPointer: isPtr, isReference: isRef, pointsTo });
        });
        frame.pc++; // will resume after return
        // keep awaiting? no var
        this.callStack.push(newFrame);
        if (fd.bodyLineNumbers.length > 0) this.currentLineNumber = fd.bodyLineNumbers[0];
        this.pushTimeline(`call ${fname}()`, "call", this.currentLineNumber);
        return true;
      }
    }

    // fallback: treat as unknown, just advance
    this.pushTimeline(lineForTimeline, "allocate", this.currentLineNumber);
    frame.pc++;
    if (frame.pc < func.bodyLines.length) this.currentLineNumber = func.bodyLineNumbers[frame.pc];
    return true;
  }

  private tryHandleFunctionCall(line: string, frame: CallFrameInternal, func: FuncDef): boolean {
    // pattern: [type] var = func(args);
    const m = line.match(/^(?:([\w:]+(?:\s*[*&])?)\s+)?(\w+)\s*=\s*(\w+)\s*\((.*)\)\s*;$/);
    if (!m) return false;
    const declType = m[1]?.trim();
    const varName = m[2];
    const fname = m[3];
    const argsStr = m[4];
    if (!this.functions.has(fname)) return false;
    // this is a call, need to check if rhs is indeed function call (not new etc)
    // Ensure declType is not part of new: already filtered
    const args = this.splitArgs(argsStr);
    const evaluated = args.map(a => this.evalExpr(a, frame));
    const fd = this.functions.get(fname)!;
    const newFrame: CallFrameInternal = { functionName: fname, pc: 0, variables: [], awaitingReturnVar: null, awaitingReturnType: null };
    fd.params.forEach((p, idx) => {
      const ev = evaluated[idx];
      const addr = this.allocStackAddr();
      const isPtr = p.type.includes("*");
      const isRef = p.type.includes("&");
      let pointsTo: string | null = null;
      const val = ev.value;
      if (isPtr) pointsTo = ev.pointsTo ?? null;
      if (isRef) { // reference binds to address
        const target = this.findVar(ev.value) || this.findVar(args[idx].trim());
        if (target) pointsTo = target.address;
        else pointsTo = ev.pointsTo ?? null;
      }
      newFrame.variables.push({ name: p.name, type: p.type, value: val, address: addr, isPointer: isPtr, isReference: isRef, pointsTo });
    });
    // set awaiting return on caller
    frame.awaitingReturnVar = varName;
    frame.awaitingReturnType = declType || "int";
    // note: we don't yet create var in caller; it will be created on return
    // But for visualization, we want to show pending? We'll show after return
    this.callStack.push(newFrame);
    // Do not increment caller pc yet? Keep it at current line; caller will advance on return
    // But we need to keep pc so that after return we go to next line
    // Instead we keep caller pc as current, and on return we increment
    // So don't increment here
    if (fd.bodyLineNumbers.length > 0) this.currentLineNumber = fd.bodyLineNumbers[0];
    else this.currentLineNumber = func.bodyLineNumbers[frame.pc];
    this.pushTimeline(`call ${fname}() -> ${varName}`, "call", this.currentLineNumber);
    return true;
  }

  private tryHandleDeclaration(line: string, frame: CallFrameInternal): boolean {
    // Covers: int x = 42;  int x;  int* p = &x; int& r = x; float f = 3.14; char c='A';
    //        Person* p = new Person{...}; Person* p = new Person("Alice",21); int* arr = new int[5]; int* p = new int(42);
    // struct on stack: Person alice = {"Alice",21}; or Person alice{"Alice",21};

    // Remove trailing ;
    const trimmed = line.replace(/;.*$/, "").trim();
    // Check for new
    const newMatch = trimmed.match(/^([\w:]+(?:\s*[*&])?)\s+(\w+)\s*=\s*new\s+(.+)$/);
    if (newMatch) {
      const varType = newMatch[1].trim();
      const varName = newMatch[2];
      const newExpr = newMatch[3].trim();

      const isPointer = varType.includes("*");
      const baseType = varType.replace(/[*&]/g, "").trim();

      // new int(42) or new int[5] or new Person{"Alice",21} or new Person
      const heapAddr = this.allocHeapAddr();
      const fields: HeapField[] = [];
      let rawVal = "";
      let size = 16;

      // array
      const arrMatch = newExpr.match(/^(\w+)\s*\[\s*(\d+)\s*\]$/);
      if (arrMatch) {
        const arrType = arrMatch[1];
        const count = parseInt(arrMatch[2]);
        size = count * 4;
        for (let i = 0; i < count; i++) fields.push({ name: `[${i}]`, type: arrType, value: "0", kind: "primitive" });
        rawVal = `${arrType}[${count}]`;
        this.heapObjects.push({ address: heapAddr, typeName: `${arrType}[${count}]`, fields, isFreed: false, allocatedAtLine: this.currentLineNumber, sizeBytes: size });
      } else {
        // new Type(args) or new Type{args}
        const typeMatch = newExpr.match(/^(\w+)\s*[\(\{](.*)[\)\}]$/);
        if (typeMatch) {
          const tname = typeMatch[1];
          const argsStr = typeMatch[2];
          const sdef = this.structs.get(tname);
          if (sdef) {
            const vals = this.splitArgs(argsStr).map(s => s.trim().replace(/^"|"$/g, ""));
            sdef.fields.forEach((f, idx) => {
              const raw = vals[idx] ?? "0";
              const isPtrField = f.type.includes("*");
              if (isPtrField) {
                if (raw === "nullptr" || raw === "NULL" || raw === "0" || raw === "nullptr}") {
                  fields.push({ name: f.name, type: f.type, value: "nullptr", kind: "pointer", targetObjectId: null });
                } else {
                  const srcVar = this.findVar(raw);
                  const targetAddr = srcVar?.pointsTo ?? null;
                  // also handle raw as address string
                  const isAddr = raw.startsWith("0x");
                  fields.push({ name: f.name, type: f.type, value: targetAddr ?? (isAddr ? raw : raw), kind: "pointer", targetObjectId: targetAddr ?? (isAddr ? raw : null) });
                }
              } else {
                fields.push({ name: f.name, type: f.type, value: raw, kind: "primitive" });
              }
            });
            rawVal = vals.join(", ");
            size = sdef.fields.length * 8;
          } else {
            // primitive with initializer
            const isPtr = tname.includes("*");
            fields.push({ name: "value", type: tname, value: argsStr.trim(), kind: isPtr ? "pointer" : "primitive", targetObjectId: null });
            rawVal = argsStr.trim();
          }
          this.heapObjects.push({ address: heapAddr, typeName: tname, fields, isFreed: false, allocatedAtLine: this.currentLineNumber, sizeBytes: size, rawValue: rawVal });
        } else {
          // new Type (no args) or new Person
          const tname = newExpr.trim();
          const sdef = this.structs.get(tname);
          if (sdef) {
            sdef.fields.forEach(f => {
              const isPtrField = f.type.includes("*");
              fields.push({ name: f.name, type: f.type, value: isPtrField ? "nullptr" : "0", kind: isPtrField ? "pointer" : "primitive", targetObjectId: null });
            });
            size = sdef.fields.length * 8;
          } else {
            fields.push({ name: "value", type: tname, value: "0", kind: "primitive" });
          }
          this.heapObjects.push({ address: heapAddr, typeName: tname, fields, isFreed: false, allocatedAtLine: this.currentLineNumber, sizeBytes: size });
        }
      }

      const stackAddr = this.allocStackAddr();
      const varValue = heapAddr;
      frame.variables.push({ name: varName, type: varType, value: varValue, address: stackAddr, isPointer: isPointer, isReference: false, pointsTo: heapAddr });
      this.pushTimeline(`new ${baseType} -> ${heapAddr}`, "heap", this.currentLineNumber);
      return true;
    }

    // Normal declaration with init: type name = expr
    // Need to handle types like int, float, double, char, string, Person, int*, int&, etc.
    // Regex for declaration: ^type name = expr  or  ^type name  (no init)  or  type name{args}
    const declWithInit = trimmed.match(/^([\w:]+(?:\s*[*&])?)\s+(\w+)\s*=\s*(.+)$/);
    if (declWithInit) {
      const declType = declWithInit[1].trim();
      const varName = declWithInit[2];
      const expr = declWithInit[3].trim();

      // Normalize type: handle "int *p" already captured? But we capture type includes *?
      // For "int* p" we get "int*" correctly. For "int *p", trimmed starts with "int *p = ..." -> first capture "int *"? regex allows.
      // Detect if expr is braced struct init: {"Alice",21} or Person{...}
      const structOnStack = this.structs.has(declType.replace(/[*&]/g, "").trim());
      const isPointer = declType.includes("*");
      const isReference = declType.includes("&");

      const stackAddr = this.allocStackAddr();

      if (isReference) {
        // int& r = x;
        const targetName = expr.replace(/;.*$/, "").trim();
        const target = this.findVar(targetName);
        const pointsTo = target ? target.address : null;
        const val = target ? target.value : expr;
        frame.variables.push({ name: varName, type: declType, value: val, address: stackAddr, isPointer: false, isReference: true, pointsTo });
        this.pushTimeline(`ref ${varName} -> ${targetName}`, "reference", this.currentLineNumber);
        return true;
      }

      if (isPointer) {
        // p = &x  or p = nullptr  or p = otherPointer
        if (expr === "nullptr" || expr === "NULL" || expr === "0") {
          frame.variables.push({ name: varName, type: declType, value: "nullptr", address: stackAddr, isPointer: true, isReference: false, pointsTo: null, isNull: true });
          this.pushTimeline(`pointer ${varName} = nullptr`, "pointer", this.currentLineNumber);
          return true;
        }
        if (expr.startsWith("&")) {
          const targetName = expr.slice(1).trim();
          const target = this.findVar(targetName);
          const targetHeap = this.heapObjects.find(h => h.address === target?.pointsTo);
          const pointsTo: string | null = target ? target.address : null;
          // if target is heap pointer, point to heap object instead? But & doesn't apply to heap?
          frame.variables.push({ name: varName, type: declType, value: pointsTo ?? "0x0", address: stackAddr, isPointer: true, isReference: false, pointsTo });
          this.pushTimeline(`pointer ${varName} -> ${targetName}`, "pointer", this.currentLineNumber);
          return true;
        }
        // assignment from another pointer or heap address
        const src = this.findVar(expr);
        if (src) {
          frame.variables.push({ name: varName, type: declType, value: src.value, address: stackAddr, isPointer: true, isReference: false, pointsTo: src.pointsTo ?? src.address });
          this.pushTimeline(`pointer ${varName} = ${expr}`, "pointer", this.currentLineNumber);
          return true;
        }
        if (expr.includes("->")) {
          const evalRes2 = this.evalExpr(expr, frame);
          frame.variables.push({ name: varName, type: declType, value: evalRes2.value, address: stackAddr, isPointer: true, isReference: false, pointsTo: evalRes2.pointsTo ?? null, isNull: !evalRes2.pointsTo });
          this.pushTimeline(`pointer ${varName} = ${expr}`, "pointer", this.currentLineNumber);
          return true;
        }
        // raw address or literal
        const evalRes = this.evalExpr(expr, frame);
        frame.variables.push({ name: varName, type: declType, value: evalRes.value, address: stackAddr, isPointer: true, isReference: false, pointsTo: evalRes.pointsTo ?? null });
        this.pushTimeline(`pointer ${varName}`, "pointer", this.currentLineNumber);
        return true;
      }

      // Non-pointer: check for struct stack allocation with braces: Person p = {"Alice",21};
      if (expr.startsWith("{") || expr.startsWith("Person{") || (structOnStack && (expr.includes("{") || expr.includes("(")))) {
        // try to parse fields
        let valStr = expr;
        // remove type prefix if present: Person{"Alice",21}
        valStr = valStr.replace(/^\w+\s*/, "");
        // extract inside {} or ()
        const inner = valStr.match(/[\{\(](.*)[\}\)]/);
        const content = inner ? inner[1] : valStr;
        const vals = this.splitArgs(content).map(s => s.trim().replace(/^"|"$/g, ""));
        const sdef = this.structs.get(declType);
        const heapFields: HeapField[] = [];
        if (sdef) sdef.fields.forEach((f, idx) => heapFields.push({ name: f.name, type: f.type, value: vals[idx] ?? "0", kind: f.type.includes("*") ? "pointer" : "primitive" }));
        // For stack struct, we represent as variable with struct value, but also create heap? No, stack struct stays on stack as fields
        // We'll store value as formatted
        const displayValue = `{ ${vals.join(", ")} }`;
        frame.variables.push({ name: varName, type: declType, value: displayValue, address: stackAddr, isPointer: false, isReference: false, pointsTo: null });
        // Also optionally create a pseudo-heap? No
        this.pushTimeline(`struct ${declType} ${varName}`, "struct", this.currentLineNumber);
        return true;
      }

      // regular primitive assignment: int x = 42; float pi = 3.14; char c = 'A'; int sum = a + b;
      const evalRes = this.evalExpr(expr, frame);
      let value = evalRes.value;
      // deref fallback already handled in evalExpr, but if expr is quoted char/string keep
      if (expr.startsWith("'") || expr.startsWith("\"")) value = expr.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
      frame.variables.push({ name: varName, type: declType, value, address: stackAddr, isPointer: false, isReference: false, pointsTo: null });
      this.pushTimeline(`allocate ${declType} ${varName} = ${value}`, "allocate", this.currentLineNumber);
      return true;
    }

    // Declaration without initializer: int x; int* p;
    const declNoInit = trimmed.match(/^([\w:]+(?:\s*[*&])?)\s+(\w+)$/);
    if (declNoInit) {
      const declType = declNoInit[1].trim();
      const varName = declNoInit[2];
      const stackAddr = this.allocStackAddr();
      const isPointer = declType.includes("*");
      const isReference = declType.includes("&");
      let value = isPointer ? "nullptr" : "0";
      if (declType.includes("float") || declType.includes("double")) value = "0.0";
      if (declType.includes("char")) value = "'\\0'";
      if (declType.includes("string")) value = '""';
      frame.variables.push({ name: varName, type: declType, value, address: stackAddr, isPointer, isReference, pointsTo: null, isNull: isPointer });
      // generic: if type is struct/class, init its pointer fields to null
      const baseType = declType.replace(/[*&]/g, "").trim();
      if (this.structs.has(baseType)) {
        const sdef = this.structs.get(baseType)!;
        const fieldMap = new Map<string, string | null>();
        sdef.fields.forEach(f => {
          if (f.type.includes("*")) fieldMap.set(f.name, null);
        });
        if (fieldMap.size > 0) this.stackObjectFields.set(varName, fieldMap);
      }
      this.pushTimeline(`allocate ${declType} ${varName}`, "allocate", this.currentLineNumber);
      return true;
    }

    // Stack struct with direct braces: Person alice{"Alice",21};
    const directStruct = trimmed.match(/^(\w+)\s+(\w+)\s*[\{\(](.*)[\}\)]$/);
    if (directStruct) {
      const tname = directStruct[1];
      const varName = directStruct[2];
      const content = directStruct[3];
      if (this.structs.has(tname)) {
        const vals = this.splitArgs(content).map(s => s.trim().replace(/^"|"$/g, ""));
        const display = `{ ${vals.join(", ")} }`;
        const stackAddr = this.allocStackAddr();
        frame.variables.push({ name: varName, type: tname, value: display, address: stackAddr, isPointer: false, isReference: false, pointsTo: null });
        this.pushTimeline(`struct ${tname} ${varName}`, "struct", this.currentLineNumber);
        return true;
      }
    }

    return false;
  }

  private tryHandleAssignment(line: string, frame: CallFrameInternal): boolean {
    const trimmed = line.replace(/;.*$/, "").trim();
    // Handle heap field assignment: p->next = q or obj.field = value
    const arrowAssign = trimmed.match(/^(\w+)\s*->\s*(\w+)\s*=\s*(.+)$/);
    if (arrowAssign) {
      const objVarName = arrowAssign[1];
      const fieldName = arrowAssign[2];
      const rhs = arrowAssign[3].trim();
      const objVar = this.findVar(objVarName);
      if (!objVar || !objVar.pointsTo) return false;
      const heapObj = this.heapObjects.find(h => h.address === objVar.pointsTo && !h.isFreed);
      if (!heapObj) return false;
      const field = heapObj.fields.find(f => f.name === fieldName);
      if (!field) return false;
      if (rhs === "nullptr" || rhs === "NULL" || rhs === "0") {
        field.value = "nullptr";
        (field as any).targetObjectId = null;
        field.kind = "pointer";
      } else if (rhs.startsWith("new")) {
        // heap allocation directly into field: p->next = new Node{...}
        const newExpr = rhs.slice(3).trim();
        const heapAddr = this.allocHeapAddr();
        let fields: HeapField[] = [];
        let size = 16;
        const typeMatch = newExpr.match(/^(\w+)\s*[\(\{](.*)[\)\}]$/);
        if (typeMatch) {
          const tname = typeMatch[1];
          const argsStr = typeMatch[2];
          const sdef = this.structs.get(tname);
          if (sdef) {
            const vals = this.splitArgs(argsStr).map(s => s.trim().replace(/^"|"$/g, ""));
            sdef.fields.forEach((f, idx) => {
              const raw = vals[idx] ?? "0";
              const isPtrField = f.type.includes("*");
              if (isPtrField) {
                if (raw === "nullptr" || raw === "NULL" || raw === "0") {
                  fields.push({ name: f.name, type: f.type, value: "nullptr", kind: "pointer", targetObjectId: null });
                } else {
                  const srcVar2 = this.findVar(raw);
                  const targetAddr2 = srcVar2?.pointsTo ?? null;
                  fields.push({ name: f.name, type: f.type, value: targetAddr2 ?? raw, kind: "pointer", targetObjectId: targetAddr2 });
                }
              } else {
                fields.push({ name: f.name, type: f.type, value: raw, kind: "primitive" });
              }
            });
            size = sdef.fields.length * 8;
          } else {
            fields.push({ name: "value", type: tname, value: argsStr.trim(), kind: "primitive" });
          }
          this.heapObjects.push({ address: heapAddr, typeName: tname, fields, isFreed: false, allocatedAtLine: this.currentLineNumber, sizeBytes: size });
        } else {
          const tname = newExpr.trim();
          const sdef = this.structs.get(tname);
          if (sdef) {
            sdef.fields.forEach(f => {
              const isPtrField = f.type.includes("*");
              fields.push({ name: f.name, type: f.type, value: isPtrField ? "nullptr" : "0", kind: isPtrField ? "pointer" : "primitive", targetObjectId: null });
            });
          } else {
            fields.push({ name: "value", type: tname, value: "0", kind: "primitive" });
          }
          this.heapObjects.push({ address: heapAddr, typeName: tname, fields, isFreed: false, allocatedAtLine: this.currentLineNumber, sizeBytes: 16 });
        }
        field.value = heapAddr;
        (field as any).targetObjectId = heapAddr;
        field.kind = "pointer";
      } else {
        const srcVar = this.findVar(rhs);
        if (srcVar) {
          const targetAddr = srcVar.pointsTo ?? null;
          field.value = targetAddr ?? srcVar.value;
          (field as any).targetObjectId = targetAddr;
          field.kind = "pointer";
        } else if (rhs.includes("->")) {
          const targetAddr = this.resolveRhsValue(rhs, frame);
          // resolveRhsValue for a->b returns address if pointer field
          const isAddr = targetAddr.startsWith("0x");
          field.value = targetAddr;
          (field as any).targetObjectId = isAddr ? targetAddr : null;
          field.kind = "pointer";
        } else {
          field.value = rhs;
          (field as any).targetObjectId = null;
        }
      }
      this.pushTimeline(`${objVarName}->${fieldName} = ${rhs}`, "assign", this.currentLineNumber);
      return true;
    }
    const dotAssign = trimmed.match(/^(\w+)\s*\.\s*(\w+)\s*=\s*(.+)$/);
    if (dotAssign) {
      const objVarName = dotAssign[1];
      const fieldName = dotAssign[2];
      const rhs = dotAssign[3].trim();
      const objVar = this.findVar(objVarName);
      // stack object field (e.g., list.head)
      if (objVar && this.structs.has(objVar.type.replace(/[*&]/g, "").trim())) {
        const structDef = this.structs.get(objVar.type.replace(/[*&]/g, "").trim());
        const fieldDef = structDef?.fields.find(f => f.name === fieldName);
        if (fieldDef) {
          let fieldMap = this.stackObjectFields.get(objVarName);
          if (!fieldMap) { fieldMap = new Map(); this.stackObjectFields.set(objVarName, fieldMap); }
          if (rhs === "nullptr" || rhs === "NULL" || rhs === "0") {
            fieldMap.set(fieldName, null);
            objVar.value = `{ ${fieldName}: nullptr }`;
          } else if (rhs.startsWith("new")) {
            const newExpr = rhs.slice(3).trim();
            const heapAddr = this.allocHeapAddr();
            let fields: HeapField[] = [];
            const typeMatch2 = newExpr.match(/^(\w+)\s*[\(\{](.*)[\)\}]$/);
            if (typeMatch2) {
              const tname = typeMatch2[1];
              const argsStr = typeMatch2[2];
              const sdef2 = this.structs.get(tname);
              if (sdef2) {
                const vals = this.splitArgs(argsStr).map(s => s.trim().replace(/^"|"$/g, ""));
                sdef2.fields.forEach((f, idx) => {
                  const raw = vals[idx] ?? "0";
                  const isPtr = f.type.includes("*");
                  if (isPtr) {
                    if (raw === "nullptr" || raw === "NULL" || raw === "0") fields.push({ name: f.name, type: f.type, value: "nullptr", kind: "pointer", targetObjectId: null });
                    else {
                      const src = this.findVar(raw);
                      const tAddr = src?.pointsTo ?? null;
                      fields.push({ name: f.name, type: f.type, value: tAddr ?? raw, kind: "pointer", targetObjectId: tAddr });
                    }
                  } else fields.push({ name: f.name, type: f.type, value: raw, kind: "primitive" });
                });
              }
              this.heapObjects.push({ address: heapAddr, typeName: typeMatch2[1], fields, isFreed: false, allocatedAtLine: this.currentLineNumber, sizeBytes: 16 });
            }
            fieldMap.set(fieldName, heapAddr);
            objVar.value = `{ ${fieldName}: ${heapAddr} }`;
            objVar.pointsTo = heapAddr; // for generic, also set pointsTo to head for BinaryTree/LinkedList
            if (objVar.type === "LinkedList") this.linkedListHeads.set(objVarName, heapAddr);
            if (objVar.type === "BinaryTree") this.binaryTreeRoots.set(objVarName, heapAddr);
          } else {
            const srcVar = this.findVar(rhs);
            const targetAddr = srcVar?.pointsTo ?? null;
            fieldMap.set(fieldName, targetAddr);
            objVar.value = `{ ${fieldName}: ${targetAddr ?? rhs} }`;
            if (fieldDef.type.includes("*")) {
              // also update linkedListHeads/binaryTreeRoots if field is head/root
              if (fieldName === "head") this.linkedListHeads.set(objVarName, targetAddr);
              if (fieldName === "root") this.binaryTreeRoots.set(objVarName, targetAddr);
            }
          }
          this.pushTimeline(`${objVarName}.${fieldName} = ${rhs}`, "assign", this.currentLineNumber);
          return true;
        }
      }
      // heap via pointer
      let heapObj: HeapObject | undefined;
      if (objVar && objVar.pointsTo) heapObj = this.heapObjects.find(h => h.address === objVar.pointsTo);
      else {
        // maybe stack struct variable? For now handle heap only
        return false;
      }
      if (!heapObj) return false;
      const field = heapObj.fields.find(f => f.name === fieldName);
      if (!field) return false;
      field.value = rhs;
      this.pushTimeline(`${objVarName}.${fieldName} = ${rhs}`, "assign", this.currentLineNumber);
      return true;
    }
    // *p = value   or  x = value   or  p = &x   or  p = nullptr
    const assign = trimmed.match(/^(\*?\w+)\s*=\s*(.+)$/);
    if (!assign) return false;
    const lhs = assign[1].trim();
    const rhs = assign[2].trim();

    if (lhs.startsWith("*")) {
      const ptrName = lhs.slice(1);
      const ptr = this.findVar(ptrName);
      if (ptr && ptr.pointsTo) {
        const targetAddr = ptr.pointsTo;
        // find target var by address
        const targetVar = this.findVarByAddress(targetAddr);
        if (targetVar) {
          const rhsVal = this.resolveRhsValue(rhs, frame);
          targetVar.value = rhsVal;
          this.pushTimeline(`*${ptrName} = ${rhsVal}`, "assign", this.currentLineNumber);
          return true;
        }
        const heapObj = this.heapObjects.find(h => h.address === targetAddr);
        if (heapObj) {
          const rhsVal = this.resolveRhsValue(rhs, frame);
          if (heapObj.fields.length > 0) {
            heapObj.fields[0].value = rhsVal;
            // keep kind
          } else heapObj.fields.push({ name: "value", type: "int", value: rhsVal, kind: "primitive" });
          this.pushTimeline(`*${ptrName} = ${rhsVal}`, "assign", this.currentLineNumber);
          return true;
        }
      }
      return false;
    } else {
      // lhs is variable name
      const v = this.findVar(lhs);
      if (v) {
        if (v.isReference) {
          // assign to reference propagates to target
          const targetAddr = v.pointsTo;
          if (targetAddr) {
            const target = this.findVarByAddress(targetAddr);
            if (target) {
              const rhsVal = this.resolveRhsValue(rhs, frame);
              target.value = rhsVal;
              v.value = rhsVal;
              this.pushTimeline(`${lhs} = ${rhsVal} (ref)`, "assign", this.currentLineNumber);
              return true;
            }
          }
        }
        if (v.isPointer) {
          if (rhs.startsWith("&")) {
            const tname = rhs.slice(1).trim();
            const target = this.findVar(tname);
            if (target) { v.pointsTo = target.address; v.value = target.address; v.isNull = false; }
            this.pushTimeline(`${lhs} = &${tname}`, "pointer", this.currentLineNumber);
            return true;
          }
          if (rhs === "nullptr" || rhs === "NULL" || rhs === "0") {
            v.pointsTo = null; v.value = "nullptr"; v.isNull = true;
            this.pushTimeline(`${lhs} = nullptr`, "pointer", this.currentLineNumber);
            return true;
          }
          if (rhs.includes("->")) {
            const targetAddr = this.resolveRhsValue(rhs, frame);
            const isAddr = targetAddr.startsWith("0x");
            v.pointsTo = isAddr ? targetAddr : null;
            v.value = targetAddr;
            v.isNull = !isAddr || targetAddr === "nullptr";
            this.pushTimeline(`${lhs} = ${rhs}`, "pointer", this.currentLineNumber);
            return true;
          }
          const src = this.findVar(rhs);
          if (src) { v.pointsTo = src.pointsTo ?? src.address; v.value = src.value; v.isNull = !!src.isNull; }
          else { v.value = rhs; }
          this.pushTimeline(`${lhs} = ${rhs}`, "pointer", this.currentLineNumber);
          return true;
        }
        // primitive assignment
        const rhsVal = this.resolveRhsValue(rhs, frame);
        v.value = rhsVal;
        this.pushTimeline(`${lhs} = ${rhsVal}`, "assign", this.currentLineNumber);
        return true;
      }
      // heap field assignment: p->age = 22; not yet
      // Also handle struct field: alice.age = 22; - ignore for now
    }
    return false;
  }

  private resolveRhsValue(rhs: string, frame: CallFrameInternal): string {
    rhs = rhs.trim();
    if (rhs.includes("->")) {
      const parts = rhs.split("->").map(s => s.trim());
      const objVarName = parts[0];
      const fieldName = parts[1];
      const objVar = this.findVar(objVarName);
      if (objVar && objVar.pointsTo) {
        const heapObj = this.heapObjects.find(h => h.address === objVar.pointsTo);
        if (heapObj) {
          const field = heapObj.fields.find(f => f.name === fieldName);
          if (field) {
            if (field.kind === "pointer") return (field as any).targetObjectId ?? "nullptr";
            return field.value;
          }
        }
      }
      return "nullptr";
    }
    if (rhs.includes(".")) {
      const parts = rhs.split(".").map(s => s.trim());
      if (parts.length === 2) {
        const objVarName = parts[0];
        const fieldName = parts[1];
        const fieldMap = this.stackObjectFields.get(objVarName);
        if (fieldMap) {
          const target = fieldMap.get(fieldName);
          if (target !== undefined) return target ?? "nullptr";
        }
        // also check heap via pointer's field? Already handled for ->
        const objVar = this.findVar(objVarName);
        if (objVar && this.structs.has(objVar.type.replace(/[*&]/g, "").trim())) {
          // stack object field, already handled via fieldMap
          const fm = this.stackObjectFields.get(objVarName)?.get(fieldName);
          if (fm !== undefined) return fm ?? "nullptr";
        }
      }
    }
    if (rhs.startsWith("&")) {
      const t = this.findVar(rhs.slice(1).trim());
      return t ? t.address : rhs;
    }
    if (rhs.startsWith("*")) {
      const ptr = this.findVar(rhs.slice(1).trim());
      if (ptr && ptr.pointsTo) {
        const target = this.findVarByAddress(ptr.pointsTo);
        if (target) return target.value;
        const h = this.heapObjects.find(h => h.address === ptr.pointsTo);
        if (h) return h.fields[0]?.value ?? "0";
      }
      return "0";
    }
    const v = this.findVar(rhs);
    if (v) return v.value;
    // literal
    return rhs.replace(/^"|"$/g, "");
  }

  private evalExpr(expr: string, frame: CallFrameInternal): { value: string; pointsTo?: string | null; targetAddr?: string } {
    expr = expr.trim();
    if (expr.includes("->")) {
      const parts = expr.split("->").map(s => s.trim());
      const objVarName = parts[0];
      const fieldName = parts[1];
      const objVar = this.findVar(objVarName);
      if (objVar && objVar.pointsTo) {
        const heapObj = this.heapObjects.find(h => h.address === objVar.pointsTo);
        if (heapObj) {
          const field = heapObj.fields.find(f => f.name === fieldName);
          if (field) {
            if (field.kind === "pointer") {
              const target = (field as any).targetObjectId as string | null;
              return { value: target ?? "nullptr", pointsTo: target };
            }
            return { value: field.value };
          }
        }
      }
      return { value: "nullptr", pointsTo: null };
    }
    if (expr.includes(".")) {
      const parts = expr.split(".").map(s => s.trim());
      if (parts.length === 2) {
        const objVarName = parts[0];
        const fieldName = parts[1];
        const fieldMap = this.stackObjectFields.get(objVarName);
        if (fieldMap) {
          const target = fieldMap.get(fieldName);
          if (target !== undefined) return { value: target ?? "nullptr", pointsTo: target ?? null };
        }
        const objVar = this.findVar(objVarName);
        if (objVar && this.structs.has(objVar.type.replace(/[*&]/g, "").trim())) {
          const fm = this.stackObjectFields.get(objVarName)?.get(fieldName);
          if (fm !== undefined) return { value: fm ?? "nullptr", pointsTo: fm ?? null };
        }
      }
    }
    if (expr.startsWith("&")) {
      const t = this.findVar(expr.slice(1).trim());
      return { value: t ? t.address : "0x0", pointsTo: t?.address ?? null };
    }
    if (expr.startsWith("*")) {
      const ptr = this.findVar(expr.slice(1).trim());
      if (ptr && ptr.pointsTo) {
        const target = this.findVarByAddress(ptr.pointsTo);
        if (target) return { value: target.value };
        const h = this.heapObjects.find(h => h.address === ptr.pointsTo);
        if (h) return { value: h.fields[0]?.value ?? "0" };
      }
      return { value: "0" };
    }
    const v = this.findVar(expr);
    if (v) return { value: v.value, pointsTo: v.pointsTo ?? v.address };
    // check for binary expr like a + b
    const bin = expr.match(/^(\w+)\s*([\+\-\*\/])\s*(\w+)$/);
    if (bin) {
      const l = this.resolveRhsValue(bin[1], frame);
      const r = this.resolveRhsValue(bin[3], frame);
      const op = bin[2];
      const ln = parseFloat(l); const rn = parseFloat(r);
      let res = 0;
      if (op === "+") res = ln + rn;
      else if (op === "-") res = ln - rn;
      else if (op === "*") res = ln * rn;
      else if (op === "/") res = rn !== 0 ? ln / rn : 0;
      return { value: String(Number.isInteger(res) ? res : res.toFixed(2)) };
    }
    return { value: expr };
  }

  private findVarByAddress(addr: string): Variable | undefined {
    for (const f of this.callStack) for (const v of f.variables) if (v.address === addr) return v;
    return undefined;
  }

  private splitArgs(str: string): string[] {
    const res: string[] = [];
    let cur = "";
    let depth = 0;
    let inStr = false;
    let strChar = "";
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (!inStr && (ch === '"' || ch === "'")) { inStr = true; strChar = ch; cur += ch; }
      else if (inStr && ch === strChar) { inStr = false; cur += ch; }
      else if (!inStr && ch === "{") { depth++; cur += ch; }
      else if (!inStr && ch === "}") { depth--; cur += ch; }
      else if (!inStr && ch === "(") { depth++; cur += ch; }
      else if (!inStr && ch === ")") { depth--; cur += ch; }
      else if (!inStr && depth === 0 && ch === ",") { res.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    if (cur.trim().length > 0) res.push(cur.trim());
    return res.filter(s => s.length > 0);
  }
}
