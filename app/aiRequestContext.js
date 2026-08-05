'use strict';

const NATURAL_RESPONSE_DISCIPLINE = [
    'You are a fallible local companion.',
    'Answer naturally, clearly, and practically.',
    'Distinguish observation, inference, and uncertainty when useful.',
    'The person remains the final authority; records may be incomplete or outdated.',
].join(' ');

function clipLeadingContent(value, maxLength) {
    const text = String(value || '');
    if (text.length <= maxLength) return text;
    return text.slice(text.length - maxLength);
}

function buildAiRequest({ systemPrompt = '', continuityContext = '', userContent = '', maxPromptLength = 0 } = {}) {
    const systemContent = [NATURAL_RESPONSE_DISCIPLINE, systemPrompt].filter(Boolean).join('\n\n');
    const continuity = String(continuityContext || '');
    let user = String(userContent || '');
    const separators = continuity && user ? 2 : 0;
    if (Number.isFinite(maxPromptLength) && maxPromptLength > 0) {
        const remaining = Math.max(0, Math.floor(maxPromptLength) - systemContent.length - continuity.length - separators);
        user = clipLeadingContent(user, remaining);
    }
    return {
        messages: [
            { role: 'system', content: systemContent },
            {
                role: 'user',
                content: [continuity, user]
                    .filter(Boolean)
                    .join('\n\n'),
            },
        ],
    };
}

module.exports = { NATURAL_RESPONSE_DISCIPLINE, buildAiRequest };
