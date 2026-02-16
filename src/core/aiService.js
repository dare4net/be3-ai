require('dotenv').config();
const { OpenAI } = require("openai");

const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;
const MODEL_ID = "openai/gpt-oss-20b"; // Using OSS 20B model as requested

const client = new OpenAI({
    baseURL: "https://router.huggingface.co/v1",
    apiKey: HF_TOKEN,
});

/**
 * Call Hugging Face Inference API via OpenAI SDK
 */
async function queryAI(messages, maxTokens = 512, temperature = 0.7, retries = 2, extraParams = {}) {
    for (let i = 0; i <= retries; i++) {
        try {
            console.log(`[AI] Querying Model: ${MODEL_ID} (Attempt ${i + 1}, maxTokens: ${maxTokens})...`);

            const completion = await client.chat.completions.create({
                model: MODEL_ID,
                messages: messages,
                max_tokens: maxTokens,
                temperature: temperature,
                ...extraParams  // response_format goes here
            });

            const aiResponse = completion.choices[0].message.content;
            console.log(`[AI] QueryAI Success: Got ${aiResponse.length} characters.`);

            // PHASE 5: Full response logging for debugging
            console.log('[AI] === FULL AI RESPONSE START ===');
            console.log(aiResponse);
            console.log('[AI] === FULL AI RESPONSE END ===');

            return aiResponse || "";
        } catch (err) {
            const isRateLimit = err.message.toLowerCase().includes('rate limit') ||
                err.message.toLowerCase().includes('429') ||
                err.message.toLowerCase().includes('subscribe to pro');

            if (i < retries && (isRateLimit || err.message.includes('timeout') || err.message.includes('socket'))) {
                const waitTime = Math.pow(2, i) * 1000;
                console.warn(`[AI] Error: ${err.message}. Retrying in ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            console.error("AI API Error:", err.message);
            throw new Error(`Failed to communicate with AI model: ${err.message}`);
        }
    }
}

module.exports = {
    queryAI,
    MODEL_ID,
    client
};
