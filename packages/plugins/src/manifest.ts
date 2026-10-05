import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const PluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(10),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(50),
  capabilities: z.array(z.string().min(1)).default([]),
  /**
   * The fairness-dimension taxonomy this plugin defines.
   *
   * A claim of this kind is only attestable if every `required` dimension here is backed by a
   * citation, so a taxonomy is a policy statement rather than a label. Shipping the taxonomy
   * as a plugin is what lets a new regulated domain be onboarded without touching core.
   */
  dimensions: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
        required: z.boolean().default(true),
        rationale: z.string().min(10),
      }),
    )
    .default([]),
  engines: z.record(z.string(), z.string()).default({}),
})

export type PluginManifest = z.infer<typeof PluginManifestSchema>

export interface LoadedPlugin {
  readonly manifest: PluginManifest
  readonly path: string
  readonly issues: readonly string[]
}

export function loadPlugin(file: string): LoadedPlugin {
  if (!existsSync(file)) {
    return { manifest: null as never, path: file, issues: [`${file}: not found`] }
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (cause) {
    return { manifest: null as never, path: file, issues: [`${file}: invalid JSON — ${String(cause)}`] }
  }
  const parsed = PluginManifestSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${file}: ${i.path.join('.') || '(root)'} — ${i.message}`)
    return { manifest: null as never, path: file, issues }
  }
  return { manifest: parsed.data, path: file, issues: [] }
}

export function loadPlugins(root = 'plugins'): LoadedPlugin[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      const manifestPath = join(root, d.name, 'plugin.json')
      if (!existsSync(manifestPath)) return []
      return [loadPlugin(manifestPath)]
    })
}
