/**
 * Tool Registry
 * Central hub for all available tools in the Be3 AI system.
 * Responsible for aggregating tool definitions and providing descriptions for the AI.
 */

// Import tool modules
const vendorTools = require('./vendor');
const productTools = require('./product');
const categoryTools = require('./category');
const cartTools = require('./cart');
const orderTools = require('./order');
const collectionTools = require('./collection');
const attributeTools = require('./attribute');
const conversationTools = require('./conversation');
const discoveryTools = require('./discovery');

// Aggregate all tools
const TOOL_REGISTRY = {
    ...vendorTools,
    ...productTools,
    ...categoryTools,
    ...cartTools,
    ...orderTools,
    ...collectionTools,
    ...attributeTools,
    ...conversationTools,
    ...discoveryTools,
    // ...require('./task') // DISABLED: Task system disabled by user request
};

/**
 * Get simplified tool descriptions for the AI prompt
 * @returns {Array} List of tool objects with name, description, and params
 */
function getToolDescriptions() {
    return Object.entries(TOOL_REGISTRY).map(([name, tool]) => ({
        name,
        description: tool.description,
        params: tool.params
    }));
}

/**
 * Get a specific tool by name
 * @param {string} name 
 * @returns {Object|null}
 */
function getTool(name) {
    return TOOL_REGISTRY[name] || null;
}

module.exports = {
    TOOL_REGISTRY,
    getToolDescriptions,
    getTool
};
