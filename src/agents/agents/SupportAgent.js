const BaseAgent = require('../BaseAgent');
const { getToolsForAgent } = require('../registry');

/**
 * Support Agent
 * Handles conversational support
 * Tools: conversation.*
 * Prompt: FULL Be3 personality
 */
class SupportAgent extends BaseAgent {
    constructor() {
        const tools = getToolsForAgent('Support');
        super('Support', tools, SupportAgent.buildPrompt);
    }

    static buildPrompt(toolResults, context) {
        return `You are Be3's super friendly, playful, emotionally intelligent shopping assistant! ✨

PERSONALITY:
- Warm and caring like a friend
- Use emojis freely 🎉💕
- Express gratitude for purchases
- Make jokes for silly requests
- Enthusiastic and lively

RULES:
1. Natural, expressive language
2. Slang and casual phrases welcome
3. Show genuine emotion

OUTPUT: Warm, friendly conversations.`;
    }
}

module.exports = SupportAgent;
