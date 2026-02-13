/**
 * Cart Tools
 * Capabilities related to shopping cart management.
 */

const axios = require('axios');

// Configuration
const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function callBackendAPI(endpoint, options = {}) {
    try {
        const config = {
            ...options,
            headers: {
                'X-Tenant-ID': TENANT_ID,
                'Content-Type': 'application/json',
                ...options.headers
            }
        };
        const url = `${BACKEND_URL}${endpoint}`;
        console.log(`[CartTool] API Call: ${url}`);
        const response = await axios({ url, ...config });
        return { success: true, data: response.data };
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            throw new Error(`connect ECONNREFUSED ${error.address}:${error.port}`);
        }
        console.error(`[CartTool] API Error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

const cartTools = {
    'cart.view': {
        description: 'View the current contents of the shopping cart',
        params: {}, // No params needed, uses sessionId from context
        handler: async (params, context) => {
            const { sessionId } = context;
            if (!sessionId) return { error: "Session ID required" };

            const result = await callBackendAPI(`/cart?session_id=${sessionId}`);

            if (!result.success) return { error: "Failed to retrieve cart", details: result.error };

            const { cart, items, vendorGroups } = result.data;
            if (!items || items.length === 0) {
                return { message: "Your cart is empty.", items: [], total: 0 };
            }

            const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            return {
                items: items.map(i => ({
                    id: i.id,
                    product_name: i.product_name,
                    quantity: i.quantity,
                    price: i.price,
                    subtotal: i.price * i.quantity
                })),
                vendor_groups: vendorGroups.map(vg => ({
                    vendor_id: vg.vendorId,
                    business_name: vg.businessName,
                    checkout_style: vg.checkoutStyle,
                    item_count: vg.items.length,
                    subtotal: vg.items.reduce((s, i) => s + (parseFloat(i.price) * i.quantity), 0).toFixed(2)
                })),
                total: total.toFixed(2),
                item_count: items.length
            };
        }
    },

    'cart.add': {
        description: 'Add a product to the shopping cart',
        params: {
            product_id: { type: 'string', description: 'Product ID, name, or reference (e.g. "the first one", "the cheap one", "it", or "Rattan 2 Drawers"). NEVER use placeholders like "product-id".' },
            quantity: { type: 'number', description: 'Quantity (default 1)' }
        },
        handler: async (params, context) => {
            const { product_id: identifier, quantity = 1 } = params;
            const { sessionId } = context;

            if (!identifier) return { error: "Product ID or name is required" };

            // --- STAGE 1: Product Resolution (Phase 8) ---
            const { resolveProduct } = require('../utils/productResolver');
            const product_id = await resolveProduct(identifier, context);

            if (!product_id) return { error: `Could not find product: ${identifier}` };

            console.log(`[CartTool] cart.add using resolved ID: ${product_id} (from "${identifier}")`);

            // Get product price first (simplified logic)
            // In a real scenario, the backend endpoint usually handles price lookup or validation
            const productRes = await callBackendAPI(`/products/storefront/products/${product_id}`);
            if (!productRes.success) return { error: `Product not found: ${product_id}` };

            const product = productRes.data.product;

            const result = await callBackendAPI('/cart/items', {
                method: 'POST',
                data: {
                    product_id,
                    quantity: parseInt(quantity),
                    price: product.price,
                    session_id: sessionId
                }
            });

            if (!result.success) return { error: "Failed to add to cart", details: result.error };

            return {
                success: true,
                message: `Added ${quantity} x ${product.name} to cart`,
                cart_summary: result.data.cart
            };
        }
    },

    'cart.remove': {
        description: 'Remove an item from the shopping cart',
        params: {
            cart_item_id: { type: 'string', description: 'ID of the item, OR smart keywords like "all", "first", "last", "the first one", "last 2", etc.' }
        },
        handler: async (params, context) => {
            const { cart_item_id } = params;
            const { sessionId } = context;
            if (!cart_item_id) return { error: "Cart Item ID or keyword required" };

            // 1. Fetch current cart to resolve smart references
            const cartResult = await callBackendAPI(`/cart?session_id=${sessionId}`);
            if (!cartResult.success || !cartResult.data.items || cartResult.data.items.length === 0) {
                return { message: "Cart is already empty." };
            }
            const items = cartResult.data.items;

            // 2. Handle "ALL"
            const lowerId = cart_item_id.toString().toLowerCase();
            if (lowerId === 'all' || lowerId.includes('everything') || lowerId.includes('clear')) {
                // Determine if we need to loop or if backend has a clear endpoint. 
                // Assuming we must loop for now if DELETE /cart/items/all failed previously.
                // Better approach: Loop delete.
                const errors = [];
                for (const item of items) {
                    const res = await callBackendAPI(`/cart/items/${item.id}`, { method: 'DELETE' });
                    if (!res.success) errors.push(item.product_name);
                }
                if (errors.length > 0) return { error: `Failed to remove some items: ${errors.join(', ')}` };
                return { success: true, message: "Cart cleared!", cart_summary: { items: [], total: 0 } };
            }

            // 3. Handle Smart References (first, last, index)
            let targetIds = [];

            // "last X" or "first X"
            const numberMatch = lowerId.match(/(?:last|first)\s+(\d+)/);
            const count = numberMatch ? parseInt(numberMatch[1]) : 1;

            if (lowerId.includes('first')) {
                targetIds = items.slice(0, count).map(i => i.id);
            } else if (lowerId.includes('last')) {
                targetIds = items.slice(-count).map(i => i.id);
            } else if (!isNaN(parseInt(cart_item_id)) && cart_item_id.length < 5) {
                // User likely sent an index "1", "2"
                const idx = parseInt(cart_item_id) - 1;
                if (items[idx]) targetIds.push(items[idx].id);
            } else {
                // 4. Default: Assume it's a specific ID or Product Name matching
                // Try exact ID match first
                const exactMatch = items.find(i => i.id === cart_item_id);
                if (exactMatch) targetIds.push(exactMatch.id);
                else {
                    // Try fuzzy name match
                    const nameMatch = items.find(i => i.product_name.toLowerCase().includes(lowerId));
                    if (nameMatch) targetIds.push(nameMatch.id);
                }
            }

            if (targetIds.length === 0) {
                return { error: `Could not find item matching "${cart_item_id}" in your cart.` };
            }

            // 5. Execute Removals
            for (const id of targetIds) {
                await callBackendAPI(`/cart/items/${id}`, { method: 'DELETE' });
            }

            return { success: true, message: `Removed ${targetIds.length} item(s) from cart.` };
        }
    },
    'cart.updateQuantity': {
        description: 'Update the quantity of an item in the shopping cart',
        params: {
            cart_item_id: { type: 'string', description: 'ID of the item in the cart' },
            quantity: { type: 'number', description: 'New quantity' }
        },
        handler: async (params, context) => {
            const { cart_item_id, quantity } = params;
            if (!cart_item_id) return { error: "Cart Item ID required" };
            if (!quantity || quantity < 1) return { error: "Quantity must be at least 1" };

            const result = await callBackendAPI(`/cart/items/${cart_item_id}`, {
                method: 'PATCH',
                data: { quantity: parseInt(quantity) }
            });

            if (!result.success) return { error: "Failed to update quantity", details: result.error };

            return {
                success: true,
                message: "Quantity updated",
                item: result.data.item
            };
        }
    }
};

module.exports = cartTools;
