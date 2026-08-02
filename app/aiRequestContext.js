'use strict';

const NATURAL_RESPONSE_DISCIPLINE = [
    'You are a fallible local companion.',
    'Answer naturally, clearly, and practically.',
    'Distinguish observation, inference, and uncertainty when useful.',
    'The person remains the final authority; records may be incomplete or outdated.',
].join(' ');

function buildAiRequest({ systemPrompt = '', continuityContext = '', retrievalContext = '', userContent = '' } = {}) {
    return {
        messages: [
            { role: 'system', content: [NATURAL_RESPONSE_DISCIPLINE, systemPrompt].filter(Boolean).join('\n\n') },
            {
                role: 'user',
                content: [continuityContext, retrievalContext, userContent]
                    .filter(Boolean)
                    .join('\n\n'),
            },
        ],
    };
}

module.exports = { NATURAL_RESPONSE_DISCIPLINE, buildAiRequest };
