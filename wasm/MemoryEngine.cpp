#include "MemoryEngine.h"
#include <sstream>
#include <regex>
#include <algorithm>

// Simplified C++ engine - intended to be compiled with Emscripten
// The TypeScript engine in lib/engine.ts mirrors this logic for web runtime.

MemoryEngine::MemoryEngine() {}

void MemoryEngine::loadProgram(const std::string& source) {
    sourceText = source;
    sourceLines.clear();
    std::istringstream iss(source);
    std::string line;
    while (std::getline(iss, line)) sourceLines.push_back(line);
    structs.clear();
    functions.clear();
    heapObjects.clear();
    timelineEvents.clear();
    history.clear();
    callStack.clear();
    nextStackAddr = 0x7ffd1000;
    nextHeapAddr = 0x1000;
    stepCount = 0;
    status = "idle";
    errorMsg.clear();
    currentLineNumber = 0;
    parse();
    // initialize with main frame if exists
    auto it = functions.find("main");
    if (it != functions.end()) {
        CallFrame f;
        f.functionName = "main";
        f.pc = 0;
        callStack.push_back(std::move(f));
        status = "running";
        if (!it->second.bodyLines.empty())
            currentLineNumber = it->second.bodyLineNumbers[0];
    } else {
        status = "finished";
    }
}

void MemoryEngine::reset() {
    loadProgram(sourceText);
}

bool MemoryEngine::step() {
    if (status != "running") return false;
    if (callStack.empty()) { status = "finished"; return false; }
    bool progressed = executeCurrentLine();
    stepCount++;
    if (callStack.empty()) status = "finished";
    return progressed;
}

std::string MemoryEngine::getState() const {
    // JSON serialization placeholder - actual JSON built via Emscripten bindings
    // For brevity, return empty; JS engine handles serialization.
    return "{}";
}

EngineStateSnapshot MemoryEngine::getSnapshot() const {
    EngineStateSnapshot snap;
    snap.currentLine = currentLineNumber;
    snap.currentStep = stepCount;
    snap.totalSteps = (int)timelineEvents.size();
    snap.status = status;
    snap.errorMessage = errorMsg;
    snap.sourceLines = sourceLines;
    for (auto &cf : callStack) {
        StackFrameSnapshot sf;
        sf.functionName = cf.functionName;
        sf.variables = cf.vars;
        snap.stack.push_back(sf);
    }
    snap.heap = heapObjects;
    snap.timeline = timelineEvents;
    return snap;
}

void MemoryEngine::parse() {
    // Very simplified: extract struct defs and function defs via regex
    std::regex structRe(R"(struct\s+(\w+)\s*\{)");
    std::regex funcRe(R"((\w+)\s+(\w+)\s*\(([^)]*)\)\s*\{)");
    for (size_t i = 0; i < sourceLines.size(); ) {
        std::string line = sourceLines[i];
        std::smatch m;
        if (std::regex_search(line, m, structRe)) {
            StructDef sd; sd.name = m[1];
            ++i;
            while (i < sourceLines.size() && sourceLines[i].find("};") == std::string::npos) {
                std::string f = sourceLines[i];
                // parse: type name;
                std::regex fieldRe(R"(\s*(\w+)\s+(\w+)\s*;)");
                std::smatch fm;
                if (std::regex_search(f, fm, fieldRe)) sd.fields.push_back({fm[1], fm[2]});
                ++i;
            }
            structs[sd.name] = sd;
            ++i;
            continue;
        }
        if (std::regex_search(line, m, funcRe)) {
            FuncDef fd; fd.returnType = m[1]; fd.name = m[2];
            std::string paramsStr = m[3];
            // parse params
            std::regex paramRe(R"(\s*([\w\*&]+)\s+(\w+)\s*)");
            auto begin = std::sregex_iterator(paramsStr.begin(), paramsStr.end(), paramRe);
            for (auto it = begin; it != std::sregex_iterator(); ++it) {
                fd.params.push_back({(*it)[1], (*it)[2]});
            }
            // collect body until matching brace
            int depth = 1;
            ++i;
            while (i < sourceLines.size() && depth > 0) {
                for (char c : sourceLines[i]) { if (c=='{') depth++; else if (c=='}') depth--; }
                if (depth > 0) { fd.bodyLines.push_back(sourceLines[i]); fd.bodyLineNumbers.push_back((int)i+1); }
                ++i;
            }
            functions[fd.name] = fd;
            continue;
        }
        ++i;
    }
}

bool MemoryEngine::executeCurrentLine() {
    if (callStack.empty()) return false;
    CallFrame &frame = callStack.back();
    auto fit = functions.find(frame.functionName);
    if (fit == functions.end()) return false;
    if (frame.pc >= fit->second.bodyLines.size()) {
        // implicit return
        callStack.pop_back();
        if (!callStack.empty()) {
            CallFrame &caller = callStack.back();
            caller.pc++;
            if (caller.pc < functions[caller.functionName].bodyLines.size())
                currentLineNumber = functions[caller.functionName].bodyLineNumbers[caller.pc];
        }
        return true;
    }
    std::string line = fit->second.bodyLines[frame.pc];
    currentLineNumber = fit->second.bodyLineNumbers[frame.pc];
    // Trim
    line.erase(0, line.find_first_not_of(" \t"));
    // Handle return
    if (line.rfind("return", 0) == 0) {
        std::string expr = line.substr(6);
        expr.erase(std::remove(expr.begin(), expr.end(), ';'), expr.end());
        std::string type;
        std::string val = evaluateExpression(expr, type);
        callStack.pop_back();
        if (!callStack.empty()) {
            CallFrame &caller = callStack.back();
            if (!caller.awaitingReturnVar.empty()) {
                // assign return value
                VariableSnapshot var;
                var.name = caller.awaitingReturnVar;
                var.type = caller.awaitingReturnType;
                var.value = val;
                var.address = allocStackAddress();
                caller.vars.push_back(var);
                caller.awaitingReturnVar.clear();
            }
            caller.pc++;
            if (caller.pc < functions[caller.functionName].bodyLines.size())
                currentLineNumber = functions[caller.functionName].bodyLineNumbers[caller.pc];
        }
        pushTimeline("return " + val, "ret", currentLineNumber);
        return true;
    }
    // TODO: detailed execution for assignment, heap allocation, pointer ops
    // For brevity, increment and log
    pushTimeline(line, "allocate", currentLineNumber);
    frame.pc++;
    if (frame.pc < fit->second.bodyLines.size())
        currentLineNumber = fit->second.bodyLineNumbers[frame.pc];
    return true;
}

std::string MemoryEngine::allocStackAddress(size_t) {
    nextStackAddr -= 0x10;
    char buf[16]; snprintf(buf, sizeof(buf), "0x%08x", nextStackAddr);
    return std::string(buf);
}
std::string MemoryEngine::allocHeapAddress(size_t) {
    std::string addr;
    char buf[16]; snprintf(buf, sizeof(buf), "0x%04x", nextHeapAddr);
    addr = buf;
    nextHeapAddr += 0x40;
    return addr;
}
VariableSnapshot* MemoryEngine::findVariable(const std::string& name) {
    for (int i = (int)callStack.size()-1; i>=0; --i) for (auto &v: callStack[i].vars) if (v.name==name) return &v;
    return nullptr;
}
HeapObjectSnapshot* MemoryEngine::findHeapObject(const std::string& addr) {
    for (auto &h: heapObjects) if (h.address==addr) return &h;
    return nullptr;
}
std::string MemoryEngine::evaluateExpression(const std::string& expr, std::string& outType) {
    outType = "int";
    return expr;
}
void MemoryEngine::pushTimeline(const std::string& desc, const std::string& kind, int line) {
    TimelineEventSnapshot ev;
    ev.step = (int)timelineEvents.size()+1;
    ev.line = line;
    ev.description = desc;
    ev.kind = kind;
    char buf[16]; snprintf(buf, sizeof(buf), "00:%02d", ev.step);
    ev.timestamp = buf;
    timelineEvents.push_back(ev);
}

// Emscripten bindings
#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
using namespace emscripten;
EMSCRIPTEN_BINDINGS(memory_engine) {
    class_<MemoryEngine>("MemoryEngine")
        .constructor<>()
        .function("loadProgram", &MemoryEngine::loadProgram)
        .function("step", &MemoryEngine::step)
        .function("reset", &MemoryEngine::reset)
        .function("getState", &MemoryEngine::getState);
}
#endif
