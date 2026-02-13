/**
 * conversationalDetector.js
 * 
 * Utility to detect if a message is primarily conversational/social
 * vs. transactional/action-oriented.
 */

/**
 * Detects if a message is primarily conversational
 * Returns an analysis object with flags
 * 
 * @param {string} message - The user's raw message
 * @param {object} classification - The initial intent classification
 * @returns {object} { isConversational, isPurelyConversational, isDismissal }
 */
const { queryAI } = require('../core/aiService');

/**
 * Detects if a message is primarily conversational using Hybrid (Regex + AI) approach
 * Returns an analysis object with flags
 * 
 * @param {string} message - The user's raw message
 * @param {object} classification - The initial intent classification
 * @returns {Promise<object>} { isConversational, isPurelyConversational, isDismissal }
 */
async function detectConversationalIntent(message, classification) {
    if (!message) return { isConversational: false, isPurelyConversational: false, isDismissal: false };

    const lowerMsg = message.toLowerCase().trim();

    // 1. Dismissal Patterns (User rejecting a suggestion)
    const dismissalPatterns = [
        /^(no|nope|nah|nay|not now|don't|stop)/i,
        /don'?t (worry|bother|need)/i,
        /i'?m (good|fine|ok)/i,
        /maybe later/i,
        /change (of|my) mind/i,
        /nevermind/i
    ];

    const isDismissal = dismissalPatterns.some(p => p.test(lowerMsg));

    // 2. Fast Regex Patterns (Social interaction)
    const socialPatterns = [
        /^(hey|hi|hello|yo|sup|hii+|heya|greetings)/i,
        /(love you|miss you|baby|babe|sweetie|honey|dear)/i,
        /(how are you|what'?s up|wassup|doing good)/i,
        /(good morning|good night|good afternoon|good evening)/i,
        /(thanks|thank you|appreciate|thx|ty)/i,
        /(lol|haha|lmao|rofl|😂|😊|❤️|😍|😘)/i,
        /(cool|nice|awesome|great|wow|sweet)/i,
        /(love|like) (the|your) (way|style|vibe|energy|voice|speak)/i,
        /you (are|re) (so|very|really)? ?(cool|nice|awesome|sweet|funny|smart|helpful|kind)/i,
        /^ok$/i,
        /^okay$/i
    ];

    const regexMatch = socialPatterns.some(p => p.test(lowerMsg));

    // 3. Length Check
    const isShort = lowerMsg.split(/\s+/).length <= 3;

    let isPurelyConversational = false;

    // Fast Path: If regex matches or very short, trust it to save latency
    if (regexMatch || (isShort && classification.intent === 'fallback_unknown')) {
        isPurelyConversational = true;
    }
    // AI Fallback: If not obvious, but confidence is low or ambiguous, ask AI
    else if (!isDismissal && classification.confidence < 0.85) {
        try {
            const prompt = [
                { role: "system", content: "You are a classifier. Is the user's message PURELY conversational/social/complimentary? Respond with JSON: { \"is_conversational\": boolean }" },
                { role: "user", content: `Message: "${message}"\nContext: Classified as ${classification.intent}` }
            ];
            const response = await queryAI(prompt, 64, 1); // 1 retry, fast
            const start = response.indexOf('{');
            const end = response.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
                const json = JSON.parse(response.substring(start, end + 1));
                if (json.is_conversational) {
                    isPurelyConversational = true;
                    // console.log(`[ConversationalDetector] AI flagged as conversational: "${message}"`);
                }
            }
        } catch (e) {
            console.error("[ConversationalDetector] AI check failed:", e.message);
        }
    }

    // Override if dismissal
    if (isDismissal) isPurelyConversational = false;

    return {
        isConversational: regexMatch || isPurelyConversational || isDismissal,
        isPurelyConversational,
        isDismissal
    };
}

/**
 * Detects if the user wants to resume a previous context
 */
function isResumeRequest(message) {
    const resumePatterns = [
        /back to (the |those |that )?(.+)/i,
        /go back/i,
        /continue (with |from )?/i,
        /resume/i,
        /next/i,
        /go on/i,
        /proceed/i,
        /what were we (looking at|talking about)/i,
        /where were we/i,
        /return to/i
    ];

    return resumePatterns.some(pattern => pattern.test(message));
}

module.exports = { detectConversationalIntent, isResumeRequest };
