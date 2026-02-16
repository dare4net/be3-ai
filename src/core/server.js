require('dotenv').config();
const express = require('express');
const { queryAI, MODEL_ID } = require('./aiService');
const { getIntentClassificationPrompt } = require('../legacy/intents');
const { executeIntent } = require('../legacy/handlers');
const { resolveClauses } = require('../utils/clauseResolver');
const { CATEGORIES, VENDORS, CATEGORY_INVENTORY, ATTRIBUTES, COLLECTIONS, getContextSummary } = require('../context/storeContext');
const { evaluateContextSufficiency } = require('../middleware/contextEvaluator');
const stateManager = require('../state/stateManager');
const redisClient = require('../state/redis');
const cors = require('cors');
const { isConfirmation, isImplicitReference, extractSuggestion, checkSuggestionAcknowledgement } = require('../middleware/suggestionHelper');
const { detectConversationalIntent, isResumeRequest } = require('../middleware/conversationalDetector');
const { trackRequest, getMetrics, getMetricsSummary } = require('../utils/metrics');
const { FEATURES, shouldUseToolSystem } = require('../middleware/featureFlags');
const { injectImages } = require('../utils/imageInjector');
const { selectTools } = require('./toolSelector');
const { executeTools } = require('./orchestrator');
const { getMainSystemPrompt, getToolSystemPrompt, getLogicSystemPrompt, getPersonalityRewritePrompt } = require('./personalities');
const fs = require('fs');

function logStep(msg) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${msg}`;
    console.log(entry); // Log to console for user visibility
    try {
        fs.appendFileSync('ai_steps.log', `${entry}\n`);
    } catch (e) {
        console.error(`[LogStep] Failed to write to log file: ${e.message}`);
    }
}

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3005;



/**
 * Stage 1: Classify user intent
 */
async function classifyIntent(userMessage, conversationHistory = []) {
    let classificationPrompt;

    if (FEATURES.contextIntegration) {
        // Enriched context classification
        classificationPrompt = getIntentClassificationPrompt(CATEGORIES, VENDORS, ATTRIBUTES, COLLECTIONS);
    } else {
        // Legacy simplified classification
        const categories = Object.values(CATEGORIES).map(c => c.label);
        const vendors = Object.values(VENDORS).map(v => v.label);
        classificationPrompt = getIntentClassificationPrompt(categories, vendors);
    }

    // Build messages for classification (only last 3 for context to avoid distractions)
    const messages = [
        { role: "system", content: classificationPrompt },
        ...conversationHistory.slice(-3).map(h => ({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        })),
        { role: "user", content: userMessage }
    ];

    const response = await queryAI(messages, 256);
    console.log(`[AI] Classification response:`, response);

    // Parse JSON response
    try {
        // Try to extract JSON from response
        let jsonStr = response.trim();

        // If response has markdown code blocks, extract the JSON
        if (jsonStr.includes('```json')) {
            const match = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
            if (match) jsonStr = match[1];
        } else if (jsonStr.includes('```')) {
            const match = jsonStr.match(/```\s*([\s\S]*?)\s*```/);
            if (match) jsonStr = match[1];
        }

        // Find JSON object in the response (handle nested or multiple blocks)
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        }

        // Clean any potential trailing characters or comments AI might have added
        jsonStr = jsonStr.substring(jsonStr.indexOf('{'), jsonStr.lastIndexOf('}') + 1);

        const classification = JSON.parse(jsonStr);

        return {
            intent: classification.intent || 'fallback_unknown',
            params: classification.params || {},
            confidence: classification.confidence !== undefined ? classification.confidence : 0.5
        };
    } catch (error) {
        console.error('[AI] Failed to parse classification:', error.message);
        console.error('[AI] Response received:', response);

        // Fallback to unknown intent
        return {
            intent: 'fallback_unknown',
            params: {},
            confidence: 0.0
        };
    }
}

/**
 * Stage 3: Generate natural language response from handler result
 */
async function generateResponse(userMessage, handlerResult, conversationHistory = []) {
    // SPECIAL HANDLING FOR UNKNOWN INTENT - Last Chance at Conversation
    if (handlerResult.intent === 'fallback_unknown' || (handlerResult.confidence && handlerResult.confidence < 0.5)) {
        console.log(`[Unknown Recovery] Attempting to recover unknown intent with conversation context`);

        // Build context from recent conversation
        const contextualInfo = {
            conversation_history: conversationHistory.slice(-3).map(h => `${h.role}: ${h.text}`)
        };

        // Only attempt recovery if there's meaningful conversation history
        if (conversationHistory.length > 0) {
            const recoveryMessages = [
                {
                    role: "system",
                    content: `You are a super friendly, playful, and CUTE shopping assistant for the Be3 store. ✨👋

PERSONALITY:
- Vibe: Super warm, chatty, and enthusiastic! We are a small, passionate team, not a corporate bot.
- Tone: Casual and fun. Use 1-2 emojis per message to keep it light. 💖
- Language: meaningful, short, and sweet. Avoid "I am here to assist you" -> say "I'd love to help!"

CRITICAL: The user's message was classified as "unknown", but it might relate to your recent conversation.

CONTEXT RECOVERY STRATEGY:
1. Check if the message relates to products you recently discussed
2. Check if it's a follow-up question about the last search
3. Check if it's a casual acknowledgment ("cool", "nice", "okay", "thanks")
4. If it relates to context, answer naturally
5. ONLY say "I'm not sure what you mean" if it's truly unrelated

IMPORTANT:
- Prioritize CONVERSATION over products.
- DO NOT invent or suggest products that are not in the context.
- If you don't know if a product exists, do NOT mention it.

Recent conversation:
${JSON.stringify(contextualInfo, null, 2)}

EXAMPLES OF RECOVERABLE "UNKNOWNS":
- "What about the battery?" → Relates to last product shown
- "That's cool" → Casual acknowledgment, respond warmly
- "How much?" → Asking about price of current product
- "Any other colors?" → Asking about product variations
- "Thanks" → Acknowledge appreciation

If you CAN relate this to the context, answer naturally.
If you CANNOT relate it to anything, then say: "I'm not sure what you mean. Can you rephrase that?"`
                },
                ...conversationHistory.slice(-5).map(h => ({
                    role: h.role === 'ai' ? 'assistant' : 'user',
                    content: h.text
                })),
                {
                    role: "user",
                    content: userMessage
                }
            ];

            try {
                const recoveryResponse = await queryAI(recoveryMessages, 256);

                // If the AI successfully recovered, return that response
                if (recoveryResponse &&
                    !recoveryResponse.toLowerCase().includes("not sure what you mean") &&
                    !recoveryResponse.toLowerCase().includes("don't understand")) {
                    console.log(`[Unknown Recovery] Successfully recovered unknown intent!`);
                    return recoveryResponse.trim();
                }

                // Otherwise, fall through to default unknown handling
                console.log(`[Unknown Recovery] Could not recover, using default unknown response`);
            } catch (error) {
                console.error('[Unknown Recovery] Recovery attempt failed:', error.message);
            }
        }
    }

    // If handler returned an error, format it nicely
    if (handlerResult.error) {
        return `I'm sorry, but ${handlerResult.error}`;
    }

    // NEW: DATA-FIRST CONTEXT GROUNDING (Phase 2)
    // If the answer was found in context without an API call
    if (handlerResult.source === 'context') {
        const contextData = handlerResult.context_data;
        console.log(`[Response Generation] Using context grounding for ${contextData.type}`);

        let contextInstruction = `You are a super friendly, playful, and CUTE shopping assistant for the Be3 store. ✨👋
        
PERSONALITY:
- Vibe: Super warm, chatty, and enthusiastic!
- Tone: Casual and fun. Use 1-2 emojis. 🌟
- Language: Simple and direct. No "service bot" speak.

CRITICAL: You are answering this question using STORE METADATA (static context). 
NO API call was made to the backend.

- BE ACCURATE: Always use the "count" and "exists" fields from the Context Data below.
- BE HONEST: If count is 0, say we don't have it. If count is 10, say we have 10.
- BE PROACTIVE: If alternatives are provided in "suggested_alternatives" or "subcategories", suggest them.
- FOCUS: Use the "Context Data" ONLY. Use the "Store Summary" only for general brand personality.

Context Data for this SPECIFIC query: ${JSON.stringify(contextData)}
Detailed Store Summary (Reference only): ${JSON.stringify(getContextSummary())}`;

        const contextMessages = [
            { role: "system", content: contextInstruction },
            ...conversationHistory.slice(-5).map(h => ({
                role: h.role === 'ai' ? 'assistant' : 'user',
                content: h.text
            })),
            { role: "user", content: userMessage }
        ];

        try {
            return await queryAI(contextMessages, 512);
        } catch (error) {
            console.error('[Response Generation] Context response failed:', error);
            return "I'm looking at our store information right now, and it seems we don't have that specific item in stock. Would you like to see something similar?";
        }
    }

    // If intent is fallback_unknown or greeting, allow full conversational freedom
    if ((handlerResult.intent === 'fallback_unknown' && !handlerResult.error) || handlerResult.intent === 'greeting') {
        const messages = [
            {
                role: "system",
                content: `You are a super friendly, playful, and CUTE shopping assistant for the Be3 store. ✨👋
                
PERSONALITY:
- Vibe: Super warm, chatty, and enthusiastic! We are a small, passionate team.
- Tone: Casual and fun. Use 1-2 emojis where they fit naturally. 💖
- Language: Avoid "I am your assistant". Say "I'm here for you!" or "Let's find something cool!"

The user just sent a conversational message. Respond naturally and warmly!
You can:
- Chat casually and be personable
- Gently suggest products ONLY if clearly relevant
- Keep the conversation flowing

DON'T force a product search unless they explicitly ask. Be human-like and engaging. DO NOT invent products.`
            },
            ...conversationHistory.slice(-5).map(h => ({
                role: h.role === 'ai' ? 'assistant' : 'user',
                content: h.text
            })),
            { role: "user", content: userMessage }
        ];

        try {
            const response = await queryAI(messages, 512);
            if (response) return response.trim();
        } catch (e) {
            console.error('[AI] Conversational response failed:', e);
        }
    }

    // If handler already has a formatted message, use it
    if (handlerResult.message) {
        // If there's additional data, ask AI to format it nicely
        if (handlerResult.products || handlerResult.items || handlerResult.orders || handlerResult.product || handlerResult.recent_products || handlerResult.advice || handlerResult.help_menu || handlerResult.store_name || handlerResult.rotation_context) {

            let contextGrounding = "";
            if (FEATURES.contextIntegration) {
                const summary = getContextSummary();
                contextGrounding = `\nSTORE CONTEXT SUMMARY:\n${JSON.stringify(summary, null, 2)}\n`;
            }

            const dataContext = JSON.stringify(handlerResult, null, 2);

            const messages = [
                {
                    role: "system",
                    content: getMainSystemPrompt(contextGrounding)
                },
                ...conversationHistory.slice(-10).map(h => ({
                    role: h.role === 'ai' ? 'assistant' : 'user',
                    content: h.text
                })),
                {
                    role: "user",
                    content: `User asked: "${userMessage}"\n\nData to present:\n${dataContext}\n\nProvide a consultative, friendly "Be3" response based on the data and your knowledge:`
                }
            ];

            try {
                // Increased max tokens and slightly higher temperature for better reasoning
                const response = await queryAI(messages, 1024, 0.2);
                if (!response) return handlerResult.message;
                return response.trim();
            } catch (error) {
                console.error('[Stage 4] AI Generation failed:', error.message);
                return handlerResult.message;
            }
        }
        return handlerResult.message;
    }

    // Fallback: just stringify the result
    return JSON.stringify(handlerResult);
}

/**
 * Detect if the user wants to see images
 */
function detectImageIntent(message, toolResults) {
    const msg = message.toLowerCase();

    // Explicit image requests
    if (msg.includes('show') || msg.includes('see') || msg.includes('picture') ||
        msg.includes('photo') || msg.includes('image') || msg.includes('look like')) {
        return true;
    }

    // Product detail requests (likely want to see it)
    if (msg.includes('tell me more') || msg.includes('details about') || msg.includes('what about')) {
        return true;
    }

    // First-time product discovery (not repeat browsing)
    const hasProducts = toolResults.some(r => r.result && (r.result.products || r.result.results));
    if (hasProducts) {
        // Check if this is a "list" or "browse" query (show images)
        if (msg.includes('what do you have') || msg.includes('show me') || msg.includes('need')) {
            return true;
        }
    }

    // Default: Don't send images for general q&a, cart ops, order ops, etc.
    return false;
}

/**
 * Normalize string for comparison (remove spaces, symbols, lowercase)
 */
function normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Extract only images of products mentioned in the AI response
 */
async function extractMentionedProductImages(aiResponse, toolResults, sessionId) {
    const images = [];
    const responseText = aiResponse.toLowerCase();

    // Get all products from tool results
    const allProducts = [];
    for (const tr of toolResults) {
        if (tr.result) {
            // Handle arrays (products, results)
            if (tr.result.products || tr.result.results) {
                const products = tr.result.products || tr.result.results;
                allProducts.push(...products);
            }
            // Handle single product object (from product.getDetails)
            else if (tr.result.product) {
                allProducts.push(tr.result.product);
            }
            // Handle if the result itself is a product
            else if (tr.result.id && (tr.result.name || tr.result.title)) {
                allProducts.push(tr.result);
            }
        }
    }

    // Find IDs in the response text using the (#ID) pattern
    const idMatches = aiResponse.match(/\(#([a-z0-9-]+)\)/gi) || [];
    const extractedIds = idMatches.map(m => m.replace(/[()#]/g, '').toLowerCase());

    const mentionedProducts = allProducts.filter(p => {
        const pid = (p.id || '').toLowerCase();
        // Direct ID match from regex
        if (extractedIds.includes(pid)) return true;

        // Fallback: Name matching (if AI forgot the ID)
        const fullName = normalizeString(p.name || p.title || '');
        return normalizeString(aiResponse).includes(fullName);
    });

    // Debugging: Identify which extracted IDs didn't find a product
    const matchedIds = mentionedProducts.map(p => (p.id || '').toLowerCase());
    const missingIds = extractedIds.filter(id => !matchedIds.includes(id));
    if (missingIds.length > 0) {
        console.warn(`[Image Filter] ⚠️ Could not find products for extracted IDs: ${missingIds.join(', ')}`);
    }

    console.log(`[Image Filter] Found ${allProducts.length} products, AI IDs extracted: ${extractedIds}, Matched: ${mentionedProducts.length}`);

    // Extract image URLs
    for (const product of mentionedProducts) {
        const imageUrl = product.image_url || product.metadata?.image_url;
        if (imageUrl) {
            images.push({
                url: imageUrl,
                caption: product.name || product.title,
                product_id: product.id
            });
        } else {
            console.warn(`[Image Filter] ❌ ID present but image_url missing for product: ${product.id} (${product.name || product.title})`);
        }
    }

    return images.slice(0, 5); // Limit to 5 images max
}

/**
 * Generate response based on tool results (2-Layer Architecture)
 * Layer 1: Logic Engine (Strict, Grounded)
 * Layer 2: Personality Renderer (Style Only)
 */
async function generateResponseFromTools(userMessage, toolResults, conversationHistory) {
    const contextSummary = JSON.stringify(getContextSummary()).substring(0, 1000);

    // Optimize results for AI context
    const optimizedResults = toolResults.map(tr => {
        if (tr.result && (tr.result.products || tr.result.results)) {
            const rawProducts = tr.result.products || tr.result.results;
            return {
                ...tr,
                result: {
                    ...tr.result,
                    products: rawProducts.map(p => ({
                        id: p.id,
                        name: p.name || p.title,
                        price: p.price,
                        description: p.description ? (p.description.substring(0, 150) + '...') : null,
                        attributes: p.attributes || p.metadata?.attributes || {},
                        categories: p.metadata?.category_names || [],
                        vendor: p.tags?.[0] || p.metadata?.tags?.[0] || 'Be3 Store',
                        in_stock: (p.inventory_quantity ?? 1) > 0,
                        whatsapp_link: p.whatsapp_link, // Critical for 2-layer
                        checkout_url: p.checkout_url    // Critical for 2-layer
                    }))
                }
            };
        }
        return tr;
    });

    const resultsSummary = JSON.stringify(optimizedResults, null, 2);

    // --- LAYER 1: LOGIC ENGINE (Strict Grounding) ---
    console.log('[AI] Executing Layer 1: Logic Engine 🧠');
    const logicMessages = [
        {
            role: "system",
            content: getLogicSystemPrompt(contextSummary, resultsSummary)
        },
        { role: "user", content: userMessage }
    ];

    let safeOutput = "";
    try {
        safeOutput = await queryAI(logicMessages, 512, 0.1); // Low temp for facts
        if (!safeOutput) throw new Error("Empty response from Logic Engine");
    } catch (error) {
        console.error('[AI] Layer 1 Failed:', error);
        return "I'm having trouble connecting to the logic engine.";
    }

    console.log('[AI] Layer 1 Output (Safe):', safeOutput.substring(0, 100) + '...');

    // --- LAYER 2: PERSONALITY RENDERER (Style Rewrite) ---
    console.log('[AI] Executing Layer 2: Personality Renderer 🎨');
    const styleMessages = [
        {
            role: "system",
            content: getPersonalityRewritePrompt(safeOutput)
        },
        { role: "user", content: safeOutput }
    ];

    try {
        // Higher temp for creativity, but constrained by the input data
        const styledResponse = await queryAI(styleMessages, 1024, 0.6);
        return styledResponse || safeOutput; // Fallback to safe output if styling fails
    } catch (error) {
        console.error('[AI] Layer 2 Failed:', error);
        return safeOutput; // Fallback to safe output
    }
}

/**
 * Main chat endpoint - State-aware two-stage intent processing
 */
app.post('/chat', async (req, res) => {
    const { message, session_id, history = [] } = req.body;
    console.log(`\n[Chat] Received from ${session_id}: "${message}"`);

    // ADMIN: Clear Cache Command
    if (message.trim() === '.clearcache') {
        console.log(`[Admin] Clearing cache for ${session_id}`);
        await stateManager.clearState(session_id);

        // Also clear the cart in the main backend
        try {
            const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3000';
            const clearCartUrl = `${backendUrl}/cart?session_id=${session_id}`;
            console.log(`[Admin] Clearing backend cart: ${clearCartUrl}`);

            // Use fetch (Node 18+)
            await fetch(clearCartUrl, {
                method: 'DELETE',
                headers: { 'X-Tenant-ID': process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713' }
            });
        } catch (error) {
            console.error('[Admin] Failed to clear backend cart:', error.message);
        }

        return res.json({
            success: true,
            reply: "Cache cleared! 🧹 All session state, cart, and history have been reset."
        });
    }

    try {
        const startTime = Date.now();

        // Check if we should use the new Tool System
        if (shouldUseToolSystem(session_id)) {
            console.log(`[Server] Routing session ${session_id} to AGENT SYSTEM 🤖`);

            // Generate unique request ID for logging
            const { v4: uuidv4 } = require('uuid');
            const requestId = uuidv4();

            // 1. Load State
            const state = await stateManager.getState(session_id);
            await stateManager.addMessage(session_id, 'user', message);

            // 2. PHASE 5: Agent Selection
            console.log('[Agent System] Selecting agent...');
            const { selectAgent } = require('../agents/agentSelector');

            const selection = await selectAgent({
                userMessage: message,
                sessionId: session_id,
                history: state.conversation_history,
                context: {
                    sessionId: session_id,
                    conversationHistory: state.conversation_history,
                    lastSuggestion: await stateManager.getLastSuggestion(session_id)
                },
                requestId
            });

            console.log(`[Agent System] Agent selected: ${selection.primaryAgent.name} (mode: ${selection.mode})`);

            // 3. PHASE 5: Agent Execution
            const agentOrchestrator = require('../agents/agentOrchestrator');
            let executionResult;

            if (selection.mode === 'SINGLE') {
                executionResult = await agentOrchestrator.runSingle({
                    agent: selection.primaryAgent,
                    userMessage: message,
                    context: {
                        sessionId: session_id,
                        conversationHistory: state.conversation_history,
                        lastSuggestion: await stateManager.getLastSuggestion(session_id)
                    },
                    requestId
                });
            } else {
                executionResult = await agentOrchestrator.runChained({
                    agents: [selection.primaryAgent, ...selection.chainedAgents],
                    userMessage: message,
                    context: {
                        sessionId: session_id,
                        conversationHistory: state.conversation_history,
                        lastSuggestion: await stateManager.getLastSuggestion(session_id)
                    },
                    requestId
                });
            }

            const toolResults = executionResult.toolResults || [];
            let response = executionResult.response;

            // 4. Personality Layer (ONLY for Support Agent)
            // All other agents already have specialized prompts
            if (selection.primaryAgent.name === 'Support') {
                console.log('[Agent System] Applying personality layer for Support agent...');
                const styleMessages = [
                    {
                        role: "system",
                        content: getPersonalityRewritePrompt(response)
                    },
                    { role: "user", content: response }
                ];

                try {
                    const styledResponse = await queryAI(styleMessages, 1024, 0.6);
                    response = styledResponse || response;
                } catch (error) {
                    console.error('[Agent System] Personality layer failed:', error);
                    // Keep original response
                }
            }

            // 4.5. IMAGE REINJECTION (Optimization Phase)
            // Restore images from Redis to the results so the frontend can display them
            if (toolResults.length > 0) {
                console.log('[Tool System] Reinjecting cached images...');
                await injectImages(toolResults, stateManager);
            }

            // 4.6. Intelligent Image Detection (Phase 17)
            const shouldSendImages = detectImageIntent(message, toolResults);
            const imagesToSend = shouldSendImages ? await extractMentionedProductImages(response, toolResults, session_id) : [];

            // 4.7. STEALTH SANITIZATION: Strip IDs and fix WhatsApp formatting
            // Catches: (#id), (id with min 8 chars), #id (with min 8 chars)
            const idPattern = /(\(#[a-z0-9-]+\)|\([a-z0-9-]{8,}\)|#[a-z0-9-]{8,})/gi;
            const strippedCount = (response.match(idPattern) || []).length;

            // Clean response: 
            // 1. Strip IDs 
            // 2. Convert **Bold** to *Bold* (WhatsApp best practice)
            const sanitizedResponse = response
                .replace(idPattern, '')
                .replace(/\*\*(.*?)\*\*/g, '*$1*')
                .trim();

            if (strippedCount > 0) {
                console.log(`[Sanitizer] 🧼 Stripped ${strippedCount} ID tags from response.`);
            }

            // 5. Engagement Tracking (Phase 17)
            const lastSuggestion = await stateManager.getLastSuggestion(session_id);
            if (lastSuggestion) {
                const resultsWithSuggestions = toolResults.some(r => r.result && (r.result.suggestion_type === 'recovery' || r.result.suggestions));

                // If AI selected a tool related to the last suggestion (e.g. search from category)
                const toolsUsed = executionResult.tools || [];
                const acknowledged = toolsUsed.some(t =>
                    t.tool === lastSuggestion.intent ||
                    (t.params && JSON.stringify(t.params).includes(lastSuggestion.params?.category || ''))
                );

                if (acknowledged) {
                    console.log(`[Metrics] Suggestion ACKNOWLEDGED: ${lastSuggestion.type} -> ${lastSuggestion.intent}`);
                    // You could emit this to a DB/Analytics here
                } else if (!resultsWithSuggestions) {
                    // If no new suggestion was made this turn and the user drifted to a new topic
                    console.log(`[Metrics] Suggestion ABANDONED: ${lastSuggestion.type}`);
                    await stateManager.clearLastSuggestion(session_id);
                }
            }

            // Save to history (Sanitized for user readability)
            await stateManager.addMessage(session_id, 'ai', sanitizedResponse);
            await stateManager.extendTTL(session_id);

            // FINAL RESPONSE LOGGING
            const finalPayload = {
                session_id,
                user_message: message,
                ai_reply: sanitizedResponse,
                agent: selection.primaryAgent.name,
                mode: selection.mode,
                tools_used: executionResult.tools ? executionResult.tools.map(t => t.tool) : [],
                results_count: toolResults.length
            };
            logStep(`FINAL_RESPONSE (AgentSystem): ${JSON.stringify(finalPayload, null, 2)}`);

            // Track metrics
            trackRequest('agentSystem', {
                agent: selection.primaryAgent.name,
                mode: selection.mode,
                apiCalls: toolResults.filter(r => r.result && r.result.apiCalls).length,
                responseTime: Date.now() - startTime,
                error: toolResults.some(r => !r.success),
                tools: executionResult.tools ? executionResult.tools.map(t => t.tool) : []
            });

            return res.json({
                success: true,
                reply: sanitizedResponse,
                tools_used: executionResult.tools ? executionResult.tools.map(t => t.tool) : [],
                results: toolResults,
                display_images: imagesToSend  // Smart image metadata
            });
        }

        // === LEGACY FLOW BELOW ===

        // STAGE 0: Load/Initialize State
        console.log('[Stage 0] Loading state...');
        const state = await stateManager.getState(session_id);
        console.log(`[Stage 0] State loaded. Messages: ${state.session.message_count}, Active flow: ${state.active_flow?.type || 'none'}`);

        // Add user message to history
        await stateManager.addMessage(session_id, 'user', message);

        // STAGE 1: Classify Intent (with state context)
        console.log('[Stage 1] Classifying intent...');

        // 1. Check for RESUME request
        if (isResumeRequest(message)) {
            const resumed = await stateManager.resumeContext(session_id);
            if (resumed) {
                console.log(`[Server] Resuming context: ${resumed.type}`);
                // Restore context data to state (simplification: just putting it in product_context for now)
                if (resumed.type === 'search') {
                    state.product_context = state.product_context || {};
                    state.product_context.last_search = resumed.data;
                    // Re-trigger the search display logic or just acknowledge
                    return res.json({
                        success: true,
                        reply: "Resuming your search for " + (resumed.data.query || resumed.data.category),
                        products: resumed.data.results,
                        intent: 'search_products',
                        confidence: 1.0
                    });
                }
            }
        }

        let classification = await classifyIntent(message, state.conversation_history);

        // DETECT CONVERSATIONAL INTENT
        const conversationalAnalysis = await detectConversationalIntent(message, classification);
        console.log(`[Stage 1] Conversational analysis:`, conversationalAnalysis);

        // PAUSE CONTEXT IF SWITCHING TO CONVERSATION
        if (conversationalAnalysis.isPurelyConversational && state.product_context?.last_search?.results?.length > 0) {
            // If we have active search results and user switches to chat, pause the context
            await stateManager.pauseContext(session_id, 'search', state.product_context.last_search);
        }

        // CHECK FOR REFERENCE RESOLUTION (Bot Suggestion)
        const lastSuggestion = await stateManager.getLastSuggestion(session_id);

        // If user is dismissing or just chatting, clear suggestions and don't force context switch
        if (conversationalAnalysis.isDismissal) {
            console.log(`[Stage 1] User dismissed suggestion/offer. Clearing suggestions.`);
            await stateManager.clearLastSuggestion(session_id);
            // Override classification to greeting if it was misclassified
            if (classification.intent !== 'greeting' && classification.confidence < 0.8) {
                classification = {
                    intent: 'greeting',
                    params: {},
                    confidence: 0.85
                };
            }
        }
        // Only check suggestions if NOT purely conversational
        else if (lastSuggestion && lastSuggestion.intent && !conversationalAnalysis.isPurelyConversational) {
            console.log(`[Stage 1] Checking against last suggestion: ${lastSuggestion.text} (${lastSuggestion.intent})`);

            // 1. Check for explicit confirmation ("yes", "okay")
            const confirmation = isConfirmation(message);

            // 2. Check for implicit reference ("show me", "compare")
            const implicit = isImplicitReference(message, lastSuggestion);

            let accepted = false;

            if (confirmation === 'yes' || implicit) {
                accepted = true;
            } else if (confirmation !== 'no') {
                // 3. AI Check (Fallback for ambiguous cases)
                const ackStatus = await checkSuggestionAcknowledgement(message, lastSuggestion);
                console.log(`[Stage 1] AI Acknowledgement Status: ${ackStatus}`);

                if (ackStatus === 'accepted') {
                    accepted = true;
                } else if (ackStatus === 'ignored') {
                    // User changed topic -> Clear suggestion to avoid warping
                    console.log(`[Stage 1] User ignored suggestion. Clearing context.`);
                    await stateManager.clearLastSuggestion(session_id);
                }
            }

            if (accepted) {
                console.log(`[Stage 1] Suggestion ACCEPTED! Switching intent to: ${lastSuggestion.intent}`);
                classification = {
                    intent: lastSuggestion.intent,
                    params: lastSuggestion.params,
                    confidence: 0.95
                };
                await stateManager.clearLastSuggestion(session_id);
            }
        }
        // If purely conversational, prioritize greeting intent
        else if (conversationalAnalysis.isPurelyConversational && classification.confidence < 0.75) {
            console.log(`[Stage 1] Prioritizing conversational response over weak transactional intent`);
            classification = {
                intent: 'greeting',
                params: {},
                confidence: 0.80
            };
        }

        const { intent, params, confidence } = classification;
        console.log(`[Stage 1] Intent: ${intent} (confidence: ${confidence})`);
        console.log(`[Stage 1] Params:`, params);

        // Update current intent
        await stateManager.setCurrentIntent(session_id, intent);

        // STAGE 2: Semantic Resolution (Bridge Natural Language to Canonical Logic)
        let resolvedCategory = params.category || state.product_context?.last_search?.category;

        // Fallback: If category is missing but query matches a category name, use it
        if (!resolvedCategory && params.query) {
            const queryLower = params.query.toLowerCase();
            const foundCat = Object.values(CATEGORIES).find(c => c.label.toLowerCase() === queryLower || c.slug.toLowerCase() === queryLower);
            if (foundCat) {
                resolvedCategory = foundCat.label;
                console.log(`[Stage 2] Inferred category from query: "${resolvedCategory}"`);
            }
        }

        let resolvedContext = null;
        if (intent === 'search_products' && resolvedCategory) {
            console.log(`[Stage 2] Resolving clauses for category: "${resolvedCategory}"`);
            resolvedContext = await resolveClauses(message, resolvedCategory, state.conversation_history);
            if (resolvedContext.clauses.length > 0) {
                console.log(`[Stage 2] Success! Resolved clauses: ${resolvedContext.clauses.join(', ')}`);
                await stateManager.setMicrostate(session_id, 'clause_resolution', {
                    category: resolvedCategory,
                    clauses: resolvedContext.clauses,
                    display_words: resolvedContext.display_words
                });

                // CRITICAL: Refresh the state object so Stage 3 handler sees the new microstate
                const refreshedState = await stateManager.getState(session_id);
                Object.assign(state, refreshedState);
            }
        }

        // Propagate resolved category back to params for normalization in handlers
        if (resolvedCategory && !params.category) {
            params.category = resolvedCategory;
        }

        // Enrich state with store context
        state.store_context = {
            categories: Object.values(CATEGORIES).map(c => ({ label: c.label, slug: c.slug })),
            vendors: Object.values(VENDORS).map(v => ({ name: v.business_name, tag: v.tag })),
            category_inventory: CATEGORY_INVENTORY
        };

        // NEW: AI-POWERED CONTEXT EVALUATION (Phase 2)
        const evaluation = await evaluateContextSufficiency(intent, params, message);
        console.log(`[Context Eval] Decision: ${evaluation.decision}, Reason: ${evaluation.reason}`);

        let handlerResult;
        let apiCallsMade = 1;

        if (evaluation.decision === 'sufficient') {
            handlerResult = {
                intent,
                params,
                message: '', // AI will generate
                context_data: evaluation.data,
                source: 'context',
                total: evaluation.data.count || 0
            };
            apiCallsMade = 0;
            console.log(`[Optimization] ⚡ Answered from context, skipped API call`);
        } else {
            handlerResult = await executeIntent(intent, params, session_id, state);
        }
        console.log(`[Stage 3] Handler result:`, handlerResult);

        // Reload state after handler execution (handlers may have updated it)
        const updatedState = await stateManager.getState(session_id);

        // STAGE 4: Generate Natural Response (with updated state context)
        console.log('[Stage 4] Generating response...');
        const reply = await generateResponse(message, handlerResult, updatedState.conversation_history);
        console.log(`[Stage 4] Final reply: "${reply}"\n`);

        // FINAL RESPONSE LOGGING
        const legacyPayload = {
            session_id,
            user_message: message,
            ai_reply: reply,
            intent: classification.intent,
            confidence: classification.confidence,
            source: handlerResult.source || 'api'
        };
        logStep(`FINAL_RESPONSE (Legacy): ${JSON.stringify(legacyPayload, null, 2)}`);

        // TRACK BOT SUGGESTIONS (from reply or handler result)
        const newSuggestion = extractSuggestion(reply, handlerResult);
        if (newSuggestion) {
            console.log(`[Stage 4] Extracted suggestion: "${newSuggestion.text.substring(0, 50)}..." -> Intent: ${newSuggestion.intent}`);
            await stateManager.setLastSuggestion(session_id, newSuggestion);
        }

        // Auto-clear short-lived microstates
        const currentMicro = await stateManager.getMicrostate(session_id);
        if (currentMicro && (currentMicro.type === 'clause_resolution' || currentMicro.type === 'cart_interaction')) {
            await stateManager.clearMicrostate(session_id);
        }

        // Save AI response to history
        await stateManager.addMessage(session_id, 'ai', reply, classification.intent);

        // Extend session TTL
        await stateManager.extendTTL(session_id);

        // Track metrics (all requests currently go to legacy)
        const requestDuration = Date.now() - startTime;
        trackRequest('legacy', {
            apiCalls: apiCallsMade,
            responseTime: requestDuration,
            error: false,
            optimizationHit: apiCallsMade === 0
        });

        res.json({
            success: true,
            ...handlerResult, // Spread handler result (products, items, etc.)
            reply: reply,
            intent: classification.intent,
            confidence: classification.confidence
        });

    } catch (err) {
        console.error("Chat Error:", err);

        // ERROR LOGGING
        logStep(`ERROR (Chat): ${err.message}\nStack: ${err.stack}`);

        // Track error
        trackRequest('legacy', {
            apiCalls: 0,
            responseTime: 0,
            error: true
        });

        res.status(500).json({
            success: false,
            error: err.message,
            reply: "I'm having trouble processing your request right now. Please try again."
        });
    }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        success: true,
        service: 'be3_ai',
        model: MODEL_ID,
        status: 'running'
    });
});

/**
 * Metrics endpoint
 */
app.get('/metrics', (req, res) => {
    res.json({
        success: true,
        metrics: getMetrics(),
        summary: getMetricsSummary()
    });
});

/**
 * Debug endpoint to check state (for testing)
 */
app.get('/debug/state/:session_id', async (req, res) => {
    try {
        const { session_id } = req.params;
        const state = await stateManager.getState(session_id);
        res.json({ success: true, state });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Debug endpoint to clear state (for testing)
 */
app.delete('/debug/state/:session_id', async (req, res) => {
    try {
        const { session_id } = req.params;
        await stateManager.clearState(session_id);
        res.json({ success: true, message: 'State cleared' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// Initialize Redis on startup
redisClient.initRedis().then(() => {
    app.listen(PORT, () => {
        console.log(`\n🤖 Be3 AI Service (Qwen + State Management) running on port ${PORT}`);
        console.log(`📡 Backend API: ${process.env.BACKEND_API_URL || 'http://localhost:3000'}`);
        console.log(`🏢 Tenant ID: ${process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713'}`);
        console.log(`💾 Redis: ${redisClient.isRedisConnected() ? 'Connected' : 'Fallback mode (in-memory)'}\n`);
    });
}).catch(err => {
    console.error('Failed to initialize Redis:', err);
    console.log('Starting in fallback mode (in-memory state only)\n');

    app.listen(PORT, () => {
        console.log(`\n🤖 Be3 AI Service (Qwen + State Management) running on port ${PORT}`);
        console.log(`⚠️  Running in FALLBACK mode (no Redis)\n`);
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\nShutting down gracefully...');
    await redisClient.closeRedis();
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\nCRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
    // In production, you might want to shutdown gracefully but for now we need to see the error
});

process.on('uncaughtException', (error) => {
    console.error('\nCRITICAL: Uncaught Exception:', error);
    process.exit(1);
});
