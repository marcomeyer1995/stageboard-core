export interface PluginContext {
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void
    error: (msg: string, meta?: Record<string, unknown>) => void
  }
}

export interface IPlugin {
  name: string
  version: string
  init(context: PluginContext): Promise<void> | void
  shutdown?(): Promise<void> | void
}
