'use strict';

/**
 * Ember Node v.ᚠ — Intake State
 *
 * Single source of truth for Threshold airlock state.
 * Tracks per-file and per-tool intake decisions across restarts.
 *
 * Schema for intake.json:
 *   {
 *     files: {
 *       "room/file.txt": { path, state, lastReviewed, lastKnownMtime, notes }
 *     },
 *     tools: {
 *       "tool-id": { id, state, lastReviewed }
 *     }
 *   }
 */

const fs   = require('fs');
const path = require('path');
const { SYSTEM_DIR } = require('./storageConfig');

/** Path to the intake state JSON file. */
const INTAKE_STATE_PATH = path.join(SYSTEM_DIR, 'intake.json');

/**
 * Load the persistent intake state from disk.
 * Returns an empty state if the file does not exist or is corrupt.
 *
 * @returns {{ files: object, tools: object }}
 */
function loadIntakeState() {
    if (!fs.existsSync(INTAKE_STATE_PATH)) {
        return { files: {}, tools: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(INTAKE_STATE_PATH, 'utf8'));
    } catch {
        return { files: {}, tools: {} };
    }
}

/**
 * Persist the intake state to disk.
 *
 * @param {{ files: object, tools: object }} state
 */
function saveIntakeState(state) {
    fs.writeFileSync(INTAKE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Update (or create) a file entry in the intake state and save immediately.
 *
 * @param {string} filePath  Storage-root-relative path (e.g. 'threshold/file.txt')
 * @param {object} updates   Fields to merge into the entry
 * @returns {object}         The updated entry
 */
function upsertIntakeFile(filePath, updates) {
    const state = loadIntakeState();
    const key   = filePath.replace(/\\/g, '/');
    const now   = new Date().toISOString();
    state.files[key] = Object.assign(
        { path: key },
        state.files[key] || {},
        updates,
        { lastReviewed: now },
    );
    saveIntakeState(state);
    return state.files[key];
}

/**
 * Update (or create) a tool entry in the intake state and save immediately.
 *
 * @param {string} toolId
 * @param {object} updates
 * @returns {object}       The updated entry
 */
function upsertIntakeTool(toolId, updates) {
    const state = loadIntakeState();
    const now   = new Date().toISOString();
    state.tools[toolId] = Object.assign(
        { id: toolId },
        state.tools[toolId] || {},
        updates,
        { lastReviewed: now },
    );
    saveIntakeState(state);
    return state.tools[toolId];
}

module.exports = {
    loadIntakeState,
    saveIntakeState,
    upsertIntakeFile,
    upsertIntakeTool,
};
