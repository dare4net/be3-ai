const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

const CURRENT_LEVEL = process.env.LOG_LEVEL || 'INFO';

class Logger {
    constructor(category) {
        this.category = category;
    }

    log(level, message, data = {}) {
        if (LOG_LEVELS[level] < LOG_LEVELS[CURRENT_LEVEL]) {
            return; // Skip logs below current level
        }

        const timestamp = new Date().toISOString();
        const requestId = data.requestId || 'N/A';

        // Format: [timestamp] [requestId] [category] level: message
        const logPrefix = `[${timestamp}] [${requestId}] [${this.category}]`;

        // Remove requestId from data to avoid duplication
        const { requestId: _, ...logData } = data;

        if (Object.keys(logData).length > 0) {
            console.log(`${logPrefix} ${level}: ${message}`, logData);
        } else {
            console.log(`${logPrefix} ${level}: ${message}`);
        }
    }

    debug(message, data = {}) {
        this.log('DEBUG', message, data);
    }

    info(message, data = {}) {
        this.log('INFO', message, data);
    }

    warn(message, data = {}) {
        this.log('WARN', message, data);
    }

    error(message, data = {}) {
        this.log('ERROR', message, data);
    }
}

module.exports = Logger;
