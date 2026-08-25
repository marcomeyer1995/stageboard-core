export type Mode = 'live' | 'edit' | 'setlists' | 'plugins'

export const MODES: Mode[] = ['live', 'edit', 'setlists', 'plugins']

export const MODE_LABEL: Record<Mode, string> = {
  live: 'Live',
  edit: 'Songs',
  setlists: 'Setlists',
  plugins: 'Plugins',
}
