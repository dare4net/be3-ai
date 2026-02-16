/**
 * Intent Resolver - PHASE 5 FIXED
 * Returns SPECIFIC intents, never category names
 */

const { queryAI } = require('./aiService');
const Logger = require('../utils/logger');

const logger = new Logger('IntentResolver');

// Chained intent patterns
const CHAINED_PATTERNS = [
    { pattern: /find.*and add.*cart/i, intents: ['search products', 'add to cart'] },
    { pattern: /search.*and add.*cart/i, intents: ['search products', 'add to cart'] },
    { pattern: /show.*and add.*cart/i, intents: ['search products', 'add to cart'] },
    { pattern: /get.*and checkout/i, intents: ['search products', 'checkout'] }
];

async function resolveIntent(userMessage, conversationHistory = [], requestId = 'N/A') {
    logger.info('Resolving intent', { requestId, message: userMessage });

    // Check chained patterns
    for (const { pattern, intents } of CHAINED_PATTERNS) {
        if (pattern.test(userMessage)) {
            logger.info('Chained intent detected', { requestId, intents });
            return {
                intents,
                confidence: 0.9,
                reason: 'Chained action detected',
                advice: `Execute ${intents.length} agents in sequence`
            };
        }
    }

    // Single intent resolution
    const systemPrompt = `You are the Intent Resolver for Be3 Store.
Classify the user's message into ONE specific intent from this list:

search products, search in category, filter results, sort results,
select product, get product details, compare products, get product images,
browse categories, select category, exploration,
add to cart, view cart, remove from cart, update cart, clear cart, checkout,
view orders, view order history,
search specific vendor, list vendors, get vendor info, browse vendor products,
greeting, thank user, clarification, unknown, farewell

RULES:
- Return ONLY a specific intent from the list (e.g., "search products")
- NEVER return category names like "SHOPPING" or "TRANSACTIONAL"
- "show me X", "find X", "cheap X" = "search products"

EXAMPLES:
"Show me phones" → "search products"
"Cheap smartphones" → "search products"  
"What do you sell?" → "browse categories"
"Hello" → "greeting"

OUTPUT (JSON only):
{
  "intent": "specific intent from list",
  "confidence": 0.9,
  "reason": "brief explanation",
  "alternate_intents": [],
  "clarification_needed": false,
  "advice": "actionable guidance"
}`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
    ];

    try {
        const response = await queryAI(messages, 256, 0.2);
        const jsonMatch = response.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            return { intents: ['unknown'], confidence: 0.3, reason: 'No JSON', advice: 'Clarify' };
        }

        const result = JSON.parse(jsonMatch[0]);
        result.intents = [result.intent];

        logger.info('Intent analysis complete', {
            requestId,
            intents: result.intents,
            confidence: result.confidence
        });

        return result;
    } catch (error) {
        logger.error('Intent resolution failed', { requestId, error: error.message });
        return { intents: ['unknown'], confidence: 0.3, reason: 'Error', advice: 'Fallback' };
    }
}

module.exports = { resolveIntent };
