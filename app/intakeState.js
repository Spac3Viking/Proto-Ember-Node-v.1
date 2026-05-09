'use strict';

/**
 * Ember Node v.ᚠ — Intake State
 *
 * Single source of truth for Threshold airlock state.
 * Tracks per-file and per-runtime intake decisions across restarts.
 *
 * Schema for intake.json:
 *   {
 *     files: {
 *       "room/file.txt": { path, state, lastReviewed, lastKnownMtime, notes }
 *     },
 *     runtimes: {
 *       "runtime-id": { id, state, lastReviewed }
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
 * @returns {{ files: object, runtimes: object }}
 */
function loadIntakeState() {
    if (!fs.existsSync(INTAKE_STATE_PATH)) {
        return { files: {}, runtimes: {} };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(INTAKE_STATE_PATH, 'utf8'));
        if (!parsed || typeof parsed !== 'object') {
            return { files: {}, runtimes: {} };
        }
        const files = (parsed.files && typeof parsed.files === 'object') ? parsed.files : {};
        // Legacy migration alias. Remove after user data migration stabilizes.
        const runtimes = (parsed.runtimes && typeof parsed.runtimes === 'object')
            ? parsed.runtimes
            : ((parsed.tools && typeof parsed.tools === 'object') ? parsed.tools : {});
        return { files, runtimes };
    } catch {
        return { files: {}, runtimes: {} };
    }
}

/**
 * Persist the intake state to disk.
 *
 * @param {{ files: object, runtimes: object }} state
 */
function saveIntakeState(state) {
    const normalized = {
        files: (state && state.files && typeof state.files === 'object') ? state.files : {},
        runtimes: (state && state.runtimes && typeof state.runtimes === 'object') ? state.runtimes : {},
    };
    fs.writeFileSync(INTAKE_STATE_PATH, JSON.stringify(normalized, null, 2), 'utf8');
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
 * Update (or create) a runtime entry in the intake state and save immediately.
 *
 * @param {string} runtimeId
 * @param {object} updates
 * @returns {object}       The updated entry
 */
function upsertIntakeRuntime(runtimeId, updates) {
    const state = loadIntakeState();
    const now   = new Date().toISOString();
    state.runtimes[runtimeId] = Object.assign(
        { id: runtimeId },
        state.runtimes[runtimeId] || {},
        updates,
        { lastReviewed: now },
    );
    saveIntakeState(state);
    return state.runtimes[runtimeId];
}

module.exports = {
    loadIntakeState,
    saveIntakeState,
    upsertIntakeFile,
    upsertIntakeRuntime,
};
