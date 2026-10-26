import { CAPABILITIES, type PluginInstallation } from 'shared-types'

/** What each capability does, in the band's words - the ids themselves ("click-track") are for
 * developers and stay off the screens (System cleanup, 2026-10-16). */
const CAPABILITY_LABEL: Record<string, string> = {
  [CAPABILITIES.mixer]: 'Mischpult',
  [CAPABILITIES.lighting]: 'Licht',
  [CAPABILITIES.showControl]: 'Show-Steuerung',
  [CAPABILITIES.midiInput]: 'MIDI-Eingang',
  [CAPABILITIES.audioPlayback]: 'Backing-Track',
  [CAPABILITIES.clickTrack]: 'Klick',
  [CAPABILITIES.backup]: 'Backup',
  [CAPABILITIES.audioAnalysis]: 'Track-Analyse',
  [CAPABILITIES.midiClock]: 'MIDI-Clock',
  [CAPABILITIES.midiController]: 'MIDI-Controller',
  [CAPABILITIES.speechSynthesis]: 'Sprachausgabe',
  [CAPABILITIES.stemSeparation]: 'Spuren trennen',
  [CAPABILITIES.sectionAnnouncements]: 'Ansagen',
  [CAPABILITIES.chordImport]: 'Akkord-Import',
  [CAPABILITIES.videoDownload]: 'YouTube-Download',
}

/** A plugin's capabilities as one readable line. A device's own capability ("kemper-control",
 * one per device - see the catalog below) reads "Gerätesteuerung"; any other unknown id (a newer
 * plugin) shows as it is. */
export function capabilitiesLabel(capabilities: readonly string[]): string {
  return capabilities.map((capability) => CAPABILITY_LABEL[capability] ?? (capability.endsWith('-control') ? 'Gerätesteuerung' : capability)).join(', ')
}

/**
 * Stand-ins that only log what they receive (System analysis, 2026-10-16): a fake mixer, fake
 * light and a backup that never happens. Only the dev app (and `vite dev`) offers them - in the
 * release app and the browser they can't be installed, and where one already is, its card says
 * "Test". Mock Click and Mock Playback too, since Klick and Backing-Track are built in
 * (Bühnentechnik) and Gig routing never sends a show to them (hardwareRouting STAND_IN_PLUGIN_IDS).
 */
export const TEST_PLUGIN_IDS: readonly string[] = ['mock-mixer', 'mock-lighting', 'mock-backup', 'mock-click', 'mock-playback']

/** The dev app's build (docs/03 §0c) sets VITE_DEV_APP=1. */
export const SHOW_TEST_PLUGINS = import.meta.env.DEV || import.meta.env.VITE_DEV_APP === '1'

/** Legally risky add-ons (#546, docs/16): Ultimate Guitar import and YouTube download. A sale build
 * (VITE_SALE_BUILD=1) doesn't offer them - before a real sale their code has to go entirely. */
export const SALE_BUILD_LEFT_OUT: readonly string[] = ['ultimate-guitar-import', 'youtube-download']
export const SALE_BUILD = import.meta.env.VITE_SALE_BUILD === '1'

export function isTestPlugin(id: string): boolean {
  return TEST_PLUGIN_IDS.includes(id)
}

/** Where a plugin is listed in System (2026-10-16): a driver talks to gear over a transport (MIDI,
 * network) and sits under Bühnentechnik; a test stand-in under Diagnose; the rest are Add-ons. */
export type PluginKind = 'extensions' | 'drivers' | 'test'

export function pluginKind(plugin: { id: string; transports?: readonly unknown[] }): PluginKind {
  if (isTestPlugin(plugin.id)) return 'test'
  return (plugin.transports ?? []).length > 0 ? 'drivers' : 'extensions'
}

/** The catalog this build offers to install. */
export function installableCatalog(showTestPlugins = SHOW_TEST_PLUGINS, saleBuild = SALE_BUILD): typeof PLUGIN_CATALOG {
  return PLUGIN_CATALOG.filter((entry) => (showTestPlugins || !isTestPlugin(entry.id)) && !(saleBuild && SALE_BUILD_LEFT_OUT.includes(entry.id)))
}

/**
 * The plugins a band can add without a plugin repository yet. Installing one writes a
 * document that replicates across the stage mesh - every other tablet and the
 * Stage-Server pick it up (docs/01).
 *
 * Shared between `PluginManager.tsx` (System → Add-ons, direct install/manage) and the guided
 * Hardware Setup Wizard's "type" step (`DeviceSetupWizard.tsx`) - picking a device type there
 * installs (or reuses) the matching catalog entry inline, rather than sending the admin to a
 * separate screen first.
 */
export const PLUGIN_CATALOG: Array<Omit<PluginInstallation, 'installedAt' | 'enabled'>> = [
  {
    id: 'mock-mixer',
    name: 'Mock Mixer',
    version: '0.0.1',
    // 'both': a real server-hosted mixer adapter (mockMixerPlugin.ts, core-backend) AND a
    // client-runtime Translator (clientTranslator.ts) sharing one manifest - #98. Which one
    // actually executes a given trigger is now the Logical Device's own executionTarget, not a
    // separate HardwareSetup routing decision.
    runtime: 'both',
    capabilities: [CAPABILITIES.mixer],
    // In-ear levels: a few tens of ms don't matter (docs/21 §2).
    timing: [{ capability: CAPABILITIES.mixer, timingClass: 'soft', honoursScheduledAt: false }],
    // Example transport (#100) - a real mixer adapter would offer this so a tablet claimed as
    // its executor can pick which desk it's actually talking to.
    transports: [
      {
        id: 'network-osc',
        label: 'Netzwerk (OSC)',
        fields: [
          { key: 'host', label: 'Host', type: 'text' },
          { key: 'port', label: 'Port', type: 'number' },
        ],
      },
    ],
    hardwareIds: [],
  },
  {
    id: 'generic-webmidi',
    name: 'Generic WebMIDI Input',
    version: '0.0.1',
    runtime: 'client',
    capabilities: [CAPABILITIES.midiInput],
    transports: [
      {
        id: 'usb-midi',
        label: 'USB-MIDI',
        fields: [{ key: 'midiOutputId', label: 'MIDI-Ausgang', type: 'text' }],
      },
    ],
    // No namePattern - a true catch-all, matching any WebMIDI input (#106). A device-specific
    // plugin (Kemper, RC-500, ...) declaring its own namePattern takes priority over this one -
    // see shared-types' hardwareMatching.ts.
    hardwareIds: [{ kind: 'webmidi' }],
  },
  {
    id: 'kemper-profiler',
    name: 'Kemper Profiler',
    version: '0.0.1',
    runtime: 'client',
    // Own dedicated capability (kemperTranslator.ts), not CAPABILITIES.midiInput/showControl -
    // a device-specific plugin brings its own vocabulary (capability.ts's doc comment).
    capabilities: ['kemper-control'],
    // Rig/stomp changes land on the beat; the Translator sends with a WebMIDI timestamp (#477).
    timing: [{ capability: 'kemper-control', timingClass: 'realtime', honoursScheduledAt: true }],
    transports: [
      {
        id: 'usb-midi',
        label: 'USB-MIDI',
        fields: [
          { key: 'midiOutputId', label: 'MIDI-Ausgang', type: 'text' },
          { key: 'midiChannel', label: 'MIDI-Kanal (1-16)', type: 'number' },
        ],
      },
    ],
    // More specific than generic-webmidi's catch-all, so shared-types' hardwareMatching.ts's
    // specific-beats-generic rule means plugging in a Kemper (or its emulator) resolves to this
    // plugin once installed, not generic-webmidi.
    hardwareIds: [{ kind: 'webmidi', namePattern: 'Kemper' }],
    // Same CC31 on/off pair kemperTranslator.ts's 'test' action already sends - Discovery
    // Mode's "please identify yourself" and the manual "Testen" button are the same wire signal.
    discoveryTrigger: {
      instruction: 'Tuner am Kemper kurz an- und wieder ausschalten.',
      matchCcSequence: [
        { cc: 31, value: 127 },
        { cc: 31, value: 0 },
      ],
      timeoutMs: 15000,
    },
  },
  {
    id: 'cq18t-mixer',
    name: 'Allen & Heath CQ-18T',
    version: '0.0.1',
    runtime: 'client',
    // Own dedicated capability (cq18tTranslator.ts) - see its own doc comment for why not
    // CAPABILITIES.mixer (that slot is a fixed, single local translator, not plugin-swappable).
    capabilities: ['cq18t-control'],
    // An in-ear mixer: soft (docs/21 §2), though its NRPNs go out timestamped anyway (#477).
    timing: [{ capability: 'cq18t-control', timingClass: 'soft', honoursScheduledAt: true }],
    transports: [
      {
        id: 'usb-midi',
        label: 'USB-MIDI',
        fields: [
          { key: 'midiOutputId', label: 'MIDI-Ausgang', type: 'text' },
          { key: 'midiChannel', label: 'MIDI-Kanal (1-16)', type: 'number' },
        ],
      },
    ],
    hardwareIds: [{ kind: 'webmidi', namePattern: 'CQ-18T' }],
    // Main LR mute toggled on then off - the exact 8-CC (2x NRPN set) sequence a musician
    // produces by pressing the master mute button twice on the real console, reused as-is by
    // cq18tTranslator.ts's own setMute('main', ...) action.
    discoveryTrigger: {
      instruction: 'Master-Mute am Pult kurz an- und wieder ausschalten.',
      matchCcSequence: [
        { cc: 99, value: 0x00 },
        { cc: 98, value: 0x44 },
        { cc: 6, value: 0x00 },
        { cc: 38, value: 0x01 },
        { cc: 99, value: 0x00 },
        { cc: 98, value: 0x44 },
        { cc: 6, value: 0x00 },
        { cc: 38, value: 0x00 },
      ],
      timeoutMs: 15000,
    },
  },
  {
    id: 'nux-mg30',
    name: 'NUX MG-30',
    version: '0.0.1',
    runtime: 'client',
    // Own dedicated capability (mg30Translator.ts) - a multi-effects unit's patch/knob
    // vocabulary doesn't fit any of capability.ts's core CAPABILITIES.
    capabilities: ['mg30-control'],
    timing: [{ capability: 'mg30-control', timingClass: 'realtime', honoursScheduledAt: true }],
    transports: [
      {
        id: 'usb-midi',
        label: 'USB-MIDI',
        fields: [
          { key: 'midiOutputId', label: 'MIDI-Ausgang', type: 'text' },
          { key: 'midiChannel', label: 'MIDI-Kanal (1-16)', type: 'number' },
        ],
      },
    ],
    hardwareIds: [{ kind: 'webmidi', namePattern: 'MG-30' }],
    // No discoveryTrigger: the MG-30's own identity-verification mechanism is a SysEx
    // handshake (mg30Translator.ts's 'test' action), not a CC sequence - Discovery Mode's
    // matchCcSequence is CC-only, so this device can't offer a physical-trigger disambiguation
    // the way Kemper/CQ-18T do. namePattern-only auto-assign (unambiguous case) and manual
    // fallback (ambiguous case) both already work with zero extra code.
  },
  {
    id: 'boss-rc500',
    name: 'BOSS RC-500',
    version: '0.0.1',
    runtime: 'client',
    // Own dedicated capability (rc500Translator.ts) - a looper's memory/track vocabulary
    // doesn't fit any of capability.ts's core CAPABILITIES.
    capabilities: ['rc500-control'],
    timing: [{ capability: 'rc500-control', timingClass: 'realtime', honoursScheduledAt: true }],
    transports: [
      {
        id: 'usb-midi',
        label: 'USB-MIDI',
        fields: [
          { key: 'midiOutputId', label: 'MIDI-Ausgang', type: 'text' },
          { key: 'midiChannel', label: 'MIDI-Kanal (1-16)', type: 'number' },
        ],
      },
    ],
    hardwareIds: [{ kind: 'webmidi', namePattern: 'RC-500' }],
    // No discoveryTrigger: the RC-500 has no fixed global CC table and no reliable
    // physical-trigger mechanism reachable over MIDI at all (docs/protocol-notes.md) - every
    // CC's meaning is per-memory and user-configured on the device itself, so there's no signal
    // this plugin could ask a musician to produce that's guaranteed to mean the same thing on
    // any given RC-500. namePattern-only auto-assign (unambiguous case) and manual fallback
    // (ambiguous case) both already work with zero extra code, same as NUX MG-30 above.
  },
  {
    id: 'soundcraft-ui24r',
    name: 'Soundcraft Ui24R',
    version: '0.0.1',
    runtime: 'client',
    // Own dedicated capability (ui24rTranslator.ts), same reasoning cq18t-mixer above
    // already documents for why not CAPABILITIES.mixer.
    capabilities: ['ui24r-control'],
    // WebSocket, acts on receipt - the core waits for the moment before calling it.
    timing: [{ capability: 'ui24r-control', timingClass: 'soft', honoursScheduledAt: false }],
    transports: [
      {
        id: 'network-ws',
        label: 'Netzwerk (WebSocket)',
        fields: [
          { key: 'host', label: 'IP-Adresse', type: 'text' },
          { key: 'port', label: 'Port', type: 'number' },
        ],
      },
    ],
    // No hardwareIds - WebSocket, not WebMIDI/WebUSB, so nothing here can ever appear in
    // "Automatisch erkannt". Manual host/port entry only (wizard's Step 3 fallback) -
    // graceful degradation, not a gap: every other device-specific plugin above still
    // auto-detects, this one just never will.
    hardwareIds: [],
    // No discoveryTrigger - Discovery Mode is WebMIDI-only end to end.
  },
  {
    id: 'mock-lighting',
    name: 'Mock Lighting (DMX)',
    version: '0.0.1',
    // 'both', same reasoning as mock-mixer above - #98.
    runtime: 'both',
    capabilities: [CAPABILITIES.lighting, CAPABILITIES.showControl],
    // Light is the case docs/21 was written for: realtime, calibratable with a light sensor
    // (full on, then off again). A real DMX plugin would also declare its interface's latency.
    timing: [
      {
        capability: CAPABILITIES.lighting,
        timingClass: 'realtime',
        honoursScheduledAt: false,
        calibration: { stimulus: { type: 'calibration.flash' }, reset: { type: 'calibration.dark' }, detectableBy: ['light'] },
      },
      { capability: CAPABILITIES.showControl, timingClass: 'realtime', honoursScheduledAt: false },
    ],
    transports: [],
    hardwareIds: [],
  },
  {
    id: 'mock-backup',
    name: 'Mock Backup',
    version: '0.0.1',
    runtime: 'server',
    capabilities: [CAPABILITIES.backup],
    transports: [],
    hardwareIds: [],
  },
  {
    id: 'mock-playback',
    name: 'Mock Playback',
    version: '0.0.1',
    runtime: 'server',
    capabilities: [CAPABILITIES.audioPlayback],
    timing: [{ capability: CAPABILITIES.audioPlayback, timingClass: 'sample', honoursScheduledAt: false }],
    transports: [],
    hardwareIds: [],
  },
  {
    id: 'music-tempo-beat-detection',
    name: 'Music-Tempo Beat-Erkennung',
    version: '1.0.0',
    // Unlike every other 'client' entry above, this isn't externally-hosted third-party code
    // fetched via loadClientPlugin.ts - `music-tempo` is a small (~14.5KB), MIT-licensed npm
    // package already bundled into stage-pwa itself (see analyzeTrack.ts), loaded via a dynamic
    // import() only once this plugin is installed and "Track analysieren" is actually run - no
    // `source`/`clientSource` needed. The built-in detector and the timeline always work without
    // this plugin; installing it only makes "Track analysieren" more accurate.
    runtime: 'client',
    capabilities: [CAPABILITIES.audioAnalysis],
    transports: [],
    hardwareIds: [],
  },
  {
    id: 'mock-click',
    name: 'Mock Click',
    version: '0.0.1',
    // 'server' like mock-playback above: the tablet-local path (clickEngine.ts's Web Audio
    // scheduler) needs no plugin at all (clientTranslator.ts's supportsLocalExecution special
    // case, same as audio-playback) - this catalog entry exists only so `click-track` is a
    // selectable "Typ" in the Hardware Setup Wizard when routing to the Stage-Server (#25's
    // still-unbuilt hardware-routed half - a real server-side click/MIDI-Clock plugin).
    runtime: 'server',
    capabilities: [CAPABILITIES.clickTrack],
    timing: [{ capability: CAPABILITIES.clickTrack, timingClass: 'sample', honoursScheduledAt: false }],
    transports: [],
    hardwareIds: [],
  },
  {
    id: 'midi-clock',
    name: 'MIDI-Clock',
    version: '0.0.1',
    runtime: 'client',
    // Generic (#478, Marco 2026-10-13): one "MIDI-Clock" device per piece of gear that should
    // follow the song tempo, bound to that gear's MIDI port - its own capability, no switch on the
    // gear's own device. 24 ticks per beat need exact timing: sent with WebMIDI timestamps.
    capabilities: [CAPABILITIES.midiClock],
    timing: [{ capability: CAPABILITIES.midiClock, timingClass: 'realtime', honoursScheduledAt: true }],
    transports: [
      {
        id: 'usb-midi',
        label: 'USB-MIDI',
        fields: [{ key: 'midiOutputId', label: 'MIDI-Ausgang', type: 'midi-output' }],
      },
    ],
    // Nothing to detect: the port belongs to the gear (Kemper, RC-500 …), whose own plugin claims it.
    hardwareIds: [],
  },
  {
    id: 'midi-controller',
    name: 'MIDI-Controller',
    version: '0.0.1',
    runtime: 'client',
    // Generic (#547, docs/23 §7): a foot controller, pad or keyboard plugged into a tablet - its
    // buttons trigger actions ("Knöpfe belegen" in the device's ⋯). Listens only; sends nothing.
    capabilities: [CAPABILITIES.midiController],
    transports: [
      {
        id: 'usb-midi',
        label: 'USB-MIDI',
        fields: [{ key: 'midiInputId', label: 'MIDI-Eingang', type: 'midi-input' }],
      },
    ],
    hardwareIds: [],
  },
  {
    id: 'piper-speech',
    name: 'Sprachausgabe (Piper)',
    version: '0.0.1',
    // The Stage-Server generates the voice for spoken announcements (#63) with Piper, an offline
    // speech program installed next to it (docs/21 §9) - each text once, as a clip every device
    // downloads. Without Piper on the server the plugin installs, but announcements stay silent.
    runtime: 'server',
    capabilities: [CAPABILITIES.speechSynthesis],
    transports: [],
    hardwareIds: [],
  },
  {
    id: 'osc',
    name: 'OSC (Licht & Video)',
    version: '0.1.0',
    // Generic OSC (#484): lighting and video software - QLC+, Resolume, ProPresenter, grandMA onPC.
    // Sent as UDP by the Stage-Server (core-backend oscPlugin.ts) - a browser can't send UDP - so the
    // device runs on the Stage-Server; host and port are set in Bühnentechnik. Its own capability
    // (like the MIDI-Clock, #478): one device per program that listens.
    runtime: 'server',
    capabilities: ['osc'],
    // The server holds a cue until its moment (scheduledAt) and sends it then.
    timing: [{ capability: 'osc', timingClass: 'realtime', honoursScheduledAt: true }],
    transports: [
      {
        id: 'network-osc',
        label: 'Netzwerk (OSC)',
        fields: [
          { key: 'host', label: 'Host (IP oder Name)', type: 'text' },
          { key: 'port', label: 'Port', type: 'number' },
        ],
      },
    ],
    hardwareIds: [],
  },
  {
    id: 'stem-separation',
    name: 'Spuren trennen (Stems)',
    version: '0.0.1',
    // Splits a song's track into stems - drums, bass, vocals, rest, optionally guitar (left/right)
    // and keys - on the Stage-Server with Demucs (#9, docs/03). Heavy (~1 GB, about a minute of
    // full CPU per song), so a plugin: without it the song editor offers no "Spuren trennen".
    runtime: 'server',
    capabilities: [CAPABILITIES.stemSeparation],
    transports: [],
    hardwareIds: [],
  },
  {
    id: 'ultimate-guitar-import',
    name: 'Ultimate Guitar Import',
    version: '0.0.1',
    // Search Ultimate Guitar for chord sheets under "Song importieren" (#546). An add-on: it reads a
    // third party's website (docs/16), so a band only has it when it installs it.
    runtime: 'server',
    capabilities: [CAPABILITIES.chordImport],
    transports: [],
    hardwareIds: [],
  },
  {
    id: 'youtube-download',
    name: 'YouTube-Download',
    version: '0.0.1',
    // "Von YouTube laden" in the song editor: the Stage-Server downloads a reference recording with
    // yt-dlp (#5, #546). An add-on for the same reason as Ultimate Guitar.
    runtime: 'server',
    capabilities: [CAPABILITIES.videoDownload],
    transports: [],
    hardwareIds: [],
  },
  {
    id: 'section-announcements',
    name: 'Ansagen der Songteile',
    version: '0.0.1',
    // "Chorus", "Bridge" a bar before the part, in the in-ears (#63): built into stage-pwa
    // (useAnnouncementDriver.ts), switched on by installing; the voice comes from piper-speech.
    runtime: 'client',
    capabilities: [CAPABILITIES.sectionAnnouncements],
    timing: [{ capability: CAPABILITIES.sectionAnnouncements, timingClass: 'sample', honoursScheduledAt: false }],
    transports: [],
    hardwareIds: [],
  },
]
