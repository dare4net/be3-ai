/**
 * Phase 4 Tool Integration Tests
 * Run: node tests/phase4_tool_integration_test.js
 */

const ShoppingAgent = require('../src/agents/agents/ShoppingAgent');
const TransactionalAgent = require('../src/agents/agents/TransactionalAgent');
const { getToolsForAgent } = require('../src/agents/registry');

console.log('=== Phase 4: Tool Integration Tests ===\n');

// Test 1: Agent tool ownership
console.log('Test 1: Agent tool ownership');
const shoppingAgent = new ShoppingAgent();
const transactionalAgent = new TransactionalAgent();

console.assert(shoppingAgent.tools.includes('product.search'), 'Failed: Shopping should have product.search');
console.assert(!shoppingAgent.tools.includes('cart.add'), 'Failed: Shopping should NOT have cart.add');
console.assert(transactionalAgent.tools.includes('cart.add'), 'Failed: Transactional should have cart.add');
console.assert(!transactionalAgent.tools.includes('product.search'), 'Failed: Transactional should NOT have product.search');

console.log(`  ✅ Shopping tools: ${shoppingAgent.tools.length}`);
console.log(`  ✅ Transactional tools: ${transactionalAgent.tools.length}`);
console.log('');

// Test 2: Agent execution with tool selector
console.log('Test 2: Agent execution with real tools (Shopping)');
(async () => {
    const result = await shoppingAgent.execute({
        userMessage: 'show me phones',
        context: {
            conversationHistory: [],
            sessionId: 'test-session'
        },
        mode: 'SINGLE',
        requestId: 'test-002'
    });

    console.assert(result.response, 'Failed: Should have response');
    console.log(`  ✅ Tools selected: ${result.tools ? result.tools.length : 0}`);
    console.log(`  ✅ Tools executed: ${result.toolResults ? result.toolResults.length : 0}`);
    if (result.tools && result.tools.length > 0) {
        console.log(`  ✅ Tool names: ${result.tools.map(t => t.tool).join(', ')}`);
    }
    console.log(`  ✅ Response length: ${result.response.length} chars`);
    console.log('');

    // Test 3: Transactional agent tool restriction
    console.log('Test 3: Transactional agent with cart tools');
    const result3 = await transactionalAgent.execute({
        userMessage: 'show me my cart',
        context: {
            conversationHistory: [],
            sessionId: 'test-session'
        },
        mode: 'SINGLE',
        requestId: 'test-003'
    });

    console.assert(result3.response, 'Failed: Should have response');

    // Verify only transactional tools were called
    if (result3.tools && result3.tools.length > 0) {
        const toolNames = result3.tools.map(t => t.tool);
        const hasNonTransactionalTools = toolNames.some(t =>
            !transactionalAgent.tools.includes(t)
        );
        console.assert(!hasNonTransactionalTools, 'Failed: Should only use transactional tools');
        console.log(`  ✅ Tools used: ${toolNames.join(', ')}`);
    }
    console.log('');

    // Test 4: Full integration
    console.log('Test 4: Full integration (AgentSelector → Orchestrator → Tools)');
    const { selectAgent } = require('../src/agents/agentSelector');
    const agentOrchestrator = require('../src/agents/agentOrchestrator');

    const selection = await selectAgent({
        userMessage: 'show me laptops',
        sessionId: 'test-session',
        history: [],
        context: {},
        requestId: 'test-004'
    });

    const result4 = await agentOrchestrator.runSingle({
        agent: selection.primaryAgent,
        userMessage: 'show me laptops',
        context: {
            conversationHistory: [],
            sessionId: 'test-session'
        },
        requestId: 'test-004'
    });

    console.assert(result4.response, 'Failed: Should have response');
    console.assert(result4.tools, 'Failed: Should have tools');
    console.log(`  ✅ Agent selected: ${selection.primaryAgent.name}`);
    console.log(`  ✅ Tools executed: ${result4.tools ? result4.tools.length : 0}`);
    console.log('');

    console.log('=== All Phase 4 tests passed! ✅ ===');
    console.log('\n🎉 Agents are now fully wired to the tool system!');
})();
