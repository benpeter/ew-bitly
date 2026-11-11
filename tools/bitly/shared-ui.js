const NX = 'https://da.live/nx2';
const WAIT = 3000;

async function loadAll(load) {
  const { setConfig } = await load(`${NX}/scripts/nx.js`);
  // nx-picker draws its chevron from codeBase/img/icons. SVG <use> only works on the same
  // origin, so the icon ships with the plugin.
  await setConfig({ codeBase: new URL('.', import.meta.url).href.replace(/\/$/, '') });
  const [, , toast] = await Promise.all([
    load(`${NX}/blocks/shared/menu/menu.js`),
    load(`${NX}/blocks/shared/popover/popover.js`),
    load(`${NX}/blocks/shared/toast/toast.js`),
    load(`${NX}/blocks/shared/picker/picker.js`),
  ]);
  return { showToast: toast.showToast };
}

/**
 * Loads DA's shared menu, popover and toast (EW Style Guide). The menu reads the nx config
 * when its module runs, so the config is set first. The page maps da-lit in an import map.
 * The components fetch their CSS as they run; if that never answers, this gives up after
 * three seconds and the panel mounts without them.
 */
export default async function loadSharedUi(load = (href) => import(href)) {
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('DA shared UI did not load')), WAIT);
  });
  try {
    return await Promise.race([loadAll(load), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
