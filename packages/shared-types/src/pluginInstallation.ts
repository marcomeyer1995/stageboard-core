import { z } from 'zod'
import { CapabilityIdSchema } from './capability.js'
import { TransportDescriptorSchema } from './transport.js'
import { HardwareIdSchema } from './hardwareId.js'
import { DiscoveryTriggerSchema } from './discoveryTrigger.js'
import { CapabilityTimingSchema } from './timing.js'

/**
 * Where a plugin actually runs. WebMIDI is a browser API and therefore lives on the
 * tablet; a mixer adapter talks to hardware and lives on the Stage-Server. That
 * difference decides who reports the plugin's health (see pluginHealth.ts).
 */
export const PluginRuntimeSchema = z.enum(['client', 'server', 'both'])
export type PluginRuntime = z.infer<typeof PluginRuntimeSchema>

/**
 * The version of the add-on interface this StageBoard speaks (docs/32 §10). Small additions
 * stay backwards compatible; it rises only when something breaks, and then an add-on built
 * against another version is not loaded (`apiVersionFits`).
 */
export const ADDON_API_VERSION = 1

/** Health message code for an add-on whose `apiVersion` does not match (translated on the device, docs/03). */
export const API_VERSION_MISMATCH_CODE = 'plugin.apiVersion'

/**
 * What an add-on asks to be allowed (docs/32 §7): `midi-out:<port pattern>`, `midi-in:<port
 * pattern>`, `osc:<host:port>`, `http:<origin>`, `helper:<add-on id>`, or one of the plain
 * `audio-store`, `songs:read`, `songs:write`. Confirmed by the band when installing; the
 * sandbox (#757, #761) refuses anything not listed here.
 */
export const PermissionSchema = z
  .string()
  .regex(/^(?:(?:midi-out|midi-in|osc|http|helper):.+|audio-store|songs:read|songs:write)$/)
export type Permission = z.infer<typeof PermissionSchema>

/** SHA-256 of a signing certificate, lowercase hex - what Android reports for an installed package. */
const CertSha256Schema = z.string().regex(/^[0-9a-f]{64}$/)

/**
 * The native helper programs an add-on needs per platform (docs/32 §8). `desktop`: a program
 * on a laptop/box host (the host reports whether it is there, `GET /server/capabilities`).
 * `android`: a separate app package next to StageBoard; only a package signed with one of
 * `certSha256` is ever talked to - the add-on's trust list, not the device's.
 */
export const HelpersSchema = z.object({
  desktop: z.object({ program: z.string().min(1), minVersion: z.string().optional() }).optional(),
  android: z
    .object({
      package: z.string().min(1),
      minVersionCode: z.number().int().positive().optional(),
      certSha256: z.array(CertSha256Schema).min(1),
    })
    .optional(),
})
export type Helpers = z.infer<typeof HelpersSchema>

/**
 * A plugin the band has installed. This document is replicated per workspace, so
 * installing a plugin on one tablet distributes it across the whole stage mesh -
 * every other tablet and the Stage-Server pick it up through CouchDB replication.
 *
 * It carries the plugin's *manifest*, not its code; loading plugin code from a
 * GitHub repository (docs/01) is a later step.
 */
export const PluginInstallationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  /** Where the Stage-Server fetches this plugin's *server-side* code from, for #17's dynamic
   * code loading (not built yet). */
  source: z.string().optional(),
  /** Where a tablet fetches this plugin's *client-side* bundle from (#101) - an ES module
   * exporting a `ClientPluginModule` default (stage-pwa's `loadClientPlugin.ts`). Absent for a
   * plugin with nothing to run in the browser (e.g. a purely server-hosted mixer adapter). */
  clientSource: z.string().optional(),
  runtime: PluginRuntimeSchema,
  capabilities: z.array(CapabilityIdSchema).default([]),
  /** Transports this plugin can drive a device through, and what each one's config needs
   * (#100) - e.g. `usb-midi` needs a `midiOutputId`. Empty for a plugin with nothing to
   * configure (the mock plugins today). The actual per-tablet values live in
   * DeviceTransportConfig, never here - this is just what the *fields* are. */
  transports: z.array(TransportDescriptorSchema).default([]),
  /** Cheap identity metadata (#106) so a tablet can recognize a newly-connected WebMIDI/WebUSB
   * device that matches this plugin, without loading its code - see hardwareId.ts. Empty for a
   * plugin with nothing to auto-detect (the server-only mock plugins today). */
  hardwareIds: z.array(HardwareIdSchema).default([]),
  /** How Discovery Mode should ask a musician to physically identify this device when catalog
   * metadata alone can't tell two candidates apart (e.g. two guitarists' Kempers) - see
   * discoveryTrigger.ts. Absent for a plugin with no such action (or nothing that needs
   * disambiguating - a workspace rarely has two of the same server-only mixer, say). */
  discoveryTrigger: DiscoveryTriggerSchema.optional(),
  /** How precisely each of `capabilities` must land on the song time, whether its Translator
   * sends at `scheduledAt` itself, its known latency and how it can be calibrated (docs/21) - one
   * entry per capability that has an output. A capability without an entry is treated as class
   * `none`, acting on receipt; absent altogether on manifests installed before docs/21. */
  timing: z.array(CapabilityTimingSchema).optional(),
  enabled: z.boolean().default(true),
  installedAt: z.number().int().nonnegative(),
  /** Which version of the add-on interface this manifest was written against (docs/32 §10).
   * Absent on manifests from before the field: treated as the version of the day, 1. */
  apiVersion: z.number().int().positive().optional(),
  /** What the add-on may do (docs/32 §7). Absent = nothing beyond receiving events; the
   * built-in add-ons list what they really use so the move into the sandbox changes nothing. */
  permissions: z.array(PermissionSchema).optional(),
  /** Native helper programs per platform (docs/32 §8). */
  helpers: HelpersSchema.optional(),
  /** The band's own settings for this plugin (e.g. piper-speech's voice, #63) - replicated with the
   * installation, so every device and the Stage-Server see the same. Free-form here; each plugin
   * parses its part with its own schema (speech.ts). */
  settings: z.record(z.string(), z.unknown()).optional(),
})
export type PluginInstallation = z.infer<typeof PluginInstallationSchema>

/** Whether this StageBoard can load the add-on at all: same interface version, or none stated. */
export function apiVersionFits(manifest: Pick<PluginInstallation, 'apiVersion'>): boolean {
  return manifest.apiVersion === undefined || manifest.apiVersion === ADDON_API_VERSION
}

/** The signing certificates (lowercase hex) of Android helpers this add-on trusts - empty when it has none. */
export function androidHelperCerts(manifest: Pick<PluginInstallation, 'helpers'>): readonly string[] {
  return manifest.helpers?.android?.certSha256 ?? []
}
