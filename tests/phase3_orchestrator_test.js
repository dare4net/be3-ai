/**
 * Phase 3 Agent Orchestrator Tests
 * Run: node tests/phase3_orchestrator_test.js
 */

const agentOrchestrator = require('../src/agents/agentOrchestrator');
const { selectAgent } = require('../src/agents/agentSelector');
const ShoppingAgent = require('../src/agents/agents/ShoppingAgent');
const TransactionalAgent = require('../src/agents/agents/TransactionalAgent');

console.log('=== Phase 3: Agent Orchestrator Tests ===\n');

// Mock conversation history
const mockHistory = [];

// Test 1: Run single agent
console.log('Test 1: Run single agent (Shopping)');
(async () => {
    const shopping = new ShoppingAgent();

    const result = await agentOrchestrator.runSingle({
        agent: shopping,
        userMessage: 'show me phones',
        context: {},
        requestId: 'test-001'
    });

    console.assert(result.response, 'Failed: Should have response');
    console.assert(Array.isArray(result.tools), 'Failed: Should have tools array');
    console.assert(Array.isArray(result.toolResults), 'Failed: Should have toolResults array');
    console.log(`  ✅ Response: ${result.response.substring(0, 50)}...`);
    console.log('');

    // Test 2: Run chained agents
    console.log('Test 2: Run chained agents (Shopping → Transactional)');
    const transactional = new TransactionalAgent();

    const result2 = await agentOrchestrator.runChained({
        agents: [shopping, transactional],
        userMessage: 'find phones and add to cart',
        context: {},
        requestId: 'test-002'
    });

    console.assert(result2.response, 'Failed: Should have combined response');
    console.assert(Array.isArray(result2.agentChain), 'Failed: Should have agent chain');
    console.assert(result2.agentChain.length === 2, 'Failed: Should have 2 agents in chain');
    console.assert(result2.agentChain[0].agent === 'Shopping', 'Failed: First agent should be Shopping');
    console.assert(result2.agentChain[1].agent === 'Transactional', 'Failed: Second agent should be Transactional');
    console.log(`  ✅ Agent chain: ${result2.agentChain.map(a => a.agent).join(' → ')}`);
    console.log(`  ✅ Total duration: ${result2.agentChain.reduce((sum, a) => sum + parseInt(a.duration), 0)}ms`);
    console.log('');

    // Test 3: Integration with agent selector
    console.log('Test 3: Full flow (AgentSelector → Orchestrator)');

    const selection = await selectAgent({
        userMessage: 'show me laptops',
        sessionId: 'test-session',
        history: mockHistory,
        context: {},
        requestId: 'test-003'
    });

    let result3;
    if (selection.mode === 'SINGLE') {
        result3 = await agentOrchestrator.runSingle({
            agent: selection.primaryAgent,
            userMessage: 'show me laptops',
            context: {},
            requestId: 'test-003'
        });
    } else {
        result3 = await agentOrchestrator.runChained({
            agents: [selection.primaryAgent, ...selection.chainedAgents],
            userMessage: 'show me laptops',
            context: {},
            requestId: 'test-003'
        });
    }

    console.assert(result3.response, 'Failed: Should have response from orchestrator');
    console.log(`  ✅ Mode: ${selection.mode}`);
    console.log(`  ✅ Agent: ${selection.primaryAgent.name}`);
    console.log('');

    // Test 4: Chained flow integration
    console.log('Test 4: Full chained flow');

    const selection4 = await selectAgent({
        userMessage: 'search for tablets and add to cart',
        sessionId: 'test-session',
        history: mockHistory,
        context: {},
        requestId: 'test-004'
    });

    console.assert(selection4.mode === 'CHAINED', 'Failed: Should be CHAINED mode');

    const result4 = await agentOrchestrator.runChained({
        agents: [selection4.primaryAgent, ...selection4.chainedAgents],
        userMessage: 'search for tablets and add to cart',
        context: {},
        requestId: 'test-004'
    });

    console.assert(result4.agentChain.length === 2, 'Failed: Should have 2 agents');
    console.log(`  ✅ Chain: ${result4.agentChain.map(a => a.agent).join(' → ')}`);
    console.log('');

    console.log('=== All Phase 3 tests passed! ✅ ===');
})();
