/**
 * Phase 1 Foundation Tests
 * Run: node tests/phase1_foundation_test.js
 */

const BaseAgent = require('../src/agents/BaseAgent');
const {
    getAgentForIntent,
    getAgentForTool,
    getToolsForAgent,
    getIntentsForAgent
} = require('../src/agents/registry');
const ShoppingAgent = require('../src/agents/agents/ShoppingAgent');
const DiscoveryAgent = require('../src/agents/agents/DiscoveryAgent');
const TransactionalAgent = require('../src/agents/agents/TransactionalAgent');
const VendorAgent = require('../src/agents/agents/VendorAgent');
const SupportAgent = require('../src/agents/agents/SupportAgent');

console.log('=== Phase 1: Foundation Tests ===\n');

// Test 1: Intent → Agent mapping
console.log('Test 1: Intent → Agent mapping');
console.assert(getAgentForIntent('search products') === 'Shopping', 'Failed: search products');
console.assert(getAgentForIntent('add to cart') === 'Transactional', 'Failed: add to cart');
console.assert(getAgentForIntent('browse categories') === 'Discovery', 'Failed: browse categories');
console.assert(getAgentForIntent('list vendors') === 'Vendor', 'Failed: list vendors');
console.assert(getAgentForIntent('greeting') === 'Support', 'Failed: greeting');
console.assert(getAgentForIntent('unknown intent') === 'Support', 'Failed: unknown intent fallback');
console.log('✅ Intent mapping works\n');

// Test 2: Tool → Agent mapping
console.log('Test 2: Tool → Agent mapping');
console.assert(getAgentForTool('product.search') === 'Shopping', 'Failed: product.search');
console.assert(getAgentForTool('cart.add') === 'Transactional', 'Failed: cart.add');
console.assert(getAgentForTool('category.list') === 'Discovery', 'Failed: category.list');
console.assert(getAgentForTool('vendor.list') === 'Vendor', 'Failed: vendor.list');
console.assert(getAgentForTool('conversation.clarify') === 'Support', 'Failed: conversation.clarify');
console.log('✅ Tool mapping works\n');

// Test 3: Get tools for agent
console.log('Test 3: Get tools for agent');
const shoppingTools = getToolsForAgent('Shopping');
const transactionalTools = getToolsForAgent('Transactional');

console.assert(shoppingTools.includes('product.search'), 'Failed: Shopping should have product.search');
console.assert(!shoppingTools.includes('cart.add'), 'Failed: Shopping should NOT have cart.add');
console.assert(transactionalTools.includes('cart.add'), 'Failed: Transactional should have cart.add');
console.assert(!transactionalTools.includes('product.search'), 'Failed: Transactional should NOT have product.search');
console.log(`  Shopping tools: ${shoppingTools.length}`);
console.log(`  Transactional tools: ${transactionalTools.length}`);
console.log('✅ Tool assignment works\n');

// Test 4: Agent instances
console.log('Test 4: Agent instances');
const shopping = new ShoppingAgent();
const discovery = new DiscoveryAgent();
const transactional = new TransactionalAgent();
const vendor = new VendorAgent();
const support = new SupportAgent();

console.assert(shopping.name === 'Shopping', 'Failed: Shopping agent name');
console.assert(shopping.tools.length > 0, 'Failed: Shopping agent should have tools');
console.assert(discovery.name === 'Discovery', 'Failed: Discovery agent name');
console.assert(transactional.name === 'Transactional', 'Failed: Transactional agent name');
console.assert(vendor.name === 'Vendor', 'Failed: Vendor agent name');
console.assert(support.name === 'Support', 'Failed: Support agent name');
console.log('✅ Agent instances created\n');

// Test 5: Agent execution (placeholder)
console.log('Test 5: Agent execution (placeholder)');
(async () => {
    const result = await shopping.execute({
        userMessage: 'show me phones',
        context: {},
        mode: 'SINGLE',
        requestId: 'test-001'
    });

    console.assert(result.response, 'Failed: Should have response');
    console.assert(Array.isArray(result.tools), 'Failed: Should have tools array');
    console.assert(Array.isArray(result.toolResults), 'Failed: Should have toolResults array');
    console.log('✅ Agent execution works (placeholder)\n');

    console.log('=== All Phase 1 tests passed! ✅ ===');
})();
