export interface Variable {
  name: string;
  type: string;
  value: string;
  address: string;
  isPointer: boolean;
  isReference: boolean;
  pointsTo: string | null; // address target
  isNull?: boolean;
  rawValue?: string;
}

export interface StackFrame {
  id: string;
  functionName: string;
  variables: Variable[];
  returnLine?: number;
  pc?: number;
}

export interface HeapField {
  name: string;
  type: string;
  value: string;
  kind: "primitive" | "pointer";
  targetObjectId?: string | null; // address of target heap object if pointer
}

export interface HeapObject {
  address: string;
  typeName: string;
  fields: HeapField[];
  isFreed: boolean;
  allocatedAtLine: number;
  sizeBytes: number;
  rawValue?: string;
}

export interface TimelineEvent {
  step: number;
  line: number;
  description: string;
  kind: "allocate" | "assign" | "pointer" | "heap" | "call" | "ret" | "delete" | "reference" | "struct";
  timestamp: string;
}

export interface PointerInfo {
  from: string; // variable address
  fromName: string;
  fromFrame: string;
  to: string; // target address
  type: "pointer" | "reference";
}

export interface EngineSnapshot {
  currentLine: number; // 1-indexed line in source
  stack: StackFrame[];
  heap: HeapObject[];
  timeline: TimelineEvent[];
  currentStep: number;
  totalSteps: number;
  status: "idle" | "running" | "finished" | "error";
  errorMessage?: string;
  sourceLines: string[];
  historyLength: number;
  pointers?: PointerInfo[];
}

export interface ExecutionSnapshot {
  id: string;
  lineNumber: number;
  event: string;
  stack: StackFrame[];
  heap: HeapObject[];
  pointers: PointerInfo[];
  timestamp: string;
  status: EngineSnapshot["status"];
  sourceLines: string[];
}
