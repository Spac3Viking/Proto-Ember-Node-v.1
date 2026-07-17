'use strict';

const { isValidStorageId } = require('./safeStorageId');
const { loadSession, updateSession, deleteSession } = require('./sessions');
const { loadSignalThread, saveSignalThread } = require('./signalThreads');

const LIMITS = Object.freeze({
    sessionNote: 600,
    sessionNotes: 1800,
    pressure: 240,
    carryForward: 360,
    observation: 360,
    reflection: 360,
    entries: 2,
    sessionLinks: 4,
    block: 6000,
});

function clip(value, max) {
    const text = String(value || '').trim();
    return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

function recent(entries, count, max = LIMITS.carryForward) {
    return (Array.isArray(entries) ? entries : [])
        .slice()
        .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
        .slice(0, count)
        .map(entry => clip(entry && entry.content, max))
        .filter(Boolean);
}

function buildContinuityContext(session, thread, question = '', linkedSessions = []) {
    const current = session && typeof session === 'object' ? session : {};
    const linked = thread && typeof thread === 'object' ? thread : null;
    const lines = [
        '=== Current Session ===',
        'Title: ' + clip(current.title, 160),
        'Stage: ' + clip(current.currentStage, 40),
    ];
    const notes = (Array.isArray(current.entries) ? current.entries : [])
        .map(entry => clip(entry && entry.notes, LIMITS.sessionNote))
        .filter(Boolean);
    if (notes.length) lines.push('Notes:\n' + clip(notes.join('\n'), LIMITS.sessionNotes));
    if (linked) {
        lines.push('', '=== Current Thread ===', 'Title: ' + clip(linked.title, 160));
        if (linked.purpose) lines.push('Purpose: ' + clip(linked.purpose, 500));
        if (linked.currentSituation) lines.push('Current situation: ' + clip(linked.currentSituation, 700));
        const pressures = (Array.isArray(linked.openPressures) ? linked.openPressures : [])
            .map(value => clip(value, LIMITS.pressure)).filter(Boolean).slice(0, 4);
        if (pressures.length) lines.push('Open pressures:\n- ' + pressures.join('\n- '));
        const carry = recent(linked.carryForwardEntries, LIMITS.entries, LIMITS.carryForward);
        if (carry.length) lines.push('Carry-forward:\n- ' + carry.join('\n- '));
        const observations = recent(linked.observations, LIMITS.entries, LIMITS.observation);
        if (observations.length) lines.push('Recent observations:\n- ' + observations.join('\n- '));
        const reflections = recent(linked.reflections, LIMITS.entries, LIMITS.reflection);
        if (reflections.length) lines.push('Recent reflections:\n- ' + reflections.join('\n- '));
        const prior = linkedSessions
            .filter(other => other && other.id !== current.id)
            .slice(0, LIMITS.sessionLinks)
            .map(other => clip(other.title, 160) + ' — ' + clip(other.updatedAt || other.createdAt, 40));
        if (prior.length) lines.push('Prior linked Sessions:\n- ' + prior.join('\n- '));
    }
    if (question) lines.push('', 'Current question: ' + clip(question, 4000));
    return clip(lines.join('\n'), LIMITS.block);
}

function resolveSessionContinuity(sessionId, question = '') {
    if (!isValidStorageId(sessionId)) return { error: 'Invalid session id', status: 400 };
    const session = loadSession(sessionId);
    if (!session) return { error: 'Session not found', status: 404 };
    const threadId = session.continuity && session.continuity.threadId;
    const thread = threadId ? loadSignalThread(threadId) : null;
    if (threadId && !thread) {
        return { error: 'Session references a missing canonical Thread', status: 409 };
    }
    const linkedSessions = thread
        ? (thread.sessionIds || []).map(loadSession).filter(Boolean)
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        : [];
    return { session, thread, context: buildContinuityContext(session, thread, question, linkedSessions) };
}

function linkSessionToThread(sessionId, threadId) {
    if (!isValidStorageId(sessionId)) return { error: 'Invalid session id', status: 400 };
    if (!isValidStorageId(threadId)) return { error: 'Invalid thread id', status: 400 };
    const session = loadSession(sessionId);
    if (!session) return { error: 'Session not found', status: 404 };
    const thread = loadSignalThread(threadId);
    if (!thread) return { error: 'Thread not found', status: 404 };
    const currentThreadId = session.continuity && session.continuity.threadId;
    if (currentThreadId && currentThreadId !== thread.id) {
        return { error: 'Session is already linked to another Thread', status: 409 };
    }
    const latest = entries => recent(entries, 1)[0] || '';
    const linkedIds = (Array.isArray(thread.sessionIds) ? thread.sessionIds : [])
        .map(id => loadSession(id)).filter(Boolean)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const sessionPatch = {
        // These values preserve the v118 display schema only. The context
        // builders resolve live Thread state, so they are never authoritative.
        continuity: {
            threadId: thread.id,
            threadTitle: thread.title,
            threadPurpose: thread.purpose,
            openPressure: (thread.openPressures || [])[0] || '',
            carryForward: latest(thread.carryForwardEntries),
            mostRecentReflection: latest(thread.reflections),
            lastSessionDate: linkedIds[0] ? String(linkedIds[0].updatedAt || linkedIds[0].createdAt || '') : '',
        },
    };
    const updatedThread = {
        ...thread,
        sessionIds: Array.from(new Set([...(thread.sessionIds || []), session.id])),
        updatedAt: new Date().toISOString(),
    };
    try {
        saveSignalThread(updatedThread);
        const updatedSession = updateSession(session.id, sessionPatch);
        if (!updatedSession) throw new Error('Session disappeared while linking');
        return { session: updatedSession, thread: updatedThread };
    } catch (error) {
        try { saveSignalThread(thread); } catch (_) { /* preserve original error */ }
        return { error: 'Unable to link Session and Thread safely', status: 500 };
    }
}

function deleteSessionWithDetach(sessionId) {
    const session = loadSession(sessionId);
    if (!session) return { error: 'Session not found', status: 404 };
    const threadId = session.continuity && session.continuity.threadId;
    const thread = threadId ? loadSignalThread(threadId) : null;
    if (threadId && !thread) {
        return { error: 'Session references a missing canonical Thread', status: 409 };
    }
    if (!thread) return deleteSession(sessionId) ? { deleted: true } : { error: 'Session not found', status: 404 };
    const detached = { ...thread, sessionIds: (thread.sessionIds || []).filter(id => id !== session.id), updatedAt: new Date().toISOString() };
    try {
        saveSignalThread(detached);
        if (!deleteSession(session.id)) throw new Error('Unable to delete Session');
        return { deleted: true };
    } catch (error) {
        try { saveSignalThread(thread); } catch (_) { /* preserve original error */ }
        return { error: 'Unable to delete Session safely', status: 500 };
    }
}

module.exports = {
    LIMITS,
    buildContinuityContext,
    resolveSessionContinuity,
    linkSessionToThread,
    deleteSessionWithDetach,
};
