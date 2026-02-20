---
name: STACK System Implementation
overview: Build STACK (Statement/Intent Stack) system to ensure intents execute sequentially, one at a time, with all their activities (tool mapping, tool execution via orchestrator, microstates) completing before the next intent runs. STACK works with orchestrator to accumulate results naturally.
todos:
  - id: stack_module
    content: Create src/services/intentResolver/pipeline/stack.js with executeIntentStack, resumeIntentStack functions
    status: pending
  - id: state_manager_stack
    content: "Add stack persistence methods to stateManager: setStack, getStack, clearStack"
    status: pending
  - id: insert_stack
    content: Insert STACK after intent resolution (before tool mapping) to manage intent execution order
    status: pending
  - id: microstate_resume
    content: Modify microstateRunner to check for stack and resume next intent after fulfillment
    status: pending
  - id: ordinal_reresolve
    content: Re-resolve ordinals for remaining intents after each intent completes (using updated reference_map)
    status: pending
  - id: stage0_stack
    content: Modify Stage 0 to handle stack resumption when microstate is active
    status: pending
  - id: test_scenarios
    content: "Test: same-turn ordinal resolution, microstate resumption, multi-intent sequential execution"
    status: pending
isProject: false
---

# STACK System Implementation Plan

## Problem Summary

1. **Microstate blocks multi-intent**: When a microstate opens, pipeline returns early, preventing remaining intents from processing
2. **Same-turn ordinal resolution fails**: "search smartphones and add the first two" - "first two" can't resolve because `reference_map` is empty during intent resolution (tools haven't run yet)
3. **Can't refine search while executing other tasks**: Microstate opens → early return → other intents don't execute

## Architecture Overview

STACK manages **intents sequentially**, not tools. The orchestrator already handles tool execution. STACK ensures:

1. **One intent executes at a time** - Intent 1 fully completes (tool mapping → orchestrator → microstates → all resolve) before Intent 2 starts
2. **Microstates spawn sequentially** within an intent's lifecycle (e.g., refine search multiple times)
3. **Reference map updates naturally** as tools execute via orchestrator
4. **Results accumulate** through orchestrator (already happens)
5. **Final result looks unified** - as if everything executed at once

## Insertion Point

**Location**: `src/services/intentResolver/index.js` after intent resolution completes (after Stage 6.5 normalization, before Stage 8b tool mapping)

**Why here:**

- ✅ All intents resolved and normalized
- ✅ Can manage intent execution order before tool mapping
- ✅ Can re-resolve ordinals after each intent completes
- ✅ Can intercept microstate opening and preserve remaining intents
- ✅ Not too early (has all resolved intents)
- ✅ Not too late (before tools are mapped and executed)

## STACK Flow

```
[Stage 6.5] Intent Normalization Complete
    ↓
[STACK] Initialize Intent Queue
    ├─ Create queue: [intent1, intent2, intent3]
    ├─ Store in state.stack
    └─ Start with intent1
    ↓
[STACK] Execute Intent 1
    ├─ Map intent1 → tools (Stage 8b)
    ├─ Orchestrator executes tools sequentially
    │   ├─ Tool 1 runs → updates reference_map
    │   ├─ Tool 2 runs → updates reference_map
    │   └─ Results accumulate in orchestrator
    ├─ Check for microstate triggers (Stage 10)
    ├─ If microstate opens:
    │   ├─ Preserve remaining intents in state.stack
    │   └─ RETURN with microstate_opened flag
    └─ If no microstate (or all resolved):
        ├─ Intent 1 complete
        ├─ Re-resolve ordinals for remaining intents (using updated reference_map)
        └─ Continue to Intent 2
    ↓
[STACK] Resume (when microstate resolves)
    ├─ Retrieve preserved stack from state
    ├─ Current intent's microstate resolved → intent complete
    ├─ Re-resolve ordinals for remaining intents
    └─ Continue with next intent
    ↓
[STACK] Execute Intent 2
    ├─ Map intent2 → tools (with re-resolved ordinals)
    ├─ Orchestrator executes tools
    └─ Continue until all intents complete
    ↓
[STACK] Complete
    ├─ All intents executed
    ├─ Clear state.stack
    └─ Return unified results (from orchestrator)
```

## Implementation Details

### 1. STACK Module (`src/services/intentResolver/pipeline/stack.js`)

**Core Functions:**

- `executeIntentStack(intents, state, storeContext, sessionId)` - Executes intents sequentially
- `resumeIntentStack(userId, state, storeContext, sessionId)` - Resumes after microstate resolves
- `reResolveOrdinalsForRemainingIntents(remainingIntents, state, storeContext)` - Re-resolves ordinals using updated reference_map

**State Structure:**

```javascript
state.stack = {
    remaining_intents: [...],        // Intents not yet executed
    current_intent_index: 0,         // Current intent being executed
    executed_intents: [...],        // Intents already completed (for reference)
    accumulated_results: [...],      // Tool results accumulated so far
    created_at: timestamp,
    expires_at: timestamp
}
```

### 2. Intent Execution Flow

**For each intent:**

1. **Map to tools** (Stage 8b) - `toolMapper.mapToTools([intent])`
2. **Execute via orchestrator** - `orchestrator.executeTools(tools, sessionId)`
  - Orchestrator runs tools sequentially
  - Tools update `reference_map` as they execute
  - Results accumulate in orchestrator's results array
3. **Check microstate triggers** (Stage 10) - `microstateRegistry.checkTriggers()`
4. **If microstate opens:**
  - Preserve remaining intents in `state.stack`
  - Open microstate
  - Return with `microstate_opened: true`
5. **If no microstate (or all resolved):**
  - Intent complete
  - Re-resolve ordinals for remaining intents
  - Continue to next intent

### 3. Ordinal Resolution Fix

**Problem**: "first two" can't resolve because tools haven't run yet

**Solution**: 

- After Intent 1 (product_search) completes → `reference_map` and `search_context.product_ids` populated
- Before executing Intent 2 (add_to_cart), re-run Stage 8a ordinal resolution on Intent 2's parameters
- This allows "first two" to resolve using fresh search results

**Implementation**:

- Extract Stage 8a ordinal resolution logic into `reResolveOrdinals(intent, state, storeContext)`
- Call it after each intent completes, before executing next intent
- Updates intent parameters with resolved ordinals

### 4. Modified Stage 0 (Active Microstate Check)

**Current**: If microstate active, process message and return early

**New**: 

- If microstate active AND `state.stack` exists → microstate is resuming a stack
- Process message through microstate
- If fulfilled → resume stack (execute next intent) instead of returning
- If reprompt → return normally (user needs to clarify)

### 5. Modified Stage 10 (Microstate Triggers)

**Current**: Checks triggers, opens microstate, returns early

**New**:

- Check triggers as before
- If triggered AND `state.stack` exists:
  - Open microstate
  - Preserve remaining intents in stack
  - Return with `microstate_opened: true`
- If triggered AND no stack:
  - Open microstate
  - Return normally (single intent scenario)

### 6. Integration with Orchestrator

**STACK works WITH orchestrator, not replaces it:**

- STACK calls `orchestrator.executeTools()` for each intent's tools
- Orchestrator executes tools sequentially and accumulates results
- STACK collects orchestrator results and continues to next intent
- Final result combines all orchestrator results

## Files to Modify

1. `**src/services/intentResolver/index.js`**
  - Insert STACK after Stage 6.5 (after line ~360, before Stage 8b)
  - Modify Stage 10 to preserve stack when microstate opens
  - Modify Stage 0 to resume stack when microstate resolves
2. `**src/services/intentResolver/pipeline/stack.js`** (NEW)
  - Core STACK implementation
  - Intent execution orchestration
  - Microstate deferral logic
  - Stack resumption logic
  - Ordinal re-resolution logic
3. `**src/services/intentResolver/pipeline/microstateRunner.js**`
  - After fulfillment, check for `state.stack`
  - If exists, call `stack.resumeIntentStack()` instead of returning
  - Resume executes next intent in queue
4. `**src/state/stateManager.js**`
  - Add `setStack(userId, stackObj)` method
  - Add `getStack(userId)` method
  - Add `clearStack(userId)` method
  - Stack TTL: 5 minutes (same as microstate)
5. `**src/services/intentResolver/index.js**` (Stage 8a)
  - Extract ordinal resolution logic into `reResolveOrdinals(intent, state, storeContext)`
  - Call it during stack execution with updated search_context
6. `**src/core/server.js**`
  - After `resolveDeterministic()` returns, check if `microstate_opened: true`
  - If true, don't execute tools yet (microstate will handle it)
  - If false and stack exists, continue normal flow

## Edge Cases

1. **Microstate breakthrough**: User says "cancel" → clear stack, return normally
2. **Stack expiration**: If stack expires, clear it and return error
3. **Multiple microstates per intent**: Microstates spawn sequentially within intent lifecycle
4. **Tool failures**: Non-critical failures continue stack, critical failures stop stack
5. **Empty stack**: If all intents executed, clear stack and return normally
6. **Single intent**: If only one intent, execute normally (no stack needed)

## Testing Scenarios

1. **"search smartphones and add the first two to cart"**
  - Intent 1: product_search → orchestrator executes → populates reference_map
  - Re-resolve "first two" using search_context.product_ids
  - Intent 2: add_to_cart → orchestrator executes with resolved products
  - Unified result returned
2. **"search phones, refine search multiple times, and add cheapest to cart"**
  - Intent 1: product_search → executes
  - Microstate opens (refine) → preserve Intent 2
  - User refines → microstate resolves → resume Intent 1
  - Microstate opens again (refine more) → preserve Intent 2
  - User refines → microstate resolves → Intent 1 complete
  - Intent 2: add_to_cart → executes
3. **"add first one to cart" (with active microstate from previous stack)**
  - Stage 0: Microstate active → process message
  - If fulfilled → check for stack → resume next intent if exists

## Migration Strategy

1. **Phase 1**: Implement STACK module, insert after Stage 6.5
2. **Phase 2**: Modify Stage 10 to preserve stack when microstate opens
3. **Phase 3**: Modify microstateRunner to resume stack after fulfillment
4. **Phase 4**: Add ordinal re-resolution after each intent completes
5. **Phase 5**: Update Stage 0 to handle stack resumption
6. **Phase 6**: Update server.js to handle stack flow

## Success Criteria

- ✅ Multi-intent queries execute all intents sequentially even if microstate opens
- ✅ "first two" resolves in same-turn multi-intent using search results
- ✅ Search refinement microstates work (can refine multiple times) while preserving remaining intents
- ✅ Microstate resumption continues with next intent in queue
- ✅ Results accumulate naturally through orchestrator
- ✅ Final result looks unified (as if everything executed at once)
- ✅ No duplicate intent execution
- ✅ No broken intent dependencies

