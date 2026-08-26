/**
 * dsh-science Host entry.
 *
 * One job: provision the curated research skills shipped inside this package
 * into `$DSH_HOME/skills` so the ordinary `dsh-skill` plugin picks them up.
 *
 * Semantics:
 *   - copy-if-missing per skill directory; user edits and user-installed
 *     skills with the same name are never touched;
 *   - a stamp file records what was provisioned by which package version, so
 *     later versions can add NEW skills without clobbering anything;
 *   - provisioning is idempotent and runs inside a Cordis effect, so an
 *     unload leaves the copied files in place (skills are user data).
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const PACKAGE_DIR = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const SKILLS_SOURCE = join(PACKAGE_DIR, 'skills')
const STAMP_FILENAME = '.dsh-science.json'
const MAX_SKILL_DIRS = 100

function provisionSkills() {
  if (!existsSync(SKILLS_SOURCE)) return { copied: [], skipped: [] }
  const home = resolveDshHome()
  const targetRoot = join(home, 'skills')
  mkdirSync(targetRoot, { recursive: true })

  const entries = readdirSync(SKILLS_SOURCE, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .slice(0, MAX_SKILL_DIRS)
  const copied = []
  const skipped = []
  for (const entry of entries) {
    if (!existsSync(join(SKILLS_SOURCE, entry.name, 'SKILL.md'))) continue
    const target = join(targetRoot, entry.name)
    if (existsSync(target)) {
      skipped.push(entry.name)
      continue
    }
    cpSync(join(SKILLS_SOURCE, entry.name), target, { recursive: true })
    copied.push(entry.name)
  }

  let stamp = {}
  const stampPath = join(targetRoot, STAMP_FILENAME)
  try {
    stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
  } catch { /* first run or user removed the stamp */ }
  const version = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')).version
  writeFileSync(stampPath, JSON.stringify({
    version,
    provisionedAt: new Date().toISOString(),
    copied: [...new Set([...(stamp.copied ?? []), ...copied])],
  }, undefined, 2) + '\n')
  return { copied, skipped }
}

export default function apply(ctx) {
  ctx.effect(() => {
    try {
      const { copied, skipped } = provisionSkills()
      if (copied.length > 0) {
        console.log(`[dsh-science] provisioned ${copied.length} skills into $DSH_HOME/skills (${skipped.length} already present)`)
      }
    } catch (cause) {
      // Skill provisioning must never block the profile boot.
      console.error(`[dsh-science] skill provisioning failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  })
}
