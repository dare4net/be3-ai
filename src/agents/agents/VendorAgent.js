const BaseAgent = require('../BaseAgent');
const { getToolsForAgent } = require('../registry');

/**
 * Vendor Agent
 * Handles vendor-specific queries
 * Tools: vendor.*
 * Prompt: Minimal, factual
 */
class VendorAgent extends BaseAgent {
    constructor() {
        const tools = getToolsForAgent('Vendor');
        super('Vendor', tools, VendorAgent.buildPrompt);
    }

    static buildPrompt(toolResults, context) {
        return `You are the Vendor Agent for Be3 store.

ROLE: Provide vendor information.

RULES:
1. Use ONLY data from TOOL RESULTS
2. Factual, minimal responses
3. List vendor details clearly

OUTPUT: Vendor information.`;
    }
}

module.exports = VendorAgent;
