/**
 * Task Manager
 * Handles persistence and state management for autonomous multi-step tasks using Redis.
 * Stored under key: session:{sessionId}:active_task
 */

const { getClient } = require('./redis');

const TASK_TTL = 86400; // 24 hours retention for active tasks

class TaskManager {
    constructor() {
        this.keyPrefix = 'session:';
        this.keySuffix = ':active_task';
    }

    _getKey(sessionId) {
        return `${this.keyPrefix}${sessionId}${this.keySuffix}`;
    }

    /**
     * Creates a new task session.
     */
    async createTask(sessionId, originalRequest, steps) {
        const task = {
            taskId: crypto.randomUUID(),
            originalRequest,
            status: 'active',
            createdAt: Date.now(),
            lastUpdated: Date.now(),
            currentStepIndex: 0,
            accumulatedContext: "",
            steps: steps.map((step, index) => ({
                id: index + 1,
                ...step,
                status: 'pending',
                result: null
            }))
        };

        await this._saveTask(sessionId, task);
        console.log(`[TaskManager] Created new task ${task.taskId} for session ${sessionId} with ${steps.length} steps.`);
        return task;
    }

    /**
     * Retrieves the active task for a session.
     */
    async getTask(sessionId) {
        const client = getClient();
        if (!client) return null;

        const key = this._getKey(sessionId);
        try {
            const data = await client.get(key);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error(`[TaskManager] Get task failed: ${e.message}`);
            return null;
        }
    }

    /**
     * Updates the status of a specific step and the overall task context.
     */
    async updateStep(sessionId, stepIndex, status, result, newContext = "") {
        const task = await this.getTask(sessionId);
        if (!task) return null;

        if (task.steps[stepIndex]) {
            task.steps[stepIndex].status = status;
            task.steps[stepIndex].result = result;
        }

        if (newContext) {
            task.accumulatedContext += `\nStep ${stepIndex + 1} Result: ${newContext}`;
        }

        if (status === 'completed' || status === 'skipped') {
            task.currentStepIndex = stepIndex + 1;
        }

        const allDone = task.steps.every(s => ['completed', 'skipped'].includes(s.status));
        if (allDone) {
            task.status = 'completed';
        }

        task.lastUpdated = Date.now();
        await this._saveTask(sessionId, task);
        return task;
    }

    /**
     * Updates the global status of the task.
     */
    async updateStatus(sessionId, status) {
        const task = await this.getTask(sessionId);
        if (!task) return null;

        task.status = status;
        task.lastUpdated = Date.now();
        await this._saveTask(sessionId, task);
        return task;
    }

    /**
     * Clears the active task.
     */
    async clearTask(sessionId) {
        const client = getClient();
        if (!client) return;

        const key = this._getKey(sessionId);
        await client.del(key);
        console.log(`[TaskManager] Cleared task for session ${sessionId}`);
    }

    async _saveTask(sessionId, task) {
        const client = getClient();
        if (!client) return;

        const key = this._getKey(sessionId);
        try {
            await client.set(key, JSON.stringify(task));
            await client.expire(key, TASK_TTL);
        } catch (e) {
            console.error(`[TaskManager] Save task failed: ${e.message}`);
        }
    }
}

// Simple UUID generator if crypto is not available globally (Node < 19 context)
const crypto = require('crypto');

module.exports = new TaskManager();
