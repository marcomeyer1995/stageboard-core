import { CAPABILITIES, type PluginInstallation } from 'shared-types'

/**
 * The plugins a band can add without a plugin repository yet. Installing one writes a
 * document that replicates across the stage mesh - every other tablet and the
 * Stage-Server pick it up (docs/01).
 *
 * Shared between `PluginManager.tsx` (System → Plugins, direct install/manage) and the guided
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
    id: 'mock-lighting',
    name: 'Mock Lighting (DMX)',
    version: '0.0.1',
    // 'both', same reasoning as mock-mixer above - #98.
    runtime: 'both',
    capabilities: [CAPABILITIES.lighting, CAPABILITIES.showControl],
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
    transports: [],
    hardwareIds: [],
  },
]
