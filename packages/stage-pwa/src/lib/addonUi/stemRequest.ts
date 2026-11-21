import { StemModelSchema, type StemModel } from 'shared-types'

/** What a view script may ask for with `core.queueStemSeparation`, or why it is refused. The job becomes a band document: bounded and shaped here. */
export function stemRequestOf(body: unknown): { ok: true; model: StemModel; splitGuitar: boolean } | { ok: false; problem: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, problem: 'core.queueStemSeparation needs {model, splitGuitar}' }
  const { model, splitGuitar } = body as { model?: unknown; splitGuitar?: unknown }
  const parsed = StemModelSchema.safeParse(model)
  if (!parsed.success) return { ok: false, problem: 'core.queueStemSeparation: unknown model' }
  if (typeof splitGuitar !== 'boolean') return { ok: false, problem: 'core.queueStemSeparation: splitGuitar must be true or false' }
  return { ok: true, model: parsed.data, splitGuitar: parsed.data === 'extended' && splitGuitar }
}
