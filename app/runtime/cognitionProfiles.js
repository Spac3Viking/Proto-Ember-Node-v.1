'use strict';

const DEFAULT_COGNITION_PROFILE_ID = 'balanced-ember';

const COGNITION_PROFILES = Object.freeze({
    'spark-compression': Object.freeze({
        id: 'spark-compression',
        label: 'Spark Compression',
        responseLength: 'very concise',
        retrievalBreadth: 'minimal retrieval sweep',
        mentorPacing: 'fast orientation',
        reflectionDensity: 'low',
        formattingStyle: 'direct compact bullets',
        continuationBehavior: 'one next-step max',
        symbolicDensity: 'minimal',
        cachePriority: 'loaded caches first',
        promptSummary: [
            'Favor direct concise responses.',
            'Keep retrieval narrow and practical.',
            'Offer at most one clear next step.',
        ],
        retrievalInfluence: Object.freeze({
            topKMultiplier: 0.78,
            targetSourcesMultiplier: 0.8,
            maxRawChunksMultiplier: 0.8,
            loadedCacheBoostDelta: 0.08,
            nonLoadedArchivePenaltyDelta: -0.08,
        }),
        generationInfluence: Object.freeze({
            numPredictMultiplier: 0.7,
            temperatureDelta: -0.05,
        }),
    }),
    'balanced-ember': Object.freeze({
        id: 'balanced-ember',
        label: 'Balanced Ember',
        responseLength: 'balanced',
        retrievalBreadth: 'moderate retrieval',
        mentorPacing: 'steady guide',
        reflectionDensity: 'moderate',
        formattingStyle: 'clear markdown structure',
        continuationBehavior: 'one optional continuation line',
        symbolicDensity: 'moderate',
        cachePriority: 'balanced cache + archive',
        promptSummary: [
            'Use balanced concise synthesis.',
            'Keep retrieval practical and moderate.',
            'Blend direct guidance with brief continuity cues.',
        ],
        retrievalInfluence: Object.freeze({
            topKMultiplier: 1,
            targetSourcesMultiplier: 1,
            maxRawChunksMultiplier: 1,
            loadedCacheBoostDelta: 0,
            nonLoadedArchivePenaltyDelta: 0,
        }),
        generationInfluence: Object.freeze({
            numPredictMultiplier: 1,
            temperatureDelta: 0,
        }),
    }),
    'field-guide': Object.freeze({
        id: 'field-guide',
        label: 'Field Guide',
        responseLength: 'concise practical',
        retrievalBreadth: 'focused grounded retrieval',
        mentorPacing: 'direct implementation pacing',
        reflectionDensity: 'low-moderate',
        formattingStyle: 'checklist and implementation framing',
        continuationBehavior: 'single practical follow-up',
        symbolicDensity: 'low',
        cachePriority: 'high loaded cache preference',
        promptSummary: [
            'Favor practical implementation guidance.',
            'Stay grounded and avoid symbolic drift.',
            'Use concise steps or actionable bullets.',
        ],
        retrievalInfluence: Object.freeze({
            topKMultiplier: 0.9,
            targetSourcesMultiplier: 0.9,
            maxRawChunksMultiplier: 0.9,
            loadedCacheBoostDelta: 0.12,
            nonLoadedArchivePenaltyDelta: -0.1,
        }),
        generationInfluence: Object.freeze({
            numPredictMultiplier: 0.9,
            temperatureDelta: -0.03,
        }),
    }),
    'scholar-weave': Object.freeze({
        id: 'scholar-weave',
        label: 'Scholar Weave',
        responseLength: 'expanded comparative',
        retrievalBreadth: 'broader cross-reference retrieval',
        mentorPacing: 'questioning comparative pacing',
        reflectionDensity: 'moderate-high',
        formattingStyle: 'comparative sections',
        continuationBehavior: 'invite deeper comparison',
        symbolicDensity: 'moderate',
        cachePriority: 'balanced with archive breadth',
        promptSummary: [
            'Prefer comparative, cross-reference-aware synthesis.',
            'Allow slightly broader retrieval when useful.',
            'Use questioning mentor cadence for deeper understanding.',
        ],
        retrievalInfluence: Object.freeze({
            topKMultiplier: 1.14,
            targetSourcesMultiplier: 1.12,
            maxRawChunksMultiplier: 1.08,
            loadedCacheBoostDelta: 0.02,
            nonLoadedArchivePenaltyDelta: 0,
        }),
        generationInfluence: Object.freeze({
            numPredictMultiplier: 1.1,
            temperatureDelta: 0.02,
        }),
    }),
    'narrative-forge': Object.freeze({
        id: 'narrative-forge',
        label: 'Narrative Forge',
        responseLength: 'cohesive prose-first',
        retrievalBreadth: 'continuity-aware retrieval',
        mentorPacing: 'atmospheric reflective pacing',
        reflectionDensity: 'moderate',
        formattingStyle: 'cohesive prose flow',
        continuationBehavior: 'smooth continuity handoff',
        symbolicDensity: 'moderate-high',
        cachePriority: 'continuity cache preference',
        promptSummary: [
            'Favor cohesive prose and continuity flow.',
            'Keep retrieval tuned to narrative continuity.',
            'Use atmospheric mentor guidance without over-expansion.',
        ],
        retrievalInfluence: Object.freeze({
            topKMultiplier: 1.02,
            targetSourcesMultiplier: 1.04,
            maxRawChunksMultiplier: 1.04,
            loadedCacheBoostDelta: 0.1,
            nonLoadedArchivePenaltyDelta: -0.03,
        }),
        generationInfluence: Object.freeze({
            numPredictMultiplier: 1.08,
            temperatureDelta: 0.03,
        }),
    }),
    'minimal-retrieval': Object.freeze({
        id: 'minimal-retrieval',
        label: 'Minimal Retrieval',
        responseLength: 'tight bootstrap-first',
        retrievalBreadth: 'small retrieval budget',
        mentorPacing: 'fast direct mentor pacing',
        reflectionDensity: 'low',
        formattingStyle: 'compact practical notes',
        continuationBehavior: 'no philosophical drift',
        symbolicDensity: 'minimal',
        cachePriority: 'loaded cache only bias',
        promptSummary: [
            'Prefer bootstrap-first response posture.',
            'Keep retrieval ceilings small and focused.',
            'Minimize philosophical drift and stay practical.',
        ],
        retrievalInfluence: Object.freeze({
            topKMultiplier: 0.72,
            targetSourcesMultiplier: 0.75,
            maxRawChunksMultiplier: 0.75,
            loadedCacheBoostDelta: 0.14,
            nonLoadedArchivePenaltyDelta: -0.14,
        }),
        generationInfluence: Object.freeze({
            numPredictMultiplier: 0.72,
            temperatureDelta: -0.07,
        }),
    }),
    'deep-hearth': Object.freeze({
        id: 'deep-hearth',
        label: 'Deep Hearth',
        responseLength: 'deeper synthesis',
        retrievalBreadth: 'slightly expanded depth retrieval',
        mentorPacing: 'continuity teaching cadence',
        reflectionDensity: 'high',
        formattingStyle: 'structured deep teaching',
        continuationBehavior: 'sustained continuity threads',
        symbolicDensity: 'moderate',
        cachePriority: 'continuity and loaded cache blend',
        promptSummary: [
            'Favor deeper synthesis with practical structure.',
            'Maintain continuity-focused mentor teaching posture.',
            'Use reflective density without excessive sprawl.',
        ],
        retrievalInfluence: Object.freeze({
            topKMultiplier: 1.12,
            targetSourcesMultiplier: 1.1,
            maxRawChunksMultiplier: 1.12,
            loadedCacheBoostDelta: 0.06,
            nonLoadedArchivePenaltyDelta: -0.02,
        }),
        generationInfluence: Object.freeze({
            numPredictMultiplier: 1.16,
            temperatureDelta: 0.01,
        }),
    }),
});

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeCognitionProfileId(value) {
    const raw = String(value || '').trim().toLowerCase();
    return COGNITION_PROFILES[raw] ? raw : DEFAULT_COGNITION_PROFILE_ID;
}

function resolveCognitionProfile(value) {
    const id = normalizeCognitionProfileId(value);
    return COGNITION_PROFILES[id] || COGNITION_PROFILES[DEFAULT_COGNITION_PROFILE_ID];
}

function listCognitionProfiles() {
    return Object.values(COGNITION_PROFILES).map(profile => ({
        id: profile.id,
        label: profile.label,
        summary: profile.promptSummary[0] || '',
    }));
}

function buildCognitionProfilePromptSummary(profile) {
    const resolved = resolveCognitionProfile(profile && profile.id ? profile.id : profile);
    return [
        'Runtime Profile:',
        resolved.label,
        ...resolved.promptSummary.slice(0, 3),
    ].join('\n');
}

function buildCognitionProfileBootstrapSummary(profile) {
    const resolved = resolveCognitionProfile(profile && profile.id ? profile.id : profile);
    return [
        '- Response posture: ' + resolved.responseLength + '.',
        '- Retrieval posture: ' + resolved.retrievalBreadth + '.',
        '- Mentor pacing: ' + resolved.mentorPacing + '.',
    ];
}

function applyCognitionProfileInfluence({
    cognitionProfile,
    retrievalTopK,
    targetSources,
    maxRawChunks,
    retrievalDiscipline,
    runtimeGenerationProfile,
}) {
    const profile = resolveCognitionProfile(cognitionProfile && cognitionProfile.id
        ? cognitionProfile.id
        : cognitionProfile);
    const retrievalInfluence = profile.retrievalInfluence || {};
    const generationInfluence = profile.generationInfluence || {};
    const normalizedRetrieval = retrievalDiscipline && typeof retrievalDiscipline === 'object'
        ? retrievalDiscipline
        : { loadedCacheBoost: 1.06, nonLoadedArchivePenalty: 1 };
    const normalizedGeneration = runtimeGenerationProfile && typeof runtimeGenerationProfile === 'object'
        ? runtimeGenerationProfile
        : { numPredict: 560, temperature: 0.68 };

    const adjustedRetrievalTopK = clampNumber(
        Math.round(Number(retrievalTopK || 1) * Number(retrievalInfluence.topKMultiplier || 1)),
        1,
        16,
    );
    const adjustedTargetSources = clampNumber(
        Math.round(Number(targetSources || 1) * Number(retrievalInfluence.targetSourcesMultiplier || 1)),
        1,
        10,
    );
    const adjustedMaxRawChunks = clampNumber(
        Math.round(Number(maxRawChunks || 1) * Number(retrievalInfluence.maxRawChunksMultiplier || 1)),
        1,
        14,
    );
    const adjustedLoadedCacheBoost = clampNumber(
        Number(normalizedRetrieval.loadedCacheBoost || 1.06) + Number(retrievalInfluence.loadedCacheBoostDelta || 0),
        1,
        1.5,
    );
    const adjustedNonLoadedArchivePenalty = clampNumber(
        Number(normalizedRetrieval.nonLoadedArchivePenalty || 1) + Number(retrievalInfluence.nonLoadedArchivePenaltyDelta || 0),
        0.7,
        1,
    );
    const adjustedNumPredict = clampNumber(
        Math.round(Number(normalizedGeneration.numPredict || 560) * Number(generationInfluence.numPredictMultiplier || 1)),
        120,
        2200,
    );
    const adjustedTemperature = clampNumber(
        Number(normalizedGeneration.temperature || 0.68) + Number(generationInfluence.temperatureDelta || 0),
        0.4,
        0.9,
    );

    return {
        profile,
        retrievalTopK: adjustedRetrievalTopK,
        targetSources: adjustedTargetSources,
        maxRawChunks: adjustedMaxRawChunks,
        retrievalDiscipline: {
            loadedCacheBoost: adjustedLoadedCacheBoost,
            nonLoadedArchivePenalty: adjustedNonLoadedArchivePenalty,
        },
        runtimeGenerationProfile: {
            numPredict: adjustedNumPredict,
            temperature: Math.round(adjustedTemperature * 100) / 100,
        },
    };
}

module.exports = {
    DEFAULT_COGNITION_PROFILE_ID,
    COGNITION_PROFILES,
    normalizeCognitionProfileId,
    resolveCognitionProfile,
    listCognitionProfiles,
    buildCognitionProfilePromptSummary,
    buildCognitionProfileBootstrapSummary,
    applyCognitionProfileInfluence,
};
