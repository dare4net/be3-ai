/**
 * Tool Selector
 * Uses the AI to select the optimal set of tools for a given user query.
 */

const { queryAI } = require('./aiService');
const { getToolDescriptions } = require('../tools/registry');
const { getContextSummary } = require('../context/storeContext');

/**
 * reliable JSON extraction from AI response
 */
function extractJSON(text) {
    if (!text) return null;
    try {
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end > start) {
            const jsonPart = text.substring(start, end + 1);
            return JSON.parse(jsonPart);
        }
        // REPAIR: If there's a '[' but no ']', the AI output was truncated.
        // Try to find the last complete object and close the array.
        if (start !== -1 && end === -1) {
            console.warn('[ToolSelector] Truncated JSON detected, attempting repair...');
            let truncated = text.substring(start);
            // Find the last complete '}'
            const lastBrace = truncated.lastIndexOf('}');
            if (lastBrace !== -1) {
                truncated = truncated.substring(0, lastBrace + 1) + ']';
                const repaired = JSON.parse(truncated);
                console.log(`[ToolSelector] Repair successful! Recovered ${repaired.length} tools.`);
                return repaired;
            }
        }
    } catch (e) {
        console.error('[ToolSelector] JSON parse error:', e.message);
    }
    return null;
}

/**
 * Select tools based on user message and context
 * @param {string} userMessage 
 * @param {Array} conversationHistory 
 * @returns {Promise<Array>} List of selected tools (or empty array)
 */
async function selectTools(userMessage, conversationHistory, lastSuggestion = null) {
    const toolDescriptions = getToolDescriptions();
    const contextSummary = JSON.stringify(getContextSummary()).substring(0, 4000); // Limit context size

    const suggestionContext = lastSuggestion ? `\nLAST BOT SUGGESTION (User might be responding to this):
${JSON.stringify(lastSuggestion, null, 2)}` : '';

    const systemPrompt = `You are the AI Orchestrator for the Be3 E-commerce Store.
Your goal is to select the BEST tools to fulfill the user's request efficiently.
${suggestionContext}

CORE PRINCIPLES:
 1. DECISIVENESS: If the user asks for products or categories (e.g. "I want a phone", "any laptops?"), ALWAYS use "product.search" immediately.
 2. DISCOVERY RESTRICTION: Do NOT use "discovery.getTrending" or "discovery.getSuggestions" for specific item types. These tools are ONLY for broad, non-specific browsing (e.g. "What's new?", "Surprise me").
 3. NO REDUNDANCY: Do NOT call metadata tools (category.getInfo, attribute.list) if you can perform a search directly.
 4. SPECIFICITY: Use filters (category, attribute, vendor, price) in product.search whenever possible based on the request.
 5. REUSE & REFERENCES: If the user refers to a product from the previous turn (e.g. "add it", "the first one"), use "the_first_one", "the_second_one", or the product name in "product_id". NEVER use placeholders like "ID of the product".
 6. TARGETED VENDOR SEARCH: If the user mentions a specific product from a vendor (e.g. "their rattan drawers", "Samsung phone from Dareymi"), ALWAYS use "product.search" with the vendor's "tag" filter for precision. Only use "vendor.getProducts" for general inventory list requests like "What do they sell?".
 7. HISTORY RESOLUTION: Resolve "their", "this vendor", or "that shop" using conversation history to find the correct vendor tag.
 8. CONTACTING VENDORS: If the user wants to contact a vendor or get their WhatsApp link/number, use "vendor.getContactLink".
 9. CONTEXT SWITCHING: If a user asks for a product that is logically unrelated to the previously discussed vendor (e.g. switching from furniture to electronics), DO NOT carry over the vendor "tag" unless explicitly requested.
 10. VENDOR NEUTRALITY: By default, "product.search" should be vendor-agnostic (tag: null) unless the user specifies a shop or uses pronouns like "their", "that shop", etc.
  11. SENTINEL (Conditional): Whenever you call "product.search" for a specific item, append "discovery.ensureSuggestions" EXCEPT if you are using "task.plan".
            // TASK ENGINE DISABLED
            // 12. TASK ENGINE (Autonomy): ... (Disabled)
  13. CHAINING: For sequential flows (predictable), use standard chaining.
  14. NO DUPLICATES: Never call the same search or discovery tool twice.
  15. FINAL RESPONSE: Return ONLY the JSON array.

AVAILABLE TOOLS:
${JSON.stringify(toolDescriptions, null, 2)}

STORE CONTEXT (Category IDs, Slugs, Vendor Names):
${contextSummary}

OUTPUT FORMAT:
Your ENTIRE response must be ONLY a valid JSON array. No text before it. No text after it. No explanations. No markdown.
If you output ANYTHING other than a JSON array, the system will CRASH.

CORRECT:
[{ "tool": "product.search", "params": { "query": "iPhone" }, "reason": "User search" }]

WRONG (will crash):
Here are some phones... [{ "tool": ... }]

WRONG (will crash):
I've added the item to your cart!

You select tools. You do NOT execute them. You do NOT describe results. JSON array ONLY.`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-4).map(h => ({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        })),
        { role: 'user', content: userMessage }
    ];

    try {
        // Reduced maxTokens (256) and low temperature (0.1) to force JSON-only output
        const response = await queryAI(messages, 256, 0.1);

        console.log(`[ToolSelector] Raw AI response: ${response}`);

        const selection = extractJSON(response);

        if (!Array.isArray(selection)) {
            console.warn('[ToolSelector] AI returned invalid format (not an array), defaulting to empty.');
            return [];
        }

        // === ARCHITECTURAL ENFORCEMENT LAYER ===
        const enforced = enforceToolRules(selection);
        console.log(`[ToolSelector] Post-enforcement: ${enforced.map(t => t.tool).join(', ')}`);
        return enforced;

    } catch (error) {
        console.error('[ToolSelector] Error selecting tools:', error);
        return [];
    }
}

/**
 * HARD-CODED enforcement of tool selection rules.
 * This runs AFTER the AI selects tools and overrides any violations.
 * The AI cannot be trusted to follow prompt-level rules consistently.
 */
function enforceToolRules(tools) {
    if (!tools || tools.length === 0) return [];

    // RULE 1: task.plan EXCLUSIVITY
    // If task.plan is anywhere in the array, it must be the ONLY tool.
    const hasPlan = tools.find(t => t.tool === 'task.plan');
    if (hasPlan) {
        console.log('[ToolSelector] ENFORCEMENT: task.plan detected → stripping all other tools.');
        return [hasPlan]; // Return ONLY the first task.plan
    }

    // RULE 2: task.execute_next EXCLUSIVITY
    // If task.execute_next is anywhere, it should also be the only tool.
    const hasExecuteNext = tools.find(t => t.tool === 'task.execute_next');
    if (hasExecuteNext) {
        console.log('[ToolSelector] ENFORCEMENT: task.execute_next detected → stripping all other tools.');
        return [hasExecuteNext];
    }

    // RULE 3: DEDUPLICATION
    // Never run the same tool with the same params twice.
    const seen = new Set();
    const deduped = tools.filter(t => {
        const key = `${t.tool}:${JSON.stringify(t.params || {})}`;
        if (seen.has(key)) {
            console.log(`[ToolSelector] ENFORCEMENT: Duplicate removed → ${t.tool}`);
            return false;
        }
        seen.add(key);
        return true;
    });

    // RULE 4: MAX TOOL CAP (prevent runaway selections)
    const MAX_TOOLS = 6;
    if (deduped.length > MAX_TOOLS) {
        console.log(`[ToolSelector] ENFORCEMENT: Tool cap hit (${deduped.length} → ${MAX_TOOLS})`);
        return deduped.slice(0, MAX_TOOLS);
    }

    return deduped;
}

module.exports = { selectTools };
