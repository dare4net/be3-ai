const BaseAgent = require('../BaseAgent');
const { getToolsForAgent } = require('../registry');

/**
 * Discovery Agent
 * Handles browsing, category exploration
 * Tools: discovery.*, category.list, category.getSubcategories
 * Prompt: Minimal personality, exploration-focused
 */
class DiscoveryAgent extends BaseAgent {
    constructor() {
        const tools = getToolsForAgent('Discovery');
        super('Discovery', tools, DiscoveryAgent.buildPrompt);
    }

    static buildPrompt(toolResults, context) {
        return `You are the Discovery Agent for Be3 store.

ROLE: Help users explore and discover products.

RULES:
1. Use ONLY data from TOOL RESULTS
2. Minimal personality (friendly but concise)
3. Guide users through categories
4. Suggest browsing options

OUTPUT: Category lists and exploration guidance.`;
    }
}

module.exports = DiscoveryAgent;
