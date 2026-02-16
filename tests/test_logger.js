/**
 * Test script for Logger utility
 * Run: node tests/test_logger.js
 */

const Logger = require('../src/utils/logger');

console.log('=== Logger Test Suite ===\n');

// Test 1: Basic logging
console.log('Test 1: Basic logging with different levels');
const testLogger = new Logger('TEST');

testLogger.info('This is an info message', { requestId: 'test-001' });
testLogger.warn('This is a warning', { requestId: 'test-001', detail: 'Something to watch' });
testLogger.error('This is an error', { requestId: 'test-001', error: 'Something went wrong' });
testLogger.debug('This is a debug message (may not show)', { requestId: 'test-001' });

console.log('\n');

// Test 2: Multiple loggers (different categories)
console.log('Test 2: Multiple logger categories');
const intentLogger = new Logger('IntentResolver');
const agentLogger = new Logger('AgentSelector');
const toolLogger = new Logger('ToolSelector');

intentLogger.info('Resolving user intent', { requestId: 'req-123', message: 'show me phones' });
agentLogger.info('Agent selected', { requestId: 'req-123', agent: 'Shopping' });
toolLogger.info('Tools selected', { requestId: 'req-123', tools: ['product.search'] });

console.log('\n');

// Test 3: Logging without requestId
console.log('Test 3: Logging without request ID');
testLogger.info('System startup', { component: 'server' });

console.log('\n');

// Test 4: Rich data objects
console.log('Test 4: Rich data objects');
testLogger.info('Complex operation completed', {
    requestId: 'req-456',
    agentChain: ['Shopping', 'Transactional'],
    toolCount: 5,
    duration: '1.2s'
});

console.log('\n=== All tests complete ===');
