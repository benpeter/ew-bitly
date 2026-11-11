import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { keepPointerCapture } from '../tools/bitly/capture.js';

describe('keepPointerCapture', () => {
  it('keeps the capture when the SDK hands a mouse drag to the host', () => {
    const released = [];
    const element = { releasePointerCapture: (id) => released.push(id) };
    assert.equal(keepPointerCapture(element), element);
    element.releasePointerCapture(1);
    assert.deepEqual(released, []);
  });
});
