const { resolveModelRuntimeForRequest } = require('../app/modelRoles');
const { resolveEmberPrimeRuntime, OLLAMA_CHAT_URL } = require('../app/runtimeStewardship');
const { saveAiConfig } = require('../app/aiConfig');

describe('Phase 17C — model roles + routing', () => {
    test('legacy config without model_roles falls back to selected_model', () => {
        const res = resolveModelRuntimeForRequest({
            depth: 'ember',
            query: 'hello',
            aiConfig: { provider: 'ollama', selected_model: 'gemma3:4b' },
        });

        expect(res.model).toBe('gemma3:4b');
        expect(res.modelRole).toBe('hearth');
        expect(res.fallbackUsed).toBe(false);
    });

    test('depth routing maps archive -> forge', () => {
        const res = resolveModelRuntimeForRequest({
            depth: 'archive',
            query: 'hello',
            aiConfig: { provider: 'ollama', selected_model: 'gemma3:4b' },
        });

        expect(res.model).toBe('gemma3:4b');
        expect(res.modelRole).toBe('forge');
    });

    test('task routing prefers scribe for structured formats', () => {
        const res = resolveModelRuntimeForRequest({
            depth: 'ember',
            query: 'Return this as JSON: {"ok": true}',
            aiConfig: { provider: 'ollama', selected_model: 'gemma3:4b' },
        });

        expect(res.modelRole).toBe('scribe');
        expect(res.taskRoute).toBe('json');
        expect(res.roleSource).toBe('task');
        expect(res.model).toBe('gemma3:4b');
    });

    test('blank role models keep single-model mode clean', () => {
        const res = resolveModelRuntimeForRequest({
            depth: 'archive',
            query: 'hello',
            aiConfig: {
                provider: 'ollama',
                selected_model: 'gemma3:4b',
                model_roles: { hearth: '', forge: '', scribe: '' },
            },
        });

        expect(res.modelRole).toBe('forge');
        expect(res.model).toBe('gemma3:4b');
        expect(res.fallbackUsed).toBe(false);
        expect(res.fallbackReason).toBe(null);
        expect(res.requestedRoleModel).toBe(null);
    });

    test('configured Forge role missing at runtime falls back to selected_model', () => {
        const res = resolveModelRuntimeForRequest({
            depth: 'archive',
            query: 'hello',
            installedModels: ['gemma3:4b'],
            aiConfig: {
                provider: 'ollama',
                selected_model: 'gemma3:4b',
                model_roles: { hearth: '', forge: 'qwen2.5:14b', scribe: '' },
            },
        });

        expect(res.modelRole).toBe('forge');
        expect(res.requestedRoleModel).toBe('qwen2.5:14b');
        expect(res.model).toBe('gemma3:4b');
        expect(res.fallbackUsed).toBe(true);
        expect(res.fallbackReason).toBe('role_model_not_installed');
    });

    test('configured Scribe role missing at runtime falls back to selected_model', () => {
        const res = resolveModelRuntimeForRequest({
            depth: 'ember',
            query: 'format this as JSON',
            installedModels: ['gemma3:4b'],
            aiConfig: {
                provider: 'ollama',
                selected_model: 'gemma3:4b',
                model_roles: { hearth: '', forge: '', scribe: 'deepseek-coder:6.7b' },
            },
        });

        expect(res.modelRole).toBe('scribe');
        expect(res.requestedRoleModel).toBe('deepseek-coder:6.7b');
        expect(res.model).toBe('gemma3:4b');
        expect(res.fallbackUsed).toBe(true);
        expect(res.fallbackReason).toBe('role_model_not_installed');
    });

    test('blank Forge role falls back cleanly when other roles are configured', () => {
        const res = resolveModelRuntimeForRequest({
            depth: 'archive',
            query: 'hello',
            installedModels: ['gemma3:4b', 'deepseek-coder:6.7b'],
            aiConfig: {
                provider: 'ollama',
                selected_model: 'gemma3:4b',
                model_roles: { hearth: '', forge: '', scribe: 'deepseek-coder:6.7b' },
            },
        });

        expect(res.modelRole).toBe('forge');
        expect(res.model).toBe('gemma3:4b');
        expect(res.fallbackUsed).toBe(true);
        expect(res.fallbackReason).toBe('role_model_blank');
    });

    test('configured role models override selected_model', () => {
        const aiConfig = {
            provider: 'ollama',
            selected_model: 'gemma3:4b',
            model_roles: {
                hearth: 'spark:1b',
                forge: 'qwen2.5:14b',
                scribe: 'deepseek-coder:6.7b',
            },
        };

        const hearth = resolveModelRuntimeForRequest({ depth: 'ember', query: 'hi', aiConfig });
        const forge = resolveModelRuntimeForRequest({ depth: 'archive', query: 'hi', aiConfig });
        const scribe = resolveModelRuntimeForRequest({ depth: 'ember', query: 'format as JSON', aiConfig });

        expect(hearth.modelRole).toBe('hearth');
        expect(hearth.model).toBe('spark:1b');

        expect(forge.modelRole).toBe('forge');
        expect(forge.model).toBe('qwen2.5:14b');

        expect(scribe.modelRole).toBe('scribe');
        expect(scribe.model).toBe('deepseek-coder:6.7b');
    });
});

describe('Phase 17C — resolveEmberPrimeRuntime() compatibility', () => {
    beforeEach(() => {
        // Ensure we cover the legacy "no model_roles" config shape.
        saveAiConfig({ provider: 'ollama', selected_model: 'gemma3:4b' });
    });

    test('supports no-arg calls and returns runtime metadata', () => {
        const runtime = resolveEmberPrimeRuntime();
        expect(runtime).toBeInstanceOf(Promise);
    });

    test('resolves runtime metadata asynchronously', async () => {
        const runtime = await resolveEmberPrimeRuntime();
        expect(runtime).toHaveProperty('chatUrl', OLLAMA_CHAT_URL);
        expect(runtime).toHaveProperty('runtimeId', 'ollama-local');
        expect(runtime).toHaveProperty('model', 'gemma3:4b');
        expect(runtime).toHaveProperty('modelRole');
        expect(typeof runtime.fallbackUsed).toBe('boolean');
        expect(runtime).toHaveProperty('fallbackReason');
        expect(runtime).toHaveProperty('requestedRoleModel');
    });
});
