import { z } from 'zod'

/** Screen classes from docs/07 section 3: phone, tablet portrait, tablet landscape, stage monitor. */
export const BreakpointSchema = z.enum(['sm', 'md', 'lg', 'xl'])
export type Breakpoint = z.infer<typeof BreakpointSchema>

export const BREAKPOINTS = ['sm', 'md', 'lg', 'xl'] as const

export const LayoutItemSchema = z.object({
  /** Matches WidgetInstance.i. */
  i: z.string().min(1),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  minW: z.number().int().positive().optional(),
  minH: z.number().int().positive().optional(),
})
export type LayoutItem = z.infer<typeof LayoutItemSchema>

/**
 * One placed widget. `config` is per instance, not per type, so the same widget can
 * appear twice with different settings (a horizontal dashboard switcher in a top bar,
 * a vertical one in a side column).
 */
export const WidgetInstanceSchema = z.object({
  i: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
})
export type WidgetInstance = z.infer<typeof WidgetInstanceSchema>

/**
 * A named, freely configurable screen ("Prompter", "Monitoring", "Light"). Dashboards
 * replicate band-wide like setlists; which one a given tablet currently shows is a
 * local, per-device choice (see useActiveDashboardStore).
 */
export const DashboardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().nonnegative(),
  widgets: z.array(WidgetInstanceSchema).default([]),
  /** Partial: a breakpoint with no entry inherits react-grid-layout's fallback. */
  layouts: z.partialRecord(BreakpointSchema, z.array(LayoutItemSchema)).default({}),
})
export type Dashboard = z.infer<typeof DashboardSchema>
