// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import mountPanel from './panel.js';

const outside = () => {
  document.body.textContent = 'Open this panel from Experience Workspace.';
};

if (window.top === window) {
  outside();
} else {
  const timer = setTimeout(outside, 5000);
  const { context, actions, capabilities } = await DA_SDK;
  clearTimeout(timer);
  const teardown = mountPanel(document.body, { context, actions, capabilities });
  window.addEventListener('pagehide', teardown, { once: true });
}
