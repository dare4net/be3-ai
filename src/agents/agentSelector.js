const Logger = require('../utils/logger');
const { resolveIntent } = require('../core/intentResolver');
const { getAgentForIntent } = require('./registry');
const ShoppingAgent = require('./agents/ShoppingAgent');
const DiscoveryAgent = require('./agents/DiscoveryAgent');
const TransactionalAgent = require('./agents/TransactionalAgent');
const VendorAgent = require('./agents/VendorAgent');
const SupportAgent = require('./agents/SupportAgent');

const logger = new Logger('AgentSelector');

// Singleton agent instances
const AGENT_INSTANCES = {
    Shopping: new ShoppingAgent(),
    Discovery: new DiscoveryAgent(),
    Transactional: new TransactionalAgent(),
    Vendor: new VendorAgent(),
    Support: new SupportAgent()
};

/**
 * Select which agent(s) should handle the user's request
 * @param {Object} params
 * @param {string} params.userMessage - User's message
 * @param {string} params.sessionId - Session identifier
 * @param {Array} params.history - Conversation history
 * @param {Object} params.context - Execution context
 * @param {string} params.requestId - Request identifier
 * @returns {Object} { mode, primaryAgent, chainedAgents, intents }
 */
async function selectAgent({ userMessage, sessionId, history, context, requestId }) {
    logger.info('Selecting agent', { requestId, userMessage });

    // 1. Resolve intent(s) via IntentResolver
    const intentResult = await resolveIntent(userMessage, history, requestId);

    logger.info('Intent resolved', {
        requestId,
        intents: intentResult.intents,
        count: intentResult.intents.length
    });

    // 2. Detect if chained (multiple intents in one message)
    const isChained = intentResult.intents && intentResult.intents.length > 1;

    if (isChained) {
        // Map each intent to an agent
        const agentNames = intentResult.intents.map(intent => getAgentForIntent(intent));
        const agents = agentNames.map(name => AGENT_INSTANCES[name]);

        logger.info('Chained agents selected', {
            requestId,
            agents: agentNames,
            chain: agentNames.join(' → ')
        });

        return {
            mode: 'CHAINED',
            primaryAgent: agents[0],
            chainedAgents: agents.slice(1),
            intents: intentResult.intents
        };
    } else {
        // Single intent → single agent
        const intent = intentResult.intents ? intentResult.intents[0] : intentResult.intent;
        const agentName = getAgentForIntent(intent);
        const agent = AGENT_INSTANCES[agentName];

        logger.info('Single agent selected', {
            requestId,
            agent: agentName,
            intent
        });

        return {
            mode: 'SINGLE',
            primaryAgent: agent,
            chainedAgents: [],
            intents: intentResult.intents || [intentResult.intent]
        };
    }
}

module.exports = { selectAgent, AGENT_INSTANCES };
