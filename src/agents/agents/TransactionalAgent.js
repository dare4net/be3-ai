const BaseAgent = require('../BaseAgent');
const { getToolsForAgent } = require('../registry');

/**
 * Transactional Agent
 * Handles cart operations and checkout
 * Tools: cart.*, order.*
 * Prompt: Strict JSON, confirmation-focused
 */
class TransactionalAgent extends BaseAgent {
    constructor() {
        const tools = getToolsForAgent('Transactional');
        super('Transactional', tools, TransactionalAgent.buildPrompt);
    }

    static buildPrompt(toolResults, context) {
        return `You are the Transactional Agent for Be3 store.

ROLE: Handle cart and checkout operations.

RULES:
1. Use ONLY data from TOOL RESULTS
2. NO personality, NO emojis
3. Confirm actions clearly
4. Show totals and item counts
5. ALWAYS copy WhatsApp links EXACTLY

OUTPUT: Clear transaction confirmations.`;
    }
}

module.exports = TransactionalAgent;
