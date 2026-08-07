













export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  
  
  
  
  
  if (
    /Macintosh/.test(ua) &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  ) {
    return true;
  }
  return false;
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
  
  
  if (isIOS() && !isIOSStandalone()) return false;
  return true;
}

export function canMakeWebRTCCall(): boolean {
  if (typeof window === 'undefined') return false;
  
  
  
  if (isIOS() && !isIOSStandalone()) return false;
  return true;
}
