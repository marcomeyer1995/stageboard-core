// WebUSB isn't in TypeScript's lib.dom.d.ts (still an experimental API) - minimal ambient
// declarations for just what #106's detection code needs, not a full spec surface.
interface USBDevice {
  vendorId: number
  productId: number
}
interface USBConnectionEvent {
  device: USBDevice
}
interface USB {
  getDevices: () => Promise<USBDevice[]>
  addEventListener: (type: 'connect', listener: (event: USBConnectionEvent) => void) => void
  removeEventListener: (type: 'connect', listener: (event: USBConnectionEvent) => void) => void
}
declare global {
  interface Navigator {
    usb?: USB
  }
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator && navigator.usb !== undefined
}

interface UsbListenHandle {
  stop: () => void
}

/**
 * Reports every already-paired USB device at call time, then every later `connect` event
 * (still only devices this origin was already granted access to via a prior
 * `navigator.usb.requestDevice()` user gesture - WebUSB, unlike WebMIDI, never silently reveals
 * an unpaired device to a page). Returns null when the browser has no WebUSB support, matching
 * webMidi.ts's graceful-degradation style.
 */
export async function listenForUsbConnections(onConnect: (device: USBDevice) => void): Promise<UsbListenHandle | null> {
  if (!isWebUsbSupported()) return null
  const usb = navigator.usb as USB

  const existing = await usb.getDevices()
  existing.forEach(onConnect)

  const handler = (event: USBConnectionEvent) => onConnect(event.device)
  usb.addEventListener('connect', handler)

  return {
    stop: () => usb.removeEventListener('connect', handler),
  }
}
