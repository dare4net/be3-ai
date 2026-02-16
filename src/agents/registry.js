/**
 * Agent Registry: Maps intents and tools to agents
 * 
 * This registry is the source of truth for:
 * 1. Which agent handles which intent
 * 2. Which agent owns which tools
 * 3. What tools are available to each agent
 */

// Intent → Agent mapping
const INTENT_TO_AGENT = {
    // Shopping Agent
    'search products': 'Shopping',
    'search in category': 'Shopping',
    'filter results': 'Shopping',
    'sort results': 'Shopping',
    'select product': 'Shopping',
    'get product details': 'Shopping',
    'compare products': 'Shopping',
    'get product images': 'Shopping',

    // Discovery Agent
    'browse categories': 'Discovery',
    'select category': 'Discovery',
    'exploration': 'Discovery',

    // Transactional Agent
    'add to cart': 'Transactional',
    'view cart': 'Transactional',
    'remove from cart': 'Transactional',
    'update cart': 'Transactional',
    'clear cart': 'Transactional',
    'checkout': 'Transactional',
    'view orders': 'Transactional',
    'view order history': 'Transactional',

    // Vendor Agent
    'search specific vendor': 'Vendor',
    'list vendors': 'Vendor',
    'get vendor info': 'Vendor',
    'browse vendor products': 'Vendor',

    // Support Agent (fallback)
    'greeting': 'Support',
    'thank user': 'Support',
    'clarification': 'Support',
    'unknown': 'Support',
    'farewell': 'Support'
};

// Tool → Agent mapping
const TOOL_TO_AGENT = {
    // Shopping Agent tools (ONLY product search/details)
    'product.search': 'Shopping',
    'product.getDetails': 'Shopping',
    'product.compare': 'Shopping',
    'product.getImage': 'Shopping',

    // Discovery Agent tools (exploration, categories, collections)
    'discovery.getCategories': 'Discovery',
    'discovery.ensureSuggestion': 'Discovery',
    'category.list': 'Discovery',
    'category.getInfo': 'Discovery',
    'category.getSubcategories': 'Discovery',
    'collection.list': 'Discovery',
    'collection.get': 'Discovery',
    'attribute.list': 'Discovery',
    'attribute.getValues': 'Discovery',

    // Transactional Agent tools
    'cart.add': 'Transactional',
    'cart.remove': 'Transactional',
    'cart.view': 'Transactional',
    'cart.update': 'Transactional',
    'cart.clear': 'Transactional',
    'order.checkout': 'Transactional',
    'order.view': 'Transactional',
    'order.getHistory': 'Transactional',

    // Vendor Agent tools
    'vendor.list': 'Vendor',
    'vendor.getProducts': 'Vendor',
    'vendor.getInfo': 'Vendor',

    // Support Agent tools
    'conversation.clarify': 'Support',
    'conversation.retry': 'Support'
};

/**
 * Get which agent should handle a given intent
 * @param {string} intent - Intent identifier
 * @returns {string} Agent name (defaults to 'Support')
 */
function getAgentForIntent(intent) {
    return INTENT_TO_AGENT[intent] || 'Support';
}

/**
 * Get which agent owns a given tool
 * @param {string} toolName - Tool identifier (e.g., 'product.search')
 * @returns {string} Agent name (defaults to 'Shopping')
 */
function getAgentForTool(toolName) {
    return TOOL_TO_AGENT[toolName] || 'Shopping';
}

/**
 * Get all tools available to a specific agent
 * @param {string} agentName - Name of the agent
 * @returns {string[]} Array of tool names
 */
function getToolsForAgent(agentName) {
    return Object.keys(TOOL_TO_AGENT).filter(
        tool => TOOL_TO_AGENT[tool] === agentName
    );
}

/**
 * Get all intents that an agent can handle
 * @param {string} agentName - Name of the agent
 * @returns {string[]} Array of intent names
 */
function getIntentsForAgent(agentName) {
    return Object.keys(INTENT_TO_AGENT).filter(
        intent => INTENT_TO_AGENT[intent] === agentName
    );
}

module.exports = {
    getAgentForIntent,
    getAgentForTool,
    getToolsForAgent,
    getIntentsForAgent,
    INTENT_TO_AGENT,
    TOOL_TO_AGENT
};
