const KEY = 'ew-bitly:token';

export default function createTokenStore(storage) {
  let memory = '';
  let persistent = true;
  const safe = (fn) => {
    try {
      return fn();
    } catch {
      persistent = false;
      return null;
    }
  };
  memory = safe(() => storage.getItem(KEY)) || '';

  return {
    get: () => memory,
    set(token) {
      memory = String(token ?? '').trim();
      if (!memory) {
        safe(() => storage.removeItem(KEY));
        return;
      }
      safe(() => storage.setItem(KEY, memory));
    },
    clear() {
      memory = '';
      safe(() => storage.removeItem(KEY));
    },
    get persistent() { return persistent; },
  };
}
