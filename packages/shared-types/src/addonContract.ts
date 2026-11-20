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
