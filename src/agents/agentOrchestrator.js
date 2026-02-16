const Logger = require('../utils/logger');

const logger = new Logger('AgentOrchestrator');

/**
 * Agent Orchestrator
 * Manages agent execution flow for both single and chained agent scenarios
 */
class AgentOrchestrator {
    /**
     * Run a single agent
     * @param {Object} params
     * @param {Object} params.agent - The agent instance to run
     * @param {string} params.userMessage - User's message
     * @param {Object} params.context - Execution context
     * @param {string} params.requestId - Request identifier
     * @returns {Object} { response, tools, toolResults, handoff }
     */
    async runSingle({ agent, userMessage, context, requestId }) {
        logger.info('Running single agent', {
            requestId,
            agent: agent.name
        });

        const startTime = Date.now();

        const result = await agent.execute({
            userMessage,
            context,
            mode: 'SINGLE',
            requestId
        });

        const duration = Date.now() - startTime;

        logger.info('Single agent complete', {
            requestId,
            agent: agent.name,
            toolsUsed: result.tools ? result.tools.length : 0,
            duration: `${duration}ms`
        });

        // Unexpected handoff in single mode?
        if (result.handoff) {
            logger.warn('Unexpected handoff detected in SINGLE mode', {
                requestId,
                from: agent.name,
                to: result.handoff.agent,
                context: Object.keys(result.handoff.context || {})
            });
        }

        return result;
    }

    /**
     * Run multiple agents in a chain
     * @param {Object} params
     * @param {Array} params.agents - Array of agent instances
     * @param {string} params.userMessage - User's message
     * @param {Object} params.context - Execution context
     * @param {string} params.requestId - Request identifier
     * @returns {Object} { response, agentChain, toolResults }
     */
    async runChained({ agents, userMessage, context, requestId }) {
        logger.info('Running chained agents', {
            requestId,
            agents: agents.map(a => a.name),
            count: agents.length,
            chain: agents.map(a => a.name).join(' → ')
        });

        const startTime = Date.now();
        let currentContext = { ...context };
        const agentChain = [];

        for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];

            logger.info(`Executing agent ${i + 1}/${agents.length}`, {
                requestId,
                agent: agent.name,
                step: `${i + 1}/${agents.length}`
            });

            const stepStart = Date.now();

            const result = await agent.execute({
                userMessage,
                context: currentContext,
                mode: 'CHAINED',
                requestId
            });

            const stepDuration = Date.now() - stepStart;

            agentChain.push({
                agent: agent.name,
                tools: result.tools || [],
                toolResults: result.toolResults || [],
                response: result.response,
                duration: `${stepDuration}ms`
            });

            logger.info(`Agent ${i + 1} complete`, {
                requestId,
                agent: agent.name,
                toolsUsed: result.tools ? result.tools.length : 0,
                duration: `${stepDuration}ms`
            });

            // Pass handoff context to next agent
            if (result.handoff && i < agents.length - 1) {
                currentContext = {
                    ...currentContext,
                    ...result.handoff.context
                };

                logger.info('Handoff context passed', {
                    requestId,
                    from: agent.name,
                    to: agents[i + 1].name,
                    contextKeys: Object.keys(result.handoff.context || {})
                });
            }
        }

        const totalDuration = Date.now() - startTime;

        logger.info('Chained execution complete', {
            requestId,
            totalAgents: agents.length,
            totalDuration: `${totalDuration}ms`
        });

        // Combine responses from all agents
        const combinedResponse = this.combineResponses(agentChain);

        return {
            response: combinedResponse,
            agentChain,
            toolResults: agentChain.flatMap(a => a.toolResults || [])
        };
    }

    /**
     * Combine responses from multiple agents
     * @param {Array} chain - Array of agent execution results
     * @returns {string} Combined response
     */
    combineResponses(chain) {
        return chain
            .map(c => c.response)
            .filter(Boolean)
            .join('\n\n');
    }
}

module.exports = new AgentOrchestrator();
