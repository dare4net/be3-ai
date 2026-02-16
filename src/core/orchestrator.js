/**
 * Tool Orchestrator
 * Executes sequences of tools selected by the AI.
 * Manages context passing, error handling, and results aggregation.
 */

const { TOOL_REGISTRY } = require('../tools/registry');
const { getContextSummary, CATEGORIES, VENDORS, ATTRIBUTES, COLLECTIONS } = require('../context/storeContext');

/**
 * Execute a list of selected tools
 * @param {Array} toolsSelected - Array of { tool, params, reason }
 * @param {string} sessionId - Current user session ID
 * @returns {Promise<Array>} Array of execution results
 */
async function executeTools(toolsSelected, sessionId) {
    // Standard context available to all tools
    const context = {
        CATEGORIES,
        VENDORS,
        ATTRIBUTES,
        COLLECTIONS,
        summary: getContextSummary(),
        sessionId: sessionId
    };

    const results = [];

    console.log(`[Orchestrator] Executing ${toolsSelected.length} tools for session ${sessionId}`);

    for (const toolCall of toolsSelected) {
        const toolName = toolCall.tool;
        const toolDef = TOOL_REGISTRY[toolName];

        if (!toolDef) {
            console.warn(`[Orchestrator] Tool not found: ${toolName}`);
            results.push({
                tool: toolName,
                error: `Tool ${toolName} not found`,
                success: false
            });
            continue;
        }

        console.log(`[Orchestrator] Running ${toolName} with params:`, JSON.stringify(toolCall.params));

        try {
            // Execute the tool handler
            // Params: tool params, store context, accumulated results (for shadowing/chaining)
            const result = await toolDef.handler(toolCall.params, context, results);

            const executionResult = {
                tool: toolName,
                result: result,
                success: result && !result.error, // Safe check for result
                reason: toolCall.reason
            };

            results.push(executionResult);

            // RESILIENCE: Only trigger circuit breaker for critical tools or fatal errors
            const isCritical = toolName.startsWith('cart.') || toolName.startsWith('order.');
            if (result.error && isCritical) {
                console.warn(`[Orchestrator] Circuit breaker triggered by critical tool ${toolName}: ${result.error}`);
                break;
            } else if (result.error) {
                console.warn(`[Orchestrator] Non-critical tool ${toolName} failed: ${result.error}. Continuing...`);
            }

        } catch (error) {
            console.error(`[Orchestrator] Error executing ${toolName}:`, error);
            results.push({
                tool: toolName,
                error: error.message,
                success: false
            });
            // Stop on exception as well
            break;
        }
    }

    return results;
}

/**
 * PHASE 4: Wrapper for agent integration
 * Execute batch of tools with context and request ID
 * @param {Array} toolsSelected - Array of { tool, params, reason }
 * @param {Object} context - Execution context (includes sessionId)
 * @param {string} requestId - Request identifier
 * @returns {Promise<Array>} Array of execution results
 */
async function executeBatch(toolsSelected, context, requestId = 'N/A') {
    const Logger = require('../utils/logger');
    const logger = new Logger('Orchestrator');

    logger.info('Executing tools', {
        requestId,
        toolCount: toolsSelected.length,
        tools: toolsSelected.map(t => t.tool)
    });

    const sessionId = context.sessionId || 'default-session';
    const results = await executeTools(toolsSelected, sessionId);

    logger.info('Tool execution complete', {
        requestId,
        successCount: results.filter(r => r.success).length,
        errorCount: results.filter(r => !r.success).length
    });

    return results;
}

module.exports = { executeTools, executeBatch };
