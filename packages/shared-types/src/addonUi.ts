import { z } from 'zod'

/**
 * UI from an add-on is a **description** (docs/36 §6, #964): a tree of StageBoard's own building blocks that the app renders with `components/ui`.
 * The add-on has no DOM, no markup, no styles and no access to the page; whatever is outside this vocabulary is refused. This file is the one
 * place that says what the vocabulary is and what a tree may cost (`UI_LIMITS`); the renderer (stage-pwa) only draws what passed `validateUiTree`.
 */
export const UI_LIMITS = { maxDepth: 8, maxNodes: 500, maxBytes: 64 * 1024, maxSetsPerSecond: 10 } as const

/** A value that stays live without asking the add-on again: `job:<id>.progress`, `state:<device>.<key>` (resolved by the app). */
const BindSchema = z.strictObject({ bind: z.string().regex(/^(job|state):[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/) })
const bindable = <T extends z.ZodType>(schema: T) => z.union([schema, BindSchema])

const OptionSchema = z.strictObject({ value: z.string(), label: z.string() })
const Id = z.string().min(1).max(64)
const Label = z.string().max(200)
const Action = z.string().min(1).max(100)
const children = z.array(z.unknown()).max(UI_LIMITS.maxNodes)

/** Every node of v1, without its children: containers carry `children` (validated one by one by `validateUiTree`, so an error has a path). */
const LEAF = {
  section: z.strictObject({ type: z.literal('section'), title: Label.optional(), children }),
  card: z.strictObject({ type: z.literal('card'), children }),
  stack: z.strictObject({ type: z.literal('stack'), children }),
  row: z.strictObject({ type: z.literal('row'), children }),
  dialog: z.strictObject({ type: z.literal('dialog'), size: z.enum(['S', 'M', 'L']), title: Label, children }),
  list: z.strictObject({ type: z.literal('list'), children }),
  // Plain text only - there is no field that carries HTML or Markdown.
  text: z.strictObject({ type: z.literal('text'), role: z.enum(['body', 'hint', 'title', 'error']), text: bindable(z.string().max(2000)) }),
  field: z.strictObject({ type: z.literal('field'), id: Id, label: Label, value: bindable(z.string()).optional(), placeholder: Label.optional(), action: Action.optional() }),
  textarea: z.strictObject({ type: z.literal('textarea'), id: Id, label: Label, value: bindable(z.string()).optional(), action: Action.optional() }),
  select: z.strictObject({ type: z.literal('select'), id: Id, label: Label, options: z.array(OptionSchema).max(200), value: bindable(z.string()).optional() }),
  slider: z.strictObject({ type: z.literal('slider'), id: Id, label: Label, min: z.number(), max: z.number(), step: z.number().positive().optional(), value: bindable(z.number()).optional() }),
  switch: z.strictObject({ type: z.literal('switch'), id: Id, label: Label, value: bindable(z.boolean()).optional() }),
  segmented: z.strictObject({ type: z.literal('segmented'), id: Id, options: z.array(OptionSchema).max(12), value: bindable(z.string()).optional() }),
  chips: z.strictObject({ type: z.literal('chips'), id: Id, options: z.array(OptionSchema).max(50), value: z.array(z.string()).optional() }),
  checkRow: z.strictObject({ type: z.literal('checkRow'), id: Id, label: Label, value: bindable(z.boolean()).optional() }),
  button: z.strictObject({ type: z.literal('button'), variant: z.enum(['primary', 'secondary', 'danger', 'quiet']), label: Label, action: Action, disabled: z.boolean().optional() }),
  iconButton: z.strictObject({ type: z.literal('iconButton'), icon: z.string().min(1).max(40), label: Label, action: Action }),
  listRow: z.strictObject({ type: z.literal('listRow'), title: Label, subtitle: Label.optional(), image: z.strictObject({ src: z.string(), role: z.enum(['thumb', 'cover']) }).optional(), trailing: z.unknown().optional(), action: Action.optional() }),
  image: z.strictObject({ type: z.literal('image'), src: z.string(), role: z.enum(['thumb', 'cover']) }),
  progress: z.strictObject({ type: z.literal('progress'), value: bindable(z.number().min(0).max(1)) }),
  badge: z.strictObject({ type: z.literal('badge'), text: Label }),
  statusDot: z.strictObject({ type: z.literal('statusDot'), status: z.enum(['online', 'offline', 'error']) }),
} as const

export type UiNodeType = keyof typeof LEAF
export type UiNode = { type: UiNodeType; children?: UiNode[]; trailing?: UiNode } & Record<string, unknown>

export type UiError = 'ui.unknown-node' | 'ui.too-deep' | 'ui.too-many-nodes' | 'ui.too-large' | 'ui.image-origin' | 'ui.invalid'
export type UiValidation = { ok: true; tree: UiNode } | { ok: false; code: UiError; path: string }

const isNodeType = (type: unknown): type is UiNodeType => typeof type === 'string' && Object.prototype.hasOwnProperty.call(LEAF, type)

/** The origin of an image URL that is a plain https URL without credentials (`https://i.ytimg.com@evil.example` is not an `i.ytimg.com` URL). */
function imageOrigin(src: string): string | null {
  try {
    const url = new URL(src)
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null
  } catch {
    return null
  }
}

/**
 * Checks a tree an add-on sent: size first, then node by node (vocabulary, props, images only from `imageOrigins`, depth, count). The first problem
 * wins and comes with its path (`children[0].children[2]`); a tree that fails never reaches the renderer, and the previous one stays on screen.
 */
export function validateUiTree(tree: unknown, ctx: { imageOrigins: readonly string[] }): UiValidation {
  try {
    if (JSON.stringify(tree)?.length > UI_LIMITS.maxBytes) return { ok: false, code: 'ui.too-large', path: '' }
  } catch {
    return { ok: false, code: 'ui.invalid', path: '' } // not serializable: a cycle, a BigInt
  }
  const allowed = new Set(ctx.imageOrigins)
  let count = 0

  const walk = (node: unknown, depth: number, path: string): UiValidation | null => {
    if (depth > UI_LIMITS.maxDepth) return { ok: false, code: 'ui.too-deep', path }
    if (++count > UI_LIMITS.maxNodes) return { ok: false, code: 'ui.too-many-nodes', path }
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return { ok: false, code: 'ui.invalid', path }
    const type = (node as { type?: unknown }).type
    if (!isNodeType(type)) return { ok: false, code: 'ui.unknown-node', path }
    const parsed = LEAF[type].safeParse(node)
    if (!parsed.success) return { ok: false, code: 'ui.invalid', path }
    const data = parsed.data as Record<string, unknown>
    const prefix = path === '' ? '' : `${path}.`

    const image = type === 'image' ? (data as { src: string }) : type === 'listRow' ? (data.image as { src: string } | undefined) : undefined
    if (image) {
      const origin = imageOrigin(image.src)
      if (!origin || !allowed.has(origin)) return { ok: false, code: 'ui.image-origin', path: type === 'listRow' ? `${prefix}image` : path }
    }
    if (Array.isArray(data.children)) {
      for (let i = 0; i < data.children.length; i++) {
        const problem = walk(data.children[i], depth + 1, `${prefix}children[${i}]`)
        if (problem) return problem
      }
    }
    if (data.trailing !== undefined) {
      const problem = walk(data.trailing, depth + 1, `${prefix}trailing`)
      if (problem) return problem
    }
    return null
  }

  const problem = walk(tree, 1, '')
  return problem ?? { ok: true, tree: tree as UiNode }
}
