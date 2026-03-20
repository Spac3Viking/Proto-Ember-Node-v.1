'use strict';

/**
 * Ember Node v.ᚠ — Rate Limiters
 *
 * Shared rate limiter instances used across route modules.
 * Applied to endpoints that perform file system writes or expensive operations.
 * Limits are generous for local use but guard against runaway processes.
 */

const rateLimit = require('express-rate-limit');

/** Light limiter for read-only endpoints (GET status, list calls, etc.) */
const readLimiter = rateLimit({
    windowMs:          60 * 1000,  // 1 minute
    max:               120,         // 120 read requests per minute
    standardHeaders:   true,
    legacyHeaders:     false,
    message:           { error: 'Too many requests. Please slow down.' },
});

/** Moderate limiter for write endpoints (note saving, ingest, etc.) */
const writeLimiter = rateLimit({
    windowMs:          60 * 1000,  // 1 minute
    max:               60,          // 60 write operations per minute
    standardHeaders:   true,
    legacyHeaders:     false,
    message:           { error: 'Too many requests. Please slow down.' },
});

/** Strict limiter for heavy/expensive operations (indexing, embeddings) */
const indexLimiter = rateLimit({
    windowMs:          60 * 1000,  // 1 minute
    max:               10,          // 10 indexing operations per minute
    standardHeaders:   true,
    legacyHeaders:     false,
    message:           { error: 'Too many indexing requests. Please slow down.' },
});

/** Limiter for the chat endpoint — local use, no need to be as strict as indexing */
const chatLimiter = rateLimit({
    windowMs:          60 * 1000,  // 1 minute
    max:               30,          // 30 chat requests per minute
    standardHeaders:   true,
    legacyHeaders:     false,
    message:           { error: 'Too many chat requests. Please slow down.' },
});

module.exports = { readLimiter, writeLimiter, indexLimiter, chatLimiter };
