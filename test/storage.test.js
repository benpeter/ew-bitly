import { it, describe } from 'node:test';
import assert from 'node:assert/strict';
import createTokenStore from '../tools/bitly/storage.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

describe('createTokenStore', () => {
  it('saves, reads and forgets a trimmed token', () => {
    const storage = fakeStorage();
    const store = createTokenStore(storage);
    assert.equal(store.get(), '');
    store.set('  abc  ');
    assert.equal(store.get(), 'abc');
    assert.equal(storage.map.get('ew-bitly:token'), 'abc');
    store.clear();
    assert.equal(store.get(), '');
    assert.equal(storage.map.size, 0);
    assert.equal(store.persistent, true);
  });

  it('treats an empty token as forget', () => {
    const store = createTokenStore(fakeStorage());
    store.set('abc');
    store.set('   ');
    assert.equal(store.get(), '');
  });

  it('keeps the token in memory when storage is blocked', () => {
    const blocked = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    const store = createTokenStore(blocked);
    store.set('abc');
    assert.equal(store.get(), 'abc');
    assert.equal(store.persistent, false);
  });
});
