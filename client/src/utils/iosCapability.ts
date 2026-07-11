// iOS + PWA capability detection. iOS Safari has stricter rules
// than Android/Desktop browsers:
//
//   * Web Push (pushManager.subscribe) only works when the app is
//     installed to the home screen as a PWA (iOS 16.4+). In a
//     regular Safari tab the subscribe() call rejects with
//     NotAllowedError and pushes silently no-op.
//   * WebRTC is more reliable in installed PWAs; regular Safari
//     tabs occasionally drop peer connections when the page is
//     backgrounded (e.g. user pulls down notification center).
//   * `navigator.standalone` is set to true on iOS home-screen apps
//     and never set otherwise. `display-mode: standalone` works on
//     Android/Desktop PWAs but NOT on iOS home-screen apps.
//
// `windowControlsOverlay` is a Chromium-only feature, so its
// presence identifies a desktop PWA and lets us skip the iOS
// branch on iPad-on-mac (where the iPad user agent is reported).

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isiOS = /iPad|iPhone|iPod/.test(ua);
  // iPad-on-mac pretends to be a Mac. If it has the windowControlsOverlay
  // Chromium feature, it's a desktop browser, not a touch iPad.
  const isMac = /Macintosh/.test(ua) && !('windowControlsOverlay' in window);
  return isiOS || isMac;
}

export function isIOSStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const dm = window.matchMedia ? window.matchMedia('(display-mode: standalone)').matches : false;
  const legacyIos = (navigator as any)?.standalone === true;
  return dm || legacyIos;
}

export function canIOSReceivePush(): boolean {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  // iOS Safari requires home-screen install for Web Push. Android/Desktop
  // PWAs work in-browser.
  if (isIOS() && !isIOSStandalone()) return false;
  return true;
}

export function canMakeWebRTCCall(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari in a regular tab occasionally drops WebRTC when the
  // page is backgrounded. Forcing the user to install the PWA first
  // is a much more reliable call experience.
  if (isIOS() && !isIOSStandalone()) return false;
  return true;
}
