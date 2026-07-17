'use strict';

const { isValidStorageId } = require('./safeStorageId');
const { loadSession, updateSession } = require('./sessions');
const { loadSignalThread, addSessionToSignalThread } = require('./signalThreads');

const LIMITS = Object.freeze({
    sessionNotes: 1800,
    entry: 420,
    entries: 2,
    sessionLinks: 4,
});

function clip(value, max) {
    const text = String(value || '').trim();
    return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

function recent(entries, count) {
    return (Array.isArray(entries) ? entries : [])
        .slice()
        .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
        .slice(0, count)
        .map(entry => clip(entry && entry.content, LIMITS.entry))
        .filter(Boolean);
}

function buildContinuityContext(session, thread, question = '') {
    const current = session && typeof session === 'object' ? session : {};
    const linked = thread && typeof thread === 'object' ? thread : null;
    const lines = [
        '=== Current Session ===',
        'Title: ' + clip(current.title, 160),
        'Stage: ' + clip(current.currentStage, 40),
    ];
    const notes = (Array.isArray(current.entries) ? current.entries : [])
        .map(entry => clip(entry && entry.notes, LIMITS.sessionNotes))
        .filter(Boolean);
    if (notes.length) lines.push('Notes:\n' + notes.join('\n'));
    if (linked) {
        lines.push('', '=== Current Thread ===', 'Title: ' + clip(linked.title, 160));
        if (linked.purpose) lines.push('Purpose: ' + clip(linked.purpose, 500));
        if (linked.currentSituation) lines.push('Current situation: ' + clip(linked.currentSituation, 700));
        const pressures = (Array.isArray(linked.openPressures) ? linked.openPressures : [])
            .map(value => clip(value, LIMITS.entry)).filter(Boolean).slice(0, 4);
        if (pressures.length) lines.push('Open pressures:\n- ' + pressures.join('\n- '));
        const carry = recent(linked.carryForwardEntries, LIMITS.entries);
        if (carry.length) lines.push('Carry-forward:\n- ' + carry.join('\n- '));
        const observations = recent(linked.observations, LIMITS.entries);
        if (observations.length) lines.push('Recent observations:\n- ' + observations.join('\n- '));
        const reflections = recent(linked.reflections, LIMITS.entries);
        if (reflections.length) lines.push('Recent reflections:\n- ' + reflections.join('\n- '));
    }
    if (question) lines.push('', 'Current question: ' + clip(question, 4000));
    return lines.join('\n');
}

function resolveSessionContinuity(sessionId, question = '') {
    if (!isValidStorageId(sessionId)) return { error: 'Invalid session id', status: 400 };
    const session = loadSession(sessionId);
    if (!session) return { error: 'Session not found', status: 404 };
    const threadId = session.continuity && session.continuity.threadId;
    const thread = threadId ? loadSignalThread(threadId) : null;
    return { session, thread, context: buildContinuityContext(session, thread, question) };
}

function linkSessionToThread(sessionId, threadId, { allowSwitch = false } = {}) {
    if (!isValidStorageId(sessionId)) return { error: 'Invalid session id', status: 400 };
    if (!isValidStorageId(threadId)) return { error: 'Invalid thread id', status: 400 };
    const session = loadSession(sessionId);
    if (!session) return { error: 'Session not found', status: 404 };
    const thread = loadSignalThread(threadId);
    if (!thread) return { error: 'Thread not found', status: 404 };
    const currentThreadId = session.continuity && session.continuity.threadId;
    if (currentThreadId && currentThreadId !== thread.id && !allowSwitch) {
        return { error: 'Session is already linked to another Thread', status: 409 };
    }
    const latest = entries => recent(entries, 1)[0] || '';
    const linkedIds = (Array.isArray(thread.sessionIds) ? thread.sessionIds : [])
        .map(id => loadSession(id)).filter(Boolean)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const updatedSession = updateSession(session.id, {
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
    });
    const updatedThread = addSessionToSignalThread(thread.id, updatedSession.id);
    return { session: updatedSession, thread: updatedThread };
}

module.exports = {
    LIMITS,
    buildContinuityContext,
    resolveSessionContinuity,
    linkSessionToThread,
};
