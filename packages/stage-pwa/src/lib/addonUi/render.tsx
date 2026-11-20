import { useEffect, useState, type ReactNode } from 'react'
import type { UiNode } from 'shared-types'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { CheckRow } from '../../components/ui/CheckRow'
import { Dialog } from '../../components/ui/Dialog'
import { Field, Select, Slider, TextArea } from '../../components/ui/Field'
import { IconButton } from '../../components/ui/IconButton'
import { Card, ListRow, Section } from '../../components/ui/Layout'
import { Segmented } from '../../components/ui/Segmented'
import { StatusDot } from '../../components/ui/StatusDot'
import { Switch } from '../../components/ui/Switch'
import { ToggleChip } from '../../components/ui/ToggleChip'
import { ICONS, type IconName } from '../../components/Icon'
import { resolveBind, type BindSources } from './bind'

/**
 * Draws a validated UI description (docs/36 §6, #964) with the components of the UI system. The tree has passed `validateUiTree`; this still draws
 * only what it knows, as text and never as markup, and never gives the add-on a handle on the page. A value that is `{bind}` follows the job or
 * device state in `sources` without asking the add-on again; everything the person does leaves as one `onAction(action, value)`.
 */
export interface UiTreeProps {
  tree: UiNode
  sources: BindSources
  onAction: (action: string, value?: unknown) => void
}

type Props = Omit<UiTreeProps, 'tree'>
type Bound<T> = T | { bind: string }

const isBind = (value: unknown): value is { bind: string } => typeof value === 'object' && value !== null && 'bind' in value
const val = <T,>(value: Bound<T> | undefined, sources: BindSources): T | undefined => (isBind(value) ? (resolveBind(value.bind, sources) as T | undefined) : value)
const isIcon = (name: string): name is IconName => Object.prototype.hasOwnProperty.call(ICONS, name)

/** What the person typed or picked, kept until the add-on's own value for that input changes (a new tree can reset it). */
function useLocal<T>(upstream: T): [T, (next: T) => void] {
  const [local, setLocal] = useState<{ value: T; from: T }>({ value: upstream, from: upstream })
  useEffect(() => setLocal({ value: upstream, from: upstream }), [JSON.stringify(upstream)]) // eslint-disable-line react-hooks/exhaustive-deps
  return [local.value, (next) => setLocal({ value: next, from: local.from })]
}

function Children({ nodes, ...props }: Props & { nodes: UiNode[] | undefined }) {
  return <>{(nodes ?? []).map((child, i) => <Node key={i} node={child} {...props} />)}</>
}

function FieldNode({ node, sources, onAction }: Props & { node: UiNode }) {
  const [value, setValue] = useLocal(val<string>(node.value as Bound<string>, sources) ?? '')
  const change = (next: string) => (setValue(next), onAction(`change:${node.id as string}`, next))
  return node.type === 'textarea' ? (
    <TextArea label={node.label as string} value={value} onChange={(e) => change(e.target.value)} />
  ) : (
    <Field label={node.label as string} placeholder={node.placeholder as string | undefined} value={value} onChange={(e) => change(e.target.value)} />
  )
}

function SelectNode({ node, sources, onAction }: Props & { node: UiNode }) {
  const [value, setValue] = useLocal(val<string>(node.value as Bound<string>, sources) ?? '')
  return <Select label={node.label as string} options={node.options as { value: string; label: string }[]} value={value} onChange={(e) => (setValue(e.target.value), onAction(`change:${node.id as string}`, e.target.value))} />
}

function SliderNode({ node, sources, onAction }: Props & { node: UiNode }) {
  const upstream = val<number>(node.value as Bound<number>, sources) ?? (node.min as number)
  const [value, setValue] = useLocal(upstream)
  return <Slider label={node.label as string} min={node.min as number} max={node.max as number} step={node.step as number | undefined} value={value} onChange={(next) => (setValue(next), onAction(`change:${node.id as string}`, next))} />
}

function SwitchNode({ node, sources, onAction }: Props & { node: UiNode }) {
  const [value, setValue] = useLocal(val<boolean>(node.value as Bound<boolean>, sources) ?? false)
  const toggle = (next: boolean) => (setValue(next), onAction(`change:${node.id as string}`, next))
  return node.type === 'checkRow' ? (
    <CheckRow checked={value} onToggle={() => toggle(!value)}>
      {node.label as string}
    </CheckRow>
  ) : (
    <Switch label={node.label as string} checked={value} onChange={toggle} />
  )
}

function SegmentedNode({ node, sources, onAction }: Props & { node: UiNode }) {
  const [value, setValue] = useLocal(val<string>(node.value as Bound<string>, sources) ?? '')
  return <Segmented label={(node.id as string) ?? ''} options={node.options as { value: string; label: string }[]} value={value} onChange={(next) => (setValue(next), onAction(`change:${node.id as string}`, next))} />
}

function ChipsNode({ node, onAction }: Props & { node: UiNode }) {
  const [value, setValue] = useLocal((node.value as string[] | undefined) ?? [])
  return (
    <div className="flex flex-wrap gap-2">
      {(node.options as { value: string; label: string }[]).map((option) => (
        <ToggleChip
          key={option.value}
          label={option.label}
          selected={value.includes(option.value)}
          onToggle={(on) => {
            const next = on ? [...value, option.value] : value.filter((v) => v !== option.value)
            setValue(next)
            onAction(`change:${node.id as string}`, next)
          }}
        />
      ))}
    </div>
  )
}

const TEXT_CLASS = { body: 'text-sm text-ink', hint: 'text-xs text-ink-faint', title: 'text-base font-semibold text-ink', error: 'text-sm text-danger' } as const

function Thumb({ src, role }: { src: string; role: 'thumb' | 'cover' }) {
  // Loaded by the app, from an origin the add-on declared (validateUiTree); decorative - the row's title says what it is. No referrer, no cookies.
  return <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className={role === 'thumb' ? 'h-form w-16 flex-shrink-0 rounded-control object-cover' : 'h-40 w-40 rounded-control object-cover'} />
}

function Node({ node, sources, onAction }: Props & { node: UiNode }): ReactNode {
  const props = { sources, onAction }
  switch (node.type) {
    case 'section':
      return (
        <Section title={(node.title as string | undefined) ?? ''}>
          <Children nodes={node.children} {...props} />
        </Section>
      )
    case 'card':
      return (
        <Card>
          <Children nodes={node.children} {...props} />
        </Card>
      )
    case 'stack':
      return (
        <div className="flex flex-col gap-2">
          <Children nodes={node.children} {...props} />
        </div>
      )
    case 'row':
      return (
        <div className="flex items-end gap-2">
          <Children nodes={node.children} {...props} />
        </div>
      )
    case 'dialog':
      return (
        <Dialog title={node.title as string} size={(node.size as string).toLowerCase() as 's' | 'm' | 'l'} onClose={() => onAction('close')}>
          <div className="flex flex-col gap-3">
            <Children nodes={node.children} {...props} />
          </div>
        </Dialog>
      )
    case 'list':
      return (
        <div className="flex flex-col gap-1">
          <Children nodes={node.children} {...props} />
        </div>
      )
    case 'listRow': {
      const image = node.image as { src: string; role: 'thumb' | 'cover' } | undefined
      const action = node.action as string | undefined
      return (
        <ListRow
          title={node.title as string}
          subtitle={node.subtitle as string | undefined}
          leading={image ? <Thumb src={image.src} role={image.role} /> : undefined}
          trailing={node.trailing ? <Node node={node.trailing as UiNode} {...props} /> : undefined}
          onClick={action ? () => onAction(action) : undefined}
        />
      )
    }
    case 'text': {
      const text = val<string>(node.text as Bound<string>, sources)
      return <p className={TEXT_CLASS[node.role as keyof typeof TEXT_CLASS]}>{text === undefined ? '' : String(text)}</p>
    }
    case 'field':
    case 'textarea':
      return <FieldNode node={node} {...props} />
    case 'select':
      return <SelectNode node={node} {...props} />
    case 'slider':
      return <SliderNode node={node} {...props} />
    case 'switch':
    case 'checkRow':
      return <SwitchNode node={node} {...props} />
    case 'segmented':
      return <SegmentedNode node={node} {...props} />
    case 'chips':
      return <ChipsNode node={node} {...props} />
    case 'button':
      return (
        <Button variant={node.variant as 'primary' | 'secondary' | 'danger' | 'quiet'} disabled={node.disabled === true} onClick={() => onAction(node.action as string)}>
          {node.label as string}
        </Button>
      )
    case 'iconButton':
      return <IconButton icon={(isIcon(node.icon as string) ? node.icon : 'more') as IconName} label={node.label as string} onClick={() => onAction(node.action as string)} />
    case 'image':
      return <Thumb src={node.src as string} role={node.role as 'thumb' | 'cover'} />
    case 'progress': {
      const fraction = Math.min(1, Math.max(0, Number(val<number>(node.value as Bound<number>, sources) ?? 0)))
      return (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} className="h-2 w-full overflow-hidden rounded-full bg-control-strong">
          <div className="h-full bg-accent" style={{ width: `${fraction * 100}%` }} />
        </div>
      )
    }
    case 'link':
      // Out of the app, to an origin the add-on declared (validated before this is drawn). No opener, no referrer: the page learns nothing of the band.
      return (
        <Button variant="quiet" icon="external" onClick={() => void window.open(node.href as string, '_blank', 'noopener,noreferrer')}>
          {node.label as string}
        </Button>
      )
    case 'badge':
      return <Badge>{node.text as string}</Badge>
    case 'statusDot':
      return <StatusDot status={{ online: 'ok', offline: 'off', error: 'error' }[node.status as 'online' | 'offline' | 'error'] as 'ok' | 'off' | 'error'} />
    default:
      return null
  }
}

export function UiTree({ tree, sources, onAction }: UiTreeProps) {
  return <Node node={tree} sources={sources} onAction={(action, value) => onAction(action, value)} />
}
