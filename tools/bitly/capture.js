/*
 * Chrome sends every mouse event to the iframe where the button went down, until it goes
 * up. The SDK drag (da-nx nx/utils/sdk/drag.js) releases the pointer capture after
 * dragStart for mouse drags and expects the host overlay to get the rest; it never does,
 * so the drop doesn't finish. Keeping the capture sends moves and the release through the
 * extension, the same path the SDK uses for touch, and the host maps the points.
 */
export default function keepPointerCapture(element) {
  element.releasePointerCapture = () => {};
  return element;
}
