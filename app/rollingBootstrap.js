'use strict';

/**
 * Rolling Bootstrap compatibility surface.
 *
 * Existing modules can continue importing ./bootstrap while new modules
 * may import ./rollingBootstrap for continuity-focused naming.
 */

const bootstrap = require('./bootstrap');

module.exports = {
    buildRollingBootstrap: bootstrap.buildRollingBootstrap,
    loadRollingBootstrap: bootstrap.loadRollingBootstrap,
    refreshRollingBootstrap: bootstrap.refreshRollingBootstrap,
    getRollingBootstrapStatus: bootstrap.getRollingBootstrapStatus,
    formatRollingBootstrapForPrompt: bootstrap.formatRollingBootstrapForPrompt,
};
