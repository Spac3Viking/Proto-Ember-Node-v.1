'use strict';

/**
 * Ember Node v.ᚠ — Phase 7: Tool Discovery
 *
 * Detects local AI runtimes and tools available on this machine.
 * Detection is safe: read-only HTTP probes, no execution.
 * No tool is trusted automatically.
 */

const http  = require('http');
const https = require('https');

/** Timeout (ms) for each detection probe. */
const PROBE_TIMEOUT_MS = 2000;

/**
 * Perform a lightweight HTTP GET probe.
 * Resolves to { ok: true, status } on any HTTP response,
 * resolves to { ok: false, error } on connection failure or timeout.
 *
 * @param {string} url
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
function httpProbe(url) {
    return new Promise(resolve => {
        let settled = false;
        function done(result) {
            if (settled) return;
            settled = true;
            resolve(result);
        }

        const client = url.startsWith('https://') ? https : http;
        try {
            const req = client.get(url, { timeout: PROBE_TIMEOUT_MS }, res => {
                res.resume(); // drain to free socket
                done({ ok: true, status: res.statusCode });
            });
            req.on('error', err => done({ ok: false, error: err.message }));
            req.on('timeout', () => {
                req.destroy();
                done({ ok: false, error: 'timeout' });
            });
        } catch (err) {
            done({ ok: false, error: err.message });
        }
    });
}

/**
 * Detect Ollama running on its default port.
 * Probes /api/tags — Ollama's model list endpoint.
 *
 * @returns {Promise<object|null>}  Tool record or null if not found.
 */
async function detectOllama() {
    const endpoint = 'http://localhost:11434';
    const probe    = await httpProbe(endpoint + '/api/tags');

    if (!probe.ok) return null;

    return {
        id:        'ollama-local',
        name:      'Ollama',
        type:      'model_host',
        interface: 'http',
        endpoint,
        status:    'detected',
        running:   true,
        trusted:   false,
    };
}

/**
 * Detect additional HTTP AI endpoints declared via EMBER_AI_ENDPOINTS
 * environment variable (comma-separated URLs).
 *
 * @returns {Promise<object[]>}
 */
async function detectConfiguredEndpoints() {
    const raw = process.env.EMBER_AI_ENDPOINTS || '';
    if (!raw.trim()) return [];

    const urls   = raw.split(',').map(s => s.trim()).filter(Boolean);
    const results = [];

    for (const url of urls) {
        const probe = await httpProbe(url);
        if (probe.ok) {
            // Derive a stable id from hostname+port
            let id;
            try {
                const u = new URL(url);
                id = 'http-' + u.hostname.replace(/\./g, '-') + '-' + u.port;
            } catch {
                id = 'http-endpoint-' + Buffer.from(url).toString('base64').slice(0, 8);
            }
            results.push({
                id,
                name:      url,
                type:      'http_endpoint',
                interface: 'http',
                endpoint:  url,
                status:    'detected',
                running:   true,
                trusted:   false,
            });
        }
    }

    return results;
}

/**
 * Placeholder record for future tools (Claude CLI, OpenClaw, etc.).
 * These are declared but not yet probed — shown in the UI as "planned".
 *
 * @returns {object[]}
 */
function placeholderTools() {
    return [
        {
            id:        'claude-cli',
            name:      'Claude CLI',
            type:      'model_host',
            interface: 'cli',
            endpoint:  null,
            status:    'not_detected',
            trusted:   false,
            note:      'Placeholder — detection not yet implemented.',
        },
    ];
}

/**
 * Run all detectors and return an array of tool records.
 * Results are safe to surface in the UI; none are trusted by default.
 *
 * @returns {Promise<object[]>}
 */
async function discoverTools() {
    const [ollama, httpEndpoints] = await Promise.all([
        detectOllama(),
        detectConfiguredEndpoints(),
    ]);

    const detected = [];
    if (ollama)              detected.push(ollama);
    if (httpEndpoints.length > 0) detected.push(...httpEndpoints);

    // Append placeholders for undetected future tools
    detected.push(...placeholderTools());

    return detected;
}

module.exports = { discoverTools, httpProbe };
