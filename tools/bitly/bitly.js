// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import mountPanel from './panel.js';

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
  const { context, actions, capabilities } = await DA_SDK;
  clearTimeout(timer);
  const teardown = mountPanel(document.body, {
    context, actions, capabilities, storage: browserStorage(),
  });
  window.addEventListener('pagehide', teardown, { once: true });
}
