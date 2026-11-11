export default function createTokenStore(storage, key = 'ew-bitly:token') {
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
  memory = safe(() => storage.getItem(key)) || '';

  return {
    get: () => memory,
    set(token) {
      memory = String(token ?? '').trim();
      if (!memory) {
        safe(() => storage.removeItem(key));
        return;
      }
      safe(() => storage.setItem(key, memory));
    },
    clear() {
      memory = '';
      safe(() => storage.removeItem(key));
    },
    get persistent() { return persistent; },
  };
}
