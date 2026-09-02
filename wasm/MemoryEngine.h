#pragma once
#include <string>
#include <vector>
#include <map>
#include <memory>

struct VariableSnapshot {
    std::string name;
    std::string type;
    std::string value;
    std::string address;
    bool isPointer = false;
    bool isReference = false;
    std::string pointsTo; // address it points to, empty if null
    bool isNull = false;
};

struct StackFrameSnapshot {
    std::string functionName;
    std::vector<VariableSnapshot> variables;
    int returnLine = -1;
};

struct HeapField {
    std::string name;
    std::string type;
    std::string value;
};

struct HeapObjectSnapshot {
    std::string address;
    std::string typeName;
    std::vector<HeapField> fields;
    bool isFreed = false;
    int allocatedAtLine = 0;
    size_t sizeBytes = 0;
};

struct TimelineEventSnapshot {
    int step;
    int line;
    std::string description;
    std::string kind; // allocate, assign, pointer, heap, call, ret, delete
    std::string timestamp;
};

struct EngineStateSnapshot {
    int currentLine = 0;
    std::vector<StackFrameSnapshot> stack;
    std::vector<HeapObjectSnapshot> heap;
    std::vector<TimelineEventSnapshot> timeline;
    int currentStep = 0;
    int totalSteps = 0;
    std::string status; // idle, running, finished, error
    std::string errorMessage;
    std::vector<std::string> sourceLines;
};

// Core engine - source of truth for memory model
class MemoryEngine {
public:
    MemoryEngine();
    void loadProgram(const std::string& source);
    bool step();
    void reset();
    std::string getState() const; // JSON serialization
    EngineStateSnapshot getSnapshot() const;

private:
    struct StructDef {
        std::string name;
        std::vector<std::pair<std::string,std::string>> fields; // type, name
    };
    struct FuncDef {
        std::string returnType;
        std::string name;
        std::vector<std::pair<std::string,std::string>> params; // type, name
        std::vector<std::string> bodyLines;
        std::vector<int> bodyLineNumbers;
    };
    struct CallFrame {
        std::string functionName;
        size_t pc = 0;
        std::vector<VariableSnapshot> vars;
        std::string awaitingReturnVar; // variable in caller awaiting return value
        std::string awaitingReturnType;
    };

    std::string sourceText;
    std::vector<std::string> sourceLines;
    std::map<std::string, StructDef> structs;
    std::map<std::string, FuncDef> functions;

    std::vector<CallFrame> callStack;
    std::vector<HeapObjectSnapshot> heapObjects;
    std::vector<TimelineEventSnapshot> timelineEvents;
    std::vector<EngineStateSnapshot> history;

    uint32_t nextStackAddr = 0x7ffd1000;
    uint32_t nextHeapAddr = 0x1000;
    size_t globalPc = 0;
    int currentLineNumber = 0;
    int stepCount = 0;
    std::string status = "idle";
    std::string errorMsg;

    void parse();
    bool executeCurrentLine();
    std::string allocStackAddress(size_t size = 4);
    std::string allocHeapAddress(size_t size = 16);
    VariableSnapshot* findVariable(const std::string& name);
    HeapObjectSnapshot* findHeapObject(const std::string& addr);
    std::string evaluateExpression(const std::string& expr, std::string& outType);
    void pushTimeline(const std::string& desc, const std::string& kind, int line);
};
