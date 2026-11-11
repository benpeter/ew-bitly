import { it, describe } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvg } from '../tools/bitly/qr.js';

describe('qr', () => {
  it('makes a square matrix for a short link', () => {
    const m = qrMatrix('https://bit.ly/3abcXYZ');
    assert.ok(m.length >= 21);
    assert.ok(m.every((row) => row.length === m.length));
    // finder pattern corner is dark
    assert.equal(m[0][0], true);
  });

  it('draws every dark module inside a quiet zone', () => {
    const text = 'https://bit.ly/3abcXYZ';
    const m = qrMatrix(text);
    const svg = qrSvg(text);
    const size = m.length + 8;
    assert.match(svg, new RegExp(`viewBox="0 0 ${size} ${size}"`));
    const dark = m.flat().filter(Boolean).length;
    assert.equal(svg.match(/h1v1h-1z/g).length, dark);
    assert.match(svg, /M4 4h1v1h-1z/);
  });

  it('puts no input text into the svg', () => {
    assert.doesNotMatch(qrSvg('<script>'), /<script>/);
  });
});
