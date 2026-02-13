const { queryAI } = require('../core/aiService');
const taskManager = require('../state/taskManager');

// System prompt for the Planner
const PLANNER_PROMPT = `You are the Task Planner for an e-commerce AI assistant.
Your ONLY job is to break a complex shopping list into individual SEARCH steps.

CRITICAL RULES:
1. Each step = ONE search. "Search for [item]" is the ONLY step type you generate.
2. DO NOT generate "add to cart" steps. The user will decide what to add after seeing results.
3. DO NOT generate "ensure suggestions" or "discovery" steps. Those run automatically.
4. Maintain the user's original order.
5. If the user specifies a quantity (e.g. "3 phones"), include it in the instruction.
6. If the user specifies a vendor (e.g. "from Taye's"), include the vendor name.
7. Each step MUST include a "completion_event" — the tool that signals this step is done.
8. Output ONLY a JSON array. No commentary, no explanation.

COMPLETION EVENTS:
- "cart.add" — Step is done when user adds item(s) to cart (most common for search steps)
- "cart.remove" — Step is done when item is removed
- "none" — Step is done immediately after showing results (informational only)

EXAMPLE:
User: "I need 3 phones, a gaming chair, bread, and a Rattan product from Taye's"
Output:
[
  { "instruction": "Search for phones", "quantity": 3, "completion_event": "cart.add" },
  { "instruction": "Search for gaming chairs", "quantity": 1, "completion_event": "cart.add" },
  { "instruction": "Search for bread", "quantity": 1, "completion_event": "cart.add" },
  { "instruction": "Search for Rattan products from Taye's", "quantity": 1, "vendor": "Taye's", "completion_event": "cart.add" }
]
`;

const taskTools = {
    'task.plan': {
        description: 'Break down a complex request into a list of actionable steps.',
        params: {
            objective: { type: 'string', description: 'The full complex user request' },
            context_summary: { type: 'string', description: 'Current store/user context' }
        },
        handler: async (params, context) => {
            const { objective, context_summary } = params;
            const { sessionId } = context;

            if (!objective) return { error: "Objective required" };

            // 1. Generate Plan via AI
            const messages = [
                { role: "system", content: PLANNER_PROMPT },
                { role: "user", content: `Context: ${context_summary || 'None'}\n\nRequest: "${objective}"` }
            ];

            const response = await queryAI(messages, 512, 0.2); // Low temp for deterministic plans
            let steps = [];

            try {
                // Extract JSON array more robustly
                const jsonMatch = response.match(/\[\s*\{.*\}\s*\]/s);
                if (jsonMatch) {
                    steps = JSON.parse(jsonMatch[0]);
                } else {
                    // Fallback to searching for the first [ and last ]
                    const startPos = response.indexOf('[');
                    const endPos = response.lastIndexOf(']');
                    if (startPos !== -1 && endPos !== -1) {
                        steps = JSON.parse(response.substring(startPos, endPos + 1));
                    } else {
                        return { error: "Failed to generate valid plan structure." };
                    }
                }
            } catch (e) {
                console.error(`[TaskTool] Plan parsing failed: ${e.message}`);
                console.error(`[TaskTool] Raw response was: ${response}`);
                return { error: "Plan generation failed." };
            }

            if (steps.length === 0) return { message: "No steps needed." };

            // Normalize steps: ensure completion_event exists
            steps = steps.map(s => ({
                ...s,
                completion_event: s.completion_event || 'cart.add', // Default: step done when item added
                quantity: s.quantity || 1
            }));

            // 2. Create Task in State Manager
            const task = await taskManager.createTask(sessionId, objective, steps);

            // Build user-friendly summary
            const planSummary = steps.map((s, i) =>
                `${i + 1}. ${s.instruction}${s.quantity > 1 ? ` (×${s.quantity})` : ''}${s.vendor ? ` from ${s.vendor}` : ''}`
            ).join('\n');

            return {
                success: true,
                plan_type: 'shopping_list',
                total_steps: steps.length,
                plan_summary: planSummary,
                message: `I've created a plan with ${steps.length} items to find for you! Here's what I'll search for:\n\n${planSummary}\n\nSay "let's go" or "start" when you're ready and I'll begin with the first one!`,
                task_summary: task
            };
        }
    },

    'task.execute_next': {
        description: 'Execute the next pending step in the active task.',
        params: {}, // Uses session ID to find task
        handler: async (params, context) => {
            const { sessionId } = context;
            const task = await taskManager.getTask(sessionId);

            // Lazy load to break circular dependency
            const { selectTools } = require('../core/toolSelector');
            const { executeTools } = require('../core/orchestrator');

            if (!task || task.status !== 'active') {
                return { message: "No active task found." };
            }

            // LIFECYCLE: If a step is currently "awaiting_user", mark it completed first.
            const awaitingStep = task.steps.find(s => s.status === 'awaiting_user');
            if (awaitingStep) {
                const awaitingIndex = task.steps.indexOf(awaitingStep);
                console.log(`[TaskTool] Completing awaiting step ${awaitingIndex + 1}: "${awaitingStep.instruction}"`);
                await taskManager.updateStep(sessionId, awaitingIndex, 'completed', null, 'User moved to next step');
            }

            // Find next pending step
            const updatedTask = await taskManager.getTask(sessionId);
            const currentStep = updatedTask.steps.find(s => s.status === 'pending');
            const stepIndex = updatedTask.steps.indexOf(currentStep);

            if (!currentStep) {
                await taskManager.updateStatus(sessionId, 'completed');
                return { message: "🎉 All done! Your entire shopping list has been handled!", task_complete: true };
            }

            const completedCount = updatedTask.steps.filter(s => s.status === 'completed').length;
            const totalSteps = updatedTask.steps.length;
            console.log(`[TaskTool] Executing Step ${stepIndex + 1}/${totalSteps}: "${currentStep.instruction}"`);

            // 1. Resolve Tool Call — keep the message lean for the tool selector
            const augmentedMessage = currentStep.instruction;
            const conversationHistory = [{ role: 'system', text: `Shopping list task: ${updatedTask.originalRequest}` }];
            const toolsSelected = await selectTools(augmentedMessage, conversationHistory);

            if (!toolsSelected || toolsSelected.length === 0) {
                await taskManager.updateStep(sessionId, stepIndex, 'failed', { error: "No tool selected" });
                return { error: `Could not determine how to execute step: "${currentStep.instruction}"` };
            }

            // 2. Execute the Tools
            const results = await executeTools(toolsSelected, sessionId);

            // 3. Mark step as AWAITING_USER (not completed!) — user needs to interact with results
            const hasFailed = results.some(r => !r.success);

            // Build a COMPACT context summary — avoid bloating accumulatedContext
            const compactSummary = results.map(r => {
                if (r.result?.products || r.result?.results) {
                    const products = r.result.products || r.result.results;
                    const items = products.slice(0, 5).map(p => `${p.name || p.title} (${p.price})`).join(', ');
                    return `Found: ${items}`;
                }
                return r.tool || 'done';
            }).join('; ');

            await taskManager.updateStep(sessionId, stepIndex, hasFailed ? 'failed' : 'awaiting_user', results, compactSummary);

            // 4. Build remaining steps info
            const remainingSteps = updatedTask.steps.filter(s => s.status === 'pending' && s !== currentStep);
            const nextStepPreview = remainingSteps.length > 0 ? remainingSteps[0].instruction : null;

            return {
                success: true,
                step_executed: currentStep.instruction,
                step_number: stepIndex + 1,
                total_steps: totalSteps,
                tools_run: toolsSelected.map(t => t.tool),
                results: results,
                remaining_steps: remainingSteps.length,
                next_step_preview: nextStepPreview,
                user_prompt: remainingSteps.length > 0
                    ? `When you're done with this, say "next" and I'll move on to: ${nextStepPreview}`
                    : `This is the last item on your list!`
            };
        }
    },

    'task.manage': {
        description: 'Pause, resume, or cancel the current task.',
        params: {
            action: { type: 'string', description: 'pause, resume, cancel, status' }
        },
        handler: async (params, context) => {
            const { sessionId } = context;
            const { action } = params;

            if (action === 'status') {
                const task = await taskManager.getTask(sessionId);
                if (!task) return { message: "No active task." };
                return { task_status: task.status, current_step: task.currentStepIndex + 1, total_steps: task.steps.length };
            }

            if (action === 'cancel') {
                await taskManager.clearTask(sessionId);
                return { success: true, message: "Task cancelled." };
            }

            if (['pause', 'resume'].includes(action)) {
                // Map 'resume' to 'active'
                const status = action === 'resume' ? 'active' : 'paused';
                await taskManager.updateStatus(sessionId, status);
                return { success: true, message: `Task ${status}.` };
            }

            return { error: "Invalid action." };
        }
    }
};

module.exports = taskTools;
