

























const DEVICE_ID_STORAGE_KEY = 'echoza:device-id';





let memoryFallbackId: string | null = null;

function generateDeviceId(): string {
  
  
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  
  
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getDeviceId(): string {
  
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (existing && existing.length > 0 && existing.length <= 256) return existing;
      const fresh = generateDeviceId();
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
      return fresh;
    }
  } catch {
    
    
  }

  if (!memoryFallbackId) {
    memoryFallbackId = generateDeviceId();
  }
  return memoryFallbackId;
}


export function withDeviceHeaders(
  init: RequestInit = {},
): RequestInit {
  const headers = new Headers(init.headers || {});
  headers.set('X-Device-Id', getDeviceId());
  
  
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    headers.set('User-Agent-Forwarded', navigator.userAgent.slice(0, 512));
  }
  return { ...init, headers };
}
