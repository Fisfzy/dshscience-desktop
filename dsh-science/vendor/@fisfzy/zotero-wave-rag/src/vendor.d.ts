/**
 * Ambient (type-only) declaration for `@deepseek-ai/dsh-tools`.
 *
 * The real module is provided by the DSH harness at runtime (the host boots
 * plugins under the tsx loader, which resolves workspace imports through the
 * checkout tsconfig). Declaring it here keeps this repo self-contained and
 * buildable without depending on a DSH checkout, and makes the plugin a
 * clean stand-alone resume project. Only the surface this plugin uses is
 * declared; it mirrors `packages/core/tools` `DefineToolOptions`.
 */

declare module '@deepseek-ai/dsh-tools' {
  export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue }

  /** Minimal content-block union covering the `render` projections we emit. */
  export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'json'; value: JsonValue }

  /** One implicit parameter-root property; requiredness is per-property. */
  export type ParameterPropertySpec = {
    type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
    required?: true
    description?: string
    enum?: readonly (string | number)[]
    items?: ParameterPropertySpec
    properties?: Record<string, ParameterPropertySpec>
    additionalProperties?: boolean
  }

  export type ParameterSchemaSpec = {
    [key: string]: ParameterPropertySpec
  }

  export interface ToolCallView {
    card?: string
    title?: string
    kind?: string
    rawInput?: unknown
  }

  export interface DefineToolOptions {
    /** Tool name (must be unique). */
    readonly name: string
    /** Human-readable description sent to the model. */
    readonly description: string
    /** Per-property parameter schema compiled to an implicit open object root. */
    readonly parameters: ParameterSchemaSpec
    /** Canonical output schema plus render projection. */
    readonly output: {
      /** Schema enforced against every successful body value. */
      readonly schema: {
        type: 'object'
        additionalProperties: boolean
        properties: Record<string, unknown>
      }
      /** Pure Native/model rendering of one validated canonical value. */
      render(args: unknown, value: unknown): ContentBlock[]
    }
    /** Optional positive cooperative timeout budget in milliseconds. */
    readonly timeoutMs?: number
    /** Execute the tool after argument validation. */
    execute(
      args: Record<string, unknown>,
      exec: { signal?: AbortSignal; caller?: unknown },
    ): Promise<unknown>
    /** Pure pending-state presenter. */
    presentCall?(args: unknown): ToolCallView | undefined
  }

  /** Define a tool with inferred arguments and strict execution validation. */
  export function defineTool(options: DefineToolOptions): {
    name: string
  }
}
