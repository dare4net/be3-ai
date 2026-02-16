/**
 * Tool Selector
 * Uses the AI to select the optimal set of tools for a given user query.
 */

const { queryAI } = require('./aiService');
const { getToolDescriptions } = require('../tools/registry');
const { getContextSummary } = require('../context/storeContext');
const { resolveIntent } = require('./intentResolver');

/**
 * reliable JSON extraction from AI response
 */
function extractJSON(text) {
    if (!text) return null;
    try {
        // Find the first and last curly or square brace
        const start = text.search(/\{|\[/);
        const end = text.lastIndexOf(text[start] === '{' ? '}' : ']');
        if (start !== -1 && end !== -1) {
            const jsonPart = text.substring(start, end + 1);
            return JSON.parse(jsonPart);
        }
    } catch (e) {
        console.error('[ToolSelector] JSON parse error:', e.message);
        console.error('[ToolSelector] Attempted to parse:', text.substring(text.search(/\{|\[/), text.lastIndexOf('}') + 1));
    }
    return null;
}

/**
 * Select tools based on user message and context
 * PHASE 4 UPDATE: Now supports agent-filtered tool selection
 * @param {string} userMessage 
 * @param {Array} conversationHistory 
 * @param {Object} lastSuggestion
 * @param {Array} availableTools - Optional: Filter to these tools only (for agents)
 * @param {string} agentName - Optional: Name of the agent calling this
 * @param {string} requestId - Request identifier for logging
 * @returns {Promise<Array>} List of selected tools (or empty array)
 */
async function selectTools(userMessage, conversationHistory, lastSuggestion = null, availableTools = null, agentName = null, requestId = 'N/A') {
    const Logger = require('../utils/logger');
    const logger = new Logger('ToolSelector');

    logger.info('Selecting tools', {
        requestId,
        agentName,
        availableToolCount: availableTools ? availableTools.length : 'all'
    });

    // Get tool descriptions, filtered by availableTools if provided
    let toolDescriptions = getToolDescriptions();

    if (availableTools && availableTools.length > 0) {
        // Filter to only the tools this agent owns
        toolDescriptions = toolDescriptions.filter(td =>
            availableTools.includes(td.name)
        );

        logger.info('Tools filtered for agent', {
            requestId,
            agentName,
            totalTools: getToolDescriptions().length,
            filteredTools: toolDescriptions.length
        });
    }

    const contextSummary = JSON.stringify(getContextSummary()).substring(0, 4000); // Limit context size

    const suggestionContext = lastSuggestion ? `\nLAST BOT SUGGESTION (User might be responding to this):\n${JSON.stringify(lastSuggestion, null, 2)}` : '';

    // PHASE 5: Intent already resolved by AgentSelector, no need to call again
    // This saves an AI call and prevents duplicate processing
    let adviceContext = ""; // Keep it defined as an empty string if not used

    const systemPrompt = `You are the AI Tool Selector for ${agentName} agent.
Your ONLY goal: Select the best tools from YOUR AVAILABLE TOOLS to fulfill the user's request.

${suggestionContext}

SELECTION PRINCIPLES:
1. Use ONLY tools from the AVAILABLE TOOLS list below
2. Be decisive - if a tool matches the request, select it
3. Use tool parameters effectively (category, price, query, etc.)
4. Return strict JSON format only

AVAILABLE TOOLS FOR ${agentName}:
${JSON.stringify(toolDescriptions, null, 2)}


STORE CONTEXT (Category IDs, Slugs, Vendor Names):
${contextSummary}

OUTPUT FORMAT:
Return ONLY a valid JSON object. No markdown, no pre-amble, no apologies.
{
  "advice_rating": number, // Scale 0-1. How helpful was the INTENT ADVISOR? (Note: Identifying uncertainty/confusion is highly valuable if it prevents guessing).
  "tools": [
    { "tool": "product.search", "params": { "query": "iPhone 12" }, "reason": "User search" }
  ]
}
Failure to provide ONLY JSON will break the system.
Example:
{
  "advice_rating": 0.9,
  "tools": [
    { "tool": "product.search", "params": { "query": "iPhone 12" }, "reason": "User search" },
    { "tool": "discovery.ensureSuggestions", "params": { "search_intent": "iPhone 12" }, "reason": "Sentinel" }
  ]
}`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-4).map(h => ({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        })),
        { role: 'user', content: userMessage },
        { role: 'assistant', content: '{' }  // Prime JSON output
    ];

    try {
        // Increased max tokens and slightly higher temperature for better reasoning
        let response;
        try {
            response = await queryAI(messages, 1024, 0.2, 2, {
                response_format: { type: "json_object" }
            });
        } catch (e) {
            // Fall back without response_format
            console.warn('[ToolSelector] JSON mode not supported, falling back');
            response = await queryAI(messages, 1024, 0.2);
        }


        console.log(`[ToolSelector] Raw AI response: ${response}`);

        const selection = extractJSON(response);

        if (!selection) {
            console.warn('[ToolSelector] AI returned null or unparseable response.');
            return [];
        }

        // Handle both object { advice_rating, tools } and legacy array format
        let tools = Array.isArray(selection) ? selection : (selection.tools || []);
        const rating = selection.advice_rating;

        if (rating !== undefined) {
            console.log(`[ToolSelector] ⭐ Advice Rating: ${rating}/1.0`);
        }

        if (!Array.isArray(tools)) {
            console.warn('[ToolSelector] AI returned invalid tools format, defaulting to empty.');
            return [];
        }

        // PHASE 5: CRITICAL VALIDATION - Filter out tools not in availableTools list
        if (availableTools && availableTools.length > 0) {
            const originalCount = tools.length;
            tools = tools.filter(tool => {
                const isValid = availableTools.includes(tool.tool);
                if (!isValid) {
                    console.warn(`[ToolSelector] ❌ REJECTED: ${tool.tool} - Not available to ${agentName} agent`);
                    logger.warn('Tool selection rejected', {
                        requestId,
                        agentName,
                        rejectedTool: tool.tool,
                        reason: 'Not in agent tool list'
                    });
                }
                return isValid;
            });

            if (tools.length < originalCount) {
                const rejectedCount = originalCount - tools.length;
                console.warn(`[ToolSelector] 🚫 Rejected ${rejectedCount} hallucinated tool(s)`);
            }
        }

        return tools;

    } catch (error) {
        console.error('[ToolSelector] Error selecting tools:', error);
        return [];
    }
}

module.exports = { selectTools };
