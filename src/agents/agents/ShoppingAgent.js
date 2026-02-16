const BaseAgent = require('../BaseAgent');
const { getToolsForAgent } = require('../registry');

/**
 * Shopping Agent
 * Handles product search, filtering, and selection
 * Tools: product.*, category.*, attribute.*, collection.*
 * Prompt: Strict JSON, no personality
 */
class ShoppingAgent extends BaseAgent {
    constructor() {
        const tools = getToolsForAgent('Shopping');
        super('Shopping', tools, ShoppingAgent.buildPrompt);
    }

    /**
     * Build the Shopping Agent's system prompt
     * @param {Array} toolResults - Results from tool execution
     * @param {Object} context - Execution context
     * @returns {string} System prompt
     */
    static buildPrompt(toolResults, context) {
        // Extract products from tool results
        const products = [];
        for (const result of toolResults) {
            if (result.success && result.result) {
                if (Array.isArray(result.result)) {
                    products.push(...result.result);
                } else if (result.result.products && Array.isArray(result.result.products)) {
                    products.push(...result.result.products);
                }
            }
        }

        // Build product summary for strict grounding
        let productSummary = '';
        if (products.length === 0) {
            productSummary = 'NO PRODUCTS FOUND';
        } else {
            productSummary = products.map((p, idx) =>
                `${idx + 1}. ${p.name || p.title} (ID: ${p.id}) - $${p.price || p.metadata?.price || 'N/A'}`
            ).join('\n');
        }

        return `You are the Shopping Agent for Be3 store.

ROLE: Present product search results to the user.

CRITICAL ANTI-HALLUCINATION RULES:
1. You MUST ONLY mention products from the TOOL RESULTS below
2. Do NOT invent, create, or imagine ANY products
3. If NO products found, say "No products found"
4. Do NOT add fake product IDs, specs, or details
5. STRICT grounding: Use EXACTLY the data provided

TOOL RESULTS:
${productSummary}

TOTAL PRODUCTS FOUND: ${products.length}

OUTPUT FORMAT:
- List ONLY the products from TOOL RESULTS
- Use format: Name (#ID) - Price
- NO emojis, NO personality
- Factual and concise`;
    }
}

module.exports = ShoppingAgent;
