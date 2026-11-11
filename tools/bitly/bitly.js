// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import mountPanel from './panel.js';
import loadSharedUi from './shared-ui.js';

const outside = () => {
  document.body.textContent = 'Open this panel from Experience Workspace.';
};

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

if (window.top === window) {
  outside();
} else {
  const timer = setTimeout(outside, 10000);
  // Without DA's shared menu, popover and toast the panel still works.
  const [{ context, actions, capabilities }, ui] = await Promise.all([
    DA_SDK, loadSharedUi().catch(() => ({})),
  ]);
  clearTimeout(timer);
  const teardown = mountPanel(document.body, {
    context, actions, capabilities, storage: browserStorage(), showToast: ui.showToast,
  });
  window.addEventListener('pagehide', teardown, { once: true });
}
