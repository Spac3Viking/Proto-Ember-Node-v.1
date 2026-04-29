'use strict';

const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, '..', 'assets', 'ember-node-icon.png');
const icoPath = path.join(__dirname, '..', 'assets', 'ember-node-icon.ico');

function buildIcoFromPng(pngBuffer) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);

    const entry = Buffer.alloc(16);
    entry.writeUInt8(0, 0); // width 256
    entry.writeUInt8(0, 1); // height 256
    entry.writeUInt8(0, 2); // palette colors
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits-per-pixel
    entry.writeUInt32LE(pngBuffer.length, 8);
    entry.writeUInt32LE(header.length + entry.length, 12);

    return Buffer.concat([header, entry, pngBuffer]);
}

if (!fs.existsSync(pngPath)) {
    console.error('[installer-icon] Missing source PNG:', pngPath);
    process.exit(1);
}

const pngBuffer = fs.readFileSync(pngPath);
if (pngBuffer.length < 8 || pngBuffer.readUInt32BE(0) !== 0x89504e47) {
    console.error('[installer-icon] Source file is not a PNG:', pngPath);
    process.exit(1);
}

fs.writeFileSync(icoPath, buildIcoFromPng(pngBuffer));
console.log('[installer-icon] Wrote', icoPath);
