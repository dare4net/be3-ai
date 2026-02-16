const Logger = require('../utils/logger');

/**
 * Base class for all agents in the multi-agent system.
 * Each agent owns specific tools and has a specialized prompt.
 */
class BaseAgent {
    constructor(name, tools, promptBuilder) {
        this.name = name;
        this.tools = tools; // Array of tool names this agent owns
        this.promptBuilder = promptBuilder;
        this.logger = new Logger(`Agent:${name}`);
    }

    /**
     * Execute the agent's task
     * @param {Object} params
     * @param {string} params.userMessage - User's message
     * @param {Object} params.context - Execution context (state, session, etc.)
     * @param {string} params.mode - 'SINGLE' or 'CHAINED'
     * @param {string} params.requestId - Unique request identifier
     * @returns {Object} { response, tools, toolResults, handoff }
     */
    async execute({ userMessage, context, mode, requestId }) {
        this.logger.info('Starting execution', {
            requestId,
            mode,
            toolCount: this.tools.length
        });

        // 1. Tool Selection (with agent's tools only)
        const { selectTools } = require('../core/toolSelector');

        this.logger.info('Selecting tools', {
            requestId,
            availableTools: this.tools.length
        });

        const selectedTools = await selectTools(
            userMessage,
            context.conversationHistory || [],
            context.lastSuggestion || null,
            this.tools, // Filter to this agent's tools only
            this.name,
            requestId
        );

        this.logger.info('Tools selected', {
            requestId,
            tools: selectedTools.map(t => t.tool),
            count: selectedTools.length
        });

        // 2. Tool Execution
        const orchestrator = require('../core/orchestrator');

        const toolResults = await orchestrator.executeBatch(
            selectedTools,
            context,
            requestId
        );

        this.logger.info('Tools executed', {
            requestId,
            resultsCount: toolResults.length
        });

        // 3. Generate Response (using agent-specific prompt)
        const response = await this.generateResponse({
            userMessage,
            toolResults,
            context,
            requestId
        });

        this.logger.info('Execution complete', { requestId });

        return {
            response,
            tools: selectedTools,
            toolResults,
            handoff: this.detectHandoff(response, toolResults, context)
        };
    }

    /**
     * Generate response using agent's specialized prompt
     * @param {Object} params
     * @returns {string} Generated response
     */
    async generateResponse({ userMessage, toolResults, context, requestId }) {
        const { queryAI } = require('../core/aiService');

        const systemPrompt = this.promptBuilder(toolResults, context);

        this.logger.debug('Generating response', {
            requestId,
            promptLength: systemPrompt.length
        });

        const response = await queryAI([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ], 512, 0.7, 2, {});

        return response;
    }

    /**
     * Detect if handoff to another agent is needed
     * @param {string} response - Generated response
     * @param {Array} toolResults - Tool execution results
     * @param {Object} context - Execution context
     * @returns {Object|null} Handoff information or null
     */
    detectHandoff(response, toolResults, context) {
        // Phase 4: Placeholder - will implement handoff detection in Phase 5
        // This would check if the response suggests another agent should take over
        return null;
    }

    /**
     * Check if this agent can handle the given intent
     * @param {string} intent - Intent identifier
     * @returns {boolean}
     */
    canHandle(intent) {
        // Will be implemented in Phase 2
        return false;
    }
}

module.exports = BaseAgent;
