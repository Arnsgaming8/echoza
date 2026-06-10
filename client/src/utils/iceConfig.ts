let cachedIceConfig: RTCIceServer[] | null = null;

export async function getIceServers(): Promise<RTCIceServer[]> {
  if (cachedIceConfig) return cachedIceConfig;
  try {
    const res = await fetch('/api/ice-config');
    const data = await res.json();
    cachedIceConfig = data.iceServers as RTCIceServer[];
    return cachedIceConfig;
  } catch {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: ['turn:openrelay.metered.ca:80', 'turns:openrelay.metered.ca:443'],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ];
  }
}
