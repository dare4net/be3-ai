/**
 * Task Router — AI-powered intent classifier for Task Mode
 * 
 * Replaces hardcoded isResumeRequest() with intelligent routing.
 * Every message during an active task goes through this classifier
 * to determine user intent relative to the current step.
 */

const { queryAI } = require('../core/aiService');

const CLASSIFIER_PROMPT = `You classify user messages during a multi-step shopping task.

CURRENT STEP: "{current_step}" 
STEP STATUS: {step_status}

Reply with EXACTLY ONE word:

interact — User is acting on the current step's results:
  - Adding items to cart: "add all", "add the first 3", "I'll take those", "all of them", "buy it"
  - Asking about products: "tell me more", "how much is the Samsung", "details"
  - Selecting items: "the first one", "the cheap one", "both"
  - ANY message referencing products, prices, quantities, or cart

advance — User is DONE with this step and wants the NEXT item on their list:
  - "next", "move on", "continue", "next item", "what's next on the list"
  - "done", "I'm good", "that's enough"
  - When step_status is "pending": "yes", "ok", "start", "let's go", "sure"
  
skip — User wants to skip: "skip", "skip this", "I don't need that", "pass"

cancel — User wants to abort: "cancel", "stop", "never mind", "forget it"

status — User wants progress: "how many left", "what's my list", "where are we"

CRITICAL RULES:
- "add" + anything = interact (NEVER advance)
- "all of them", "all", "both" during awaiting_user = interact  
- If ambiguous, pick interact (it's safer)
- Only pick advance if user clearly has NO remaining action on current results`;

/**
 * Classify user message intent during an active task
 * @param {string} userMessage - The user's raw message
 * @param {Object} activeTask - The full task object from taskManager
 * @returns {Promise<string>} One of: interact, advance, skip, cancel, status
 */
async function classifyTaskIntent(userMessage, activeTask) {
    if (!activeTask || activeTask.status !== 'active') return 'interact';

    // Find the current step the user is on
    const awaitingStep = activeTask.steps.find(s => s.status === 'awaiting_user');
    const pendingStep = activeTask.steps.find(s => s.status === 'pending');
    const currentStep = awaitingStep || pendingStep;

    if (!currentStep) return 'advance'; // All done, just advance to completion

    const stepStatus = awaitingStep ? 'awaiting_user' : 'pending';

    const prompt = CLASSIFIER_PROMPT
        .replace('{current_step}', currentStep.instruction)
        .replace('{step_status}', stepStatus);

    const messages = [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage }
    ];

    try {
        const response = await queryAI(messages, 10, 0.1); // Ultra-fast: 10 tokens, low temp
        const intent = response.trim().toLowerCase().replace(/[^a-z]/g, '');

        const validIntents = ['interact', 'advance', 'skip', 'cancel', 'status'];
        if (validIntents.includes(intent)) {
            console.log(`[TaskRouter] "${userMessage}" → ${intent} (step: "${currentStep.instruction}", status: ${stepStatus})`);
            return intent;
        }

        console.warn(`[TaskRouter] Invalid intent "${intent}", defaulting to "interact"`);
        return 'interact';
    } catch (error) {
        console.error(`[TaskRouter] Classification failed: ${error.message}, defaulting to "interact"`);
        return 'interact';
    }
}

module.exports = { classifyTaskIntent };
