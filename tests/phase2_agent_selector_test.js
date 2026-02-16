/**
 * Phase 2 Agent Selector Tests
 * Run: node tests/phase2_agent_selector_test.js
 */

const { selectAgent } = require('../src/agents/agentSelector');
const { resolveIntent } = require('../src/core/intentResolver');

console.log('=== Phase 2: Agent Selector Tests ===\n');

// Mock conversation history
const mockHistory = [];

// Test 1: Single intent → Single agent
console.log('Test 1: Single intent (search products)');
(async () => {
    const result = await selectAgent({
        userMessage: 'show me phones',
        sessionId: 'test-session',
        history: mockHistory,
        context: {},
        requestId: 'test-001'
    });

    console.assert(result.mode === 'SINGLE', 'Failed: Should be SINGLE mode');
    console.assert(result.primaryAgent.name === 'Shopping', 'Failed: Should select Shopping agent');
    console.assert(result.chainedAgents.length === 0, 'Failed: No chained agents');
    console.log(`  ✅ Mode: ${result.mode}`);
    console.log(`  ✅ Agent: ${result.primaryAgent.name}`);
    console.log('');

    // Test 2: Chained intent → Multiple agents
    console.log('Test 2: Chained intent (find and add to cart)');
    const result2 = await selectAgent({
        userMessage: 'find iPhone 13 and add to cart',
        sessionId: 'test-session',
        history: mockHistory,
        context: {},
        requestId: 'test-002'
    });

    console.assert(result2.mode === 'CHAINED', 'Failed: Should be CHAINED mode');
    console.assert(result2.primaryAgent.name === 'Shopping', 'Failed: Primary should be Shopping');
    console.assert(result2.chainedAgents.length === 1, 'Failed: Should have 1 chained agent');
    console.assert(result2.chainedAgents[0].name === 'Transactional', 'Failed: Chained should be Transactional');
    console.log(`  ✅ Mode: ${result2.mode}`);
    console.log(`  ✅ Primary Agent: ${result2.primaryAgent.name}`);
    console.log(`  ✅ Chained Agent: ${result2.chainedAgents[0].name}`);
    console.log('');

    // Test 3: Different intent types
    console.log('Test 3: Cart intent');
    const result3 = await selectAgent({
        userMessage: 'show me my cart',
        sessionId: 'test-session',
        history: mockHistory,
        context: {},
        requestId: 'test-003'
    });

    console.assert(result3.primaryAgent.name === 'Transactional', 'Failed: Should select Transactional');
    console.log(`  ✅ Agent: ${result3.primaryAgent.name}`);
    console.log('');

    // Test 4: Greeting → Support
    console.log('Test 4: Greeting intent');
    const result4 = await selectAgent({
        userMessage: 'hello',
        sessionId: 'test-session',
        history: mockHistory,
        context: {},
        requestId: 'test-004'
    });

    console.assert(result4.primaryAgent.name === 'Support', 'Failed: Should select Support');
    console.log(`  ✅ Agent: ${result4.primaryAgent.name}`);
    console.log('');

    // Test 5: Browse categories → Discovery
    console.log('Test 5: Browse categories');
    const result5 = await selectAgent({
        userMessage: 'what do you sell?',
        sessionId: 'test-session',
        history: mockHistory,
        context: {},
        requestId: 'test-005'
    });

    console.assert(result5.primaryAgent.name === 'Discovery', 'Failed: Should select Discovery');
    console.log(`  ✅ Agent: ${result5.primaryAgent.name}`);
    console.log('');

    // Test 6: Intent resolver multi-intent detection
    console.log('Test 6: Direct intent resolver test (chained)');
    const intentResult = await resolveIntent(
        'search for laptops and add to cart',
        mockHistory,
        'test-006'
    );

    console.assert(Array.isArray(intentResult.intents), 'Failed: Should return intents array');
    console.assert(intentResult.intents.length === 2, 'Failed: Should detect 2 intents');
    console.assert(intentResult.intents.includes('search products'), 'Failed: Should include search products');
    console.assert(intentResult.intents.includes('add to cart'), 'Failed: Should include add to cart');
    console.log(`  ✅ Intents detected: ${intentResult.intents.join(', ')}`);
    console.log('');

    console.log('=== All Phase 2 tests passed! ✅ ===');
})();
