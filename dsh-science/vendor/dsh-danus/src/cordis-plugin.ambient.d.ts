/**
 * Minimal ambient typing for `cordis` so this package type-checks standalone.
 *
 * The DSH host mounts this plugin against its OWN vendored cordis (which exports
 * a real `Context`); this ambient module only exists so `tsc` passes without a
 * linked cordis checkout. Structurally compatible with the runtime type.
 */
declare module 'cordis' {
  /** Structural subset of the real Cordis Context used by this plugin. */
  export interface Context {
    get<T = unknown>(name: string, strict?: boolean): T
    provide(name: string, value?: unknown): () => void
    plugin(plugin: unknown, config?: unknown): unknown
    inject(deps: readonly string[] | Record<string, unknown>, callback: (ctx: Context) => void): unknown
    effect(execute: () => unknown, label?: string): () => void
    on(name: string, listener: (...args: never[]) => unknown, options?: boolean | { prepend?: boolean; global?: boolean }): () => void
    emit(name: string, ...args: unknown[]): void
    setInterval?(fn: () => void, ms: number): () => void
    // allow arbitrary service access
    [key: string]: unknown
  }
}
