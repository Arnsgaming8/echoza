interface MeteredMeeting {
  join(options: { roomURL: string; name: string }): Promise<any>;
  startVideo(): Promise<void>;
  startAudio(): Promise<void>;
  stopVideo(): Promise<void>;
  stopAudio(): Promise<void>;
  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;
  leaveMeeting(): void;
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback: (...args: any[]) => void): void;
  getLocalVideoStream(): Promise<MediaStream>;
  listVideoInputDevices(): Promise<MediaDeviceInfo[]>;
  listAudioInputDevices(): Promise<MediaDeviceInfo[]>;
  listAudioOutputDevices(): Promise<MediaDeviceInfo[]>;
  chooseVideoInputDevice(deviceId: string): Promise<void>;
  chooseAudioInputDevice(deviceId: string): Promise<void>;
  chooseAudioOutputDevice(deviceId: string): Promise<void>;
}

interface Window {
  Metered: {
    Meeting: new () => MeteredMeeting;
  };
}
