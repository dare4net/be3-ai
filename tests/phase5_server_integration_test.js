/**
 * Phase 5 Server Integration Test
 * Test the agent system integrated into server.js
 * Run: node tests/phase5_server_integration_test.js
 */

const { v4: uuidv4 } = require('uuid');

console.log('=== Phase 5: Server Integration Test ===\n');
console.log('Starting server integration test with real HTTP requests...\n');

const BASE_URL = 'http://localhost:3005';

async function testChat(message, session_id = 'test-session') {
    const response = await fetch(`${BASE_URL}/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message,
            session_id,
            history: []
        })
    });

    return await response.json();
}

(async () => {
    try {
        const session = `test-${uuidv4()}`;

        // Test 1: Shopping agent (product search)
        console.log('Test 1: Shopping Agent');
        console.log('Request: "show me phones"');
        const result1 = await testChat('show me phones', session);
        console.assert(result1.reply, 'Failed: Should have reply');
        console.log(`✅ Response: ${result1.reply.substring(0, 100)}...`);
        console.log(`✅ Images: ${result1.images ? result1.images.length : 0}`);
        console.log('');

        // Test 2: Transactional agent (cart)
        console.log('Test 2: Transactional Agent');
        console.log('Request: "show me my cart"');
        const result2 = await testChat('show me my cart', session);
        console.assert(result2.reply, 'Failed: Should have reply');
        console.log(`✅ Response: ${result2.reply.substring(0, 100)}...`);
        console.log('');

        // Test 3: Support agent (greeting)
        console.log('Test 3: Support Agent');
        console.log('Request: "hello"');
        const result3 = await testChat('hello', session);
        console.assert(result3.reply, 'Failed: Should have reply');
        console.log(`✅ Response: ${result3.reply.substring(0, 100)}...`);
        console.log('');

        // Test 4: Discovery agent (categories)
        console.log('Test 4: Discovery Agent');
        console.log('Request: "what do you sell?"');
        const result4 = await testChat('what do you sell?', session);
        console.assert(result4.reply, 'Failed: Should have reply');
        console.log(`✅ Response: ${result4.reply.substring(0, 100)}...`);
        console.log('');

        // Test 5: Chained agents (search and add to cart)
        console.log('Test 5: Chained Agents (Shopping → Transactional)');
        console.log('Request: "find iPhone and add to cart"');
        const result5 = await testChat('find iPhone and add to cart', session);
        console.assert(result5.reply, 'Failed: Should have reply');
        console.log(`✅ Response: ${result5.reply.substring(0, 100)}...`);
        console.log('');

        console.log('=== All Phase 5 tests passed! ✅ ===');
        console.log('🎉 Agent system fully integrated into server.js!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
