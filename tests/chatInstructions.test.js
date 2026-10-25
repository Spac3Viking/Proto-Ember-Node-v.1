'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('chat instruction ownership', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-chat-instructions-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        fs.rmSync(dataRoot, { recursive: true, force: true });
    });

    test('preserves user edits and deliberately replaces only application defaults', () => {
        const instructions = require('../app/chatInstructions');
        instructions.ensureChatInstructionFiles();
        fs.writeFileSync(instructions.IDENTITY_FILE, 'My identity instructions.', 'utf8');
        fs.writeFileSync(instructions.USER_CONTEXT_FILE, 'My manually maintained context.', 'utf8');

        instructions.ensureChatInstructionFiles();
        expect(fs.readFileSync(instructions.IDENTITY_FILE, 'utf8')).toBe('My identity instructions.');

        instructions.replaceDefaultInstructionFiles();
        expect(fs.readFileSync(instructions.IDENTITY_FILE, 'utf8')).toContain('fallible librarian');
        expect(fs.readFileSync(instructions.IDENTITY_FILE + '.previous', 'utf8')).toBe('My identity instructions.');
        expect(fs.readFileSync(instructions.USER_CONTEXT_FILE, 'utf8')).toBe('My manually maintained context.');
    });

    test('restores a missing default and reports unreadable instructions explicitly', () => {
        const instructions = require('../app/chatInstructions');
        instructions.ensureChatInstructionFiles();
        fs.unlinkSync(instructions.SPIRAL_FILE);
        instructions.ensureChatInstructionFiles();
        expect(fs.readFileSync(instructions.SPIRAL_FILE, 'utf8')).toContain('Observe → Reflect → Act');

        const readFileSync = fs.readFileSync;
        jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
            if (file === instructions.IDENTITY_FILE) throw new Error('permission denied');
            return readFileSync(file, ...args);
        });
        const active = instructions.getActiveInstructions();
        expect(active.errors).toEqual([expect.stringContaining('Could not read green-fire-identity.md')]);
        expect(active.files.find(file => file.path === instructions.IDENTITY_FILE).content).toBe('');
        fs.readFileSync.mockRestore();
    });
});
