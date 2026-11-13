# Separate outputs: multichannel audio on tablets (#481, #25)

As of 2026-11-03 (device findings updated 2026-11-12), measured with a Behringer UMC204HD (4 outputs: A = 1/2, B = 3/4, 2 inputs, USB Audio Class 2, class compliant). Goal: the click only on the in-ears, the track to FOH - also on a single Android tablet without a Stage-Server (docs/25); this is the core of what sets StageBoard apart.

## 1. Decisions (Marco)

- Allow every path, show the real channel count and why; only channels that exist are offered.
- **Never a wrong signal to the audience:** no mixing down onto one output as a fallback. If the output goes away, only this device's audio stops; show clock, prompter and cues keep running, a red warning on all devices, resume only via Play.
- The native Android module comes first.

## 2. What each path can do

| Path | Channels | Unplugging the interface |
|---|---|---|
| Chrome/WebView (also the Capacitor app) | 2 (`maxChannelCount`) | Android reroutes to the speaker |
| Chrome on Linux | 2, with the PipeWire setting `pulse.default.position = [ FL FR RL RR ]` 4 | - |
| Android `AudioTrack` with a channel index mask | 4 discrete, ~78 ms | **reroutes to the speaker after 67-86 ms** - unsuitable |
| Android AAudio on a fixed device id | 4 discrete; Redmi ~12.5 ms, Fire ~114 ms | `AAUDIO_ERROR_DISCONNECTED` at once, nothing from the speaker |
| Own USB driver (usbdevfs) | all the interface has | `ENODEV` at once, the app keeps running |

Normal apps (Spotify) play stereo; on a 4-channel interface Android copies it onto 3/4 as well. Only who addresses channels one by one (index mask, own driver) gets separate signals.

In shared mode Android's media volume for the USB device is in the signal path (Redmi: step 5/15 = -40 dB). StageBoard has to show it and warn when it is not at 100 %.

## 3. Devices

| Device | Android driver | Own driver |
|---|---|---|
| Fire HD (KFTRPWI, Android 9) | ✅ AAudio 4 channels, separate by ear | output ✅, input hangs after 2 transfers |
| Redmi Pad SE 8.7 (Helio G85/MT8786, Android 16) | ✅ since 2026-11-12 through the Dell DA310 (was ❌ silent on 2026-11-03, see §3a), only 2 channels in the mixer, replug bug | output ✅ by ear, input ⚠️ (§5) |
| Samsung S26, Xiaomi phone | ✅ (Spotify) | not tested |

**Redmi, cause on 2026-11-03 (logcat, without root):** the MediaTek HAL drives USB itself (`AudioALSAPlaybackHandlerUsb`). The first write hangs 865 ms, then "I/O error", after that every attempt fails with "cannot prepare channel: Device or resource busy" - over 8000 times in 3 minutes. The isochronous stream never comes up; detection (control transfers) works. Errors are not reported to the app, AAudio shows "running, no underruns". On top, Xiaomi's "MiSound" mixes USB multichannel down to 2 channels internally and back up. Counter-check: Audio Evolution Mobile with its own driver ("eXtream") plays cleanly on the Redmi on 1/2 and 3/4.

### 3a. Redmi, device test 2026-11-12

- **Android's USB audio plays now** (native output via AAudio, Spotify too), the UMC on the Dell DA310. Android drives it with **2 channels** (front L/R) in its mixer; channels 3/4 stay silent until #743.
- **Replug bug:** after unplugging and replugging the UMC the low-latency USB output fails every write with "cannot prepare channel: Device or resource busy" again, and AAudio gives no timestamp. On reconnect Android also opens a 4-channel 192 kHz USB output (flags NONE) plus a duplicating thread. Spotify meanwhile plays on the deep-buffer output. **Only ending the app process** (swipe away and reopen, or a reboot) helps; the HAL then closes and reopens the output at once. Did not help: a page reload, reopening the stream without low latency (garbage timestamp of -252 s), releasing all audio for 4 s. #809 makes the missing timestamp visible ("Zeitpunkt nur geschätzt") instead of silent.
- **Only one USB audio device at a time:** with a NUX MG-30 (itself a USB audio interface) added through the same hub, Android took the UMC away (`DEVICE_STATE_UNAVAILABLE` for card 1) and made the MG-30 the USB output; StageBoard went to the safe fallback ("Ton: Notbetrieb"). Unplugging the MG-30 gave the UMC back within a second. **MIDI of both keeps working** - the MG-30 got its patch changes while the UMC was gone as audio device. Consequence: on this Redmi a modeller with USB audio and an audio interface cannot both be audio devices; USB MIDI only is fine.

**Hubs:** the Fire takes the host role on the Dell DA310 only without its power supply - there it is either charging or USB audio. The Redmi charges on the same dock and hosts at the same time. Hub/dock belong to compatibility.

**Lesson:** "detected" does not mean "plays". Plugging in needs a check: a test tone with a question, later automatic via a loopback cable (output into an input of the same interface).

## 4. Own USB driver (spike)

Code on branch `spike/native-audio-481` (`NativeAudioTestPlugin.java`, `src/main/cpp/usb_audio_test.cpp`), no third-party library:

- Java: `UsbManager` permission (dialog per plug-in), parse UAC1/UAC2 descriptors (channels, format, clock, endpoints), detach the interfaces from Android's driver with `claimInterface(…, true)`, select the alt setting, set the sample rate via `SET_CUR` on the clock source.
- C++: isochronous URBs via `USBDEVFS_SUBMITURB`/`REAPURB` on the file descriptor of the `UsbDeviceConnection`, 8 × 1 ms queued; packet size per 125 µs from the feedback endpoint (asynchronous mode, 16.16 format). Thread on audio priority (-19).
- Result on the Redmi: output 4 channels separate by ear, 0 packet errors, feedback 47 988 Hz is followed, unplugging detected cleanly. About 500 lines.

## 5. Input (open)

Loopback Main Out L → input 1, a burst every 500 ms. Some sessions are perfect: 99.9 % of the samples, **round trip 3.0-3.2 ms**, stable to ±0.02 ms (measured from the completion times of the transfers per direction; the MediaTek controller gives no bus frame number). Others lose 5-20 % from the start: input URBs take 1.05-1.25 ms instead of 1 ms, without an error status; bigger or more URBs make it worse. Ruled out: thread too late, screen/power saving, Android's driver in between, USB reset. Next steps: recording with eXtream as reference, a device without MediaTek, alt-setting order as in the Linux driver.

## 6. Order

1. Input stable, latency measured (§5).
2. Driver as a real output: a ring buffer the StageBoard audio engine (click, track, stems) writes into, on the shared clock; one session per plug-in, the stream keeps running in silence.
3. Device check on plug-in: decides between AAudio and the own driver.
4. Safe stop, red warning, unplugging; show the media volume.
5. UAC1 devices (desks), once test hardware is there.
6. Then server ALSA (#25) and setup notes for Windows/macOS.
