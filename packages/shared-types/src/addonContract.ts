import { z } from 'zod'

/**
 * The one message contract between StageBoard and an add-on (docs/36 §4, #964). Every message an add-on and the core exchange - method calls,
 * job progress, device state, UI trees - travels in this envelope, so there is one boundary to validate instead of one per former message name.
 * The add-on and the core validate both ways: neither side ever sees a message that does not match this schema.
 */

/** The contract version an add-on declares as `protocol` in its manifest (docs/36 §3, §9). */
export const ADDON_CONTRACT_VERSION = 3

/**
 * An error as the add-on's domain describes it (docs/36 §4): `code` is stable and machine-readable so the app can branch on it, `message` is the
 * add-on's own text in the language it got in `init`. The core adds no message of its own for an add-on's domain.
 */
export const AddonErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})
export type AddonError = z.infer<typeof AddonErrorSchema>

/** Request and response ids count up per sandbox; they pair a response with its request and mark a stream. */
const EnvelopeIdSchema = z.number().int().nonnegative()

const RequestEnvelopeSchema = z.strictObject({
  kind: z.literal('request'),
  id: EnvelopeIdSchema,
  /** A method the manifest declared (`methods.*`, `jobs.*`, a helper run) - the envelope itself does not know any method. */
  method: z.string().min(1),
  body: z.unknown(),
})

/**
 * A response either carries a body or an error, never both (docs/36 §4). The pair is discriminated on `ok` rather than on `kind`: both answers
 * share `kind: 'response'`, and Zod refuses duplicate discriminator values in one union.
 */
const ResponseEnvelopeSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    kind: z.literal('response'),
    id: EnvelopeIdSchema,
    ok: z.literal(true),
    body: z.unknown(),
  }),
  z.strictObject({
    kind: z.literal('response'),
    id: EnvelopeIdSchema,
    ok: z.literal(false),
    error: AddonErrorSchema,
  }),
])

const NotifyEnvelopeSchema = z.strictObject({
  kind: z.literal('notify'),
  /** One-way news that needs no answer: `progress`, `log`, `health`, `state` (docs/36 §4, §5a). */
  topic: z.string().min(1),
  body: z.unknown(),
})

const SubscribeEnvelopeSchema = z.strictObject({
  kind: z.literal('subscribe'),
  id: EnvelopeIdSchema,
  /** The stream the add-on wants values from, e.g. a device state key. */
  stream: z.string().min(1),
})

const UpdateEnvelopeSchema = z.strictObject({
  kind: z.literal('update'),
  id: EnvelopeIdSchema,
  body: z.unknown(),
})

const UiSetEnvelopeSchema = z.strictObject({
  kind: z.literal('ui-set'),
  /** The slot the tree fills (`song-editor.track-source`, `device.panel`, ...) - slots are API, the core defines them (docs/36 §6). */
  slot: z.string().min(1),
  /** A tree of StageBoard's own building blocks, checked against the UI vocabulary by the app (Task 6), not here. */
  tree: z.unknown(),
})

const UiActionEnvelopeSchema = z.strictObject({
  kind: z.literal('ui-action'),
  slot: z.string().min(1),
  /** The action id the view script put on the node the person used. */
  action: z.string().min(1),
  value: z.unknown().optional(),
})

/**
 * The eight envelope shapes (docs/36 §4). Six of them are a discriminated union on `kind`; the response pair joins them as a union of its own
 * because both answers share the kind `response` (see `ResponseEnvelopeSchema`).
 */
export const EnvelopeSchema = z.union([
  ResponseEnvelopeSchema,
  z.discriminatedUnion('kind', [
    RequestEnvelopeSchema,
    NotifyEnvelopeSchema,
    SubscribeEnvelopeSchema,
    UpdateEnvelopeSchema,
    UiSetEnvelopeSchema,
    UiActionEnvelopeSchema,
  ]),
])

/**
 * A schema an add-on declares in its manifest (docs/36 §3): a JSON Schema object, checked at the boundary when it is used (Task 3), never here -
 * the core must not look inside an add-on's method signature. The shape itself is always an object with JSON Schema keywords.
 */
export const JsonSchema = z.record(z.string(), z.unknown())
export type JsonSchema = z.infer<typeof JsonSchema>

/**
 * The slots the core offers (docs/36 §6). A slot is API: only a StageBoard release adds one, because each slot ships with its component, its context
 * and its accessibility. An add-on that names another one is rejected instead of being shown somewhere it does not fit.
 */
export const SlotIdSchema = z.enum([
  'song-editor.track-source',
  'song-editor.panel',
  'device.panel',
  'settings.section',
  'lookup.source',
  'toolbar.action',
])
export type SlotId = z.infer<typeof SlotIdSchema>

/** One place an add-on fills in the UI - the `ui` list of its manifest (docs/36 §3, §6). The tree itself arrives later as a `ui-set`. */
export const UiContributionSchema = z.object({
  slot: SlotIdSchema,
  /** Stable within the add-on: the app tells a `ui-action` by `{slot, action}`, this id names the piece in health and logs. */
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().min(1).optional(),
})
export type UiContribution = z.infer<typeof UiContributionSchema>

/**
 * One value a device add-on publishes into the band's live state (docs/36 §5a): the latest value per key per device reaches every viewer, and widgets
 * bind to it (`{bind: "state:qlc-1.scene"}`). `enum` needs its `values`; `number` may be bounded by `min`/`max`.
 */
export const StateFieldSchema = z
  .object({
    type: z.enum(['enum', 'number', 'string', 'boolean']),
    values: z.array(z.union([z.string(), z.number()])).min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine((field) => field.type !== 'enum' || (field.values?.length ?? 0) > 0, {
    message: 'an enum state field needs its values',
  })
export type StateField = z.infer<typeof StateFieldSchema>

/** A device an add-on brings (docs/36 §5a) - a lighting desk, an effects unit, anything that offers state; the core knows none of them. */
export const DeviceContributionSchema = z.object({
  kind: z.string().min(1),
  title: z.string().min(1),
  /** How the add-on talks to it, its own word (`network-osc`, ...) - the core routes only, it does not interpret it. */
  transport: z.string().min(1),
  state: z.record(z.string(), StateFieldSchema).default({}),
  /** The device's commands are a method like any other: declared input schema, sent as a `request`, so the add-on decides the bytes. */
  commands: z.record(z.string(), z.object({ in: JsonSchema })).default({}),
})
export type DeviceContribution = z.infer<typeof DeviceContributionSchema>

/**
 * Everything an add-on contributes, as docs/36 §3 lists it: its methods and jobs with their schemas, the devices it brings, the slots it fills, its own
 * settings schema. Additive across protocol versions - `parseContributes` keeps kinds this StageBoard does not know in `unknown` instead of failing.
 */
export const ContributesSchema = z.object({
  // `timeoutMs`: how long the method may take (a download takes minutes, a look-up seconds); absent = the boundary's default. `progress: true`: it reports 0-1 as it goes.
  methods: z.record(z.string(), z.object({ in: JsonSchema, out: JsonSchema, timeoutMs: z.number().int().min(1000).max(30 * 60_000).optional(), progress: z.boolean().optional() })).default({}),
  jobs: z
    .record(z.string(), z.object({ input: JsonSchema, needs: z.object({ helper: z.string().min(1).optional() }).optional() }))
    .default({}),
  devices: z.array(DeviceContributionSchema).default([]),
  ui: z.array(UiContributionSchema).default([]),
  settings: JsonSchema.optional(),
})
export type Contributes = z.infer<typeof ContributesSchema>

/** Every top-level kind `ContributesSchema` knows - what `parseContributes` compares a raw manifest against. */
const KNOWN_CONTRIBUTES = Object.keys(ContributesSchema.shape)

/**
 * The boundary for a manifest's `contributes` (docs/36 §3). A contribution kind this StageBoard does not know is **not** an error: it is returned in
 * `unknown` so the app can say "needs a newer StageBoard" and run everything else. A slot the core does not know **is** an error, because slots are API -
 * `ContributesSchema.parse` throws for it (like for any other malformed contribution).
 */
export function parseContributes(raw: unknown): { contributes: Contributes; unknown: string[] } {
  if (raw === undefined || raw === null) return { contributes: ContributesSchema.parse({}), unknown: [] }

  const record = z.record(z.string(), z.unknown()).parse(raw)
  const contributes = ContributesSchema.parse(record)
  const unknown = Object.keys(record).filter((key) => !KNOWN_CONTRIBUTES.includes(key))

  return { contributes, unknown }
}

/** What travels between StageBoard and an add-on - the shape `EnvelopeSchema` validates. */
export type Envelope =
  | { kind: 'request'; id: number; method: string; body: unknown }
  | { kind: 'response'; id: number; ok: true; body: unknown }
  | { kind: 'response'; id: number; ok: false; error: AddonError }
  | { kind: 'notify'; topic: string; body: unknown }
  | { kind: 'subscribe'; id: number; stream: string }
  | { kind: 'update'; id: number; body: unknown }
  | { kind: 'ui-set'; slot: string; tree: unknown }
  | { kind: 'ui-action'; slot: string; action: string; value?: unknown }
