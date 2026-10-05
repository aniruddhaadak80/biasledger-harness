import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const builderConfig = readFileSync(fileURLToPath(new URL('../electron-builder.yml', import.meta.url)), 'utf8')
const main = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8')

describe('electron-builder configuration', () => {
  it('declares an appId and a product name', () => {
    expect(builderConfig).toMatch(/^appId:\s*\S+/m)
    expect(builderConfig).toMatch(/^productName:\s*\S+/m)
  })

  it('targets all three desktop platforms', () => {
    expect(builderConfig).toMatch(/^mac:/m)
    expect(builderConfig).toMatch(/^win:/m)
    expect(builderConfig).toMatch(/^linux:/m)
  })

  it('does not run npm rebuild, which breaks native modules', () => {
    expect(builderConfig).toMatch(/^npmRebuild:\s*false/m)
  })
})

/**
 * The shell is asserted by reading its source rather than by launching Electron.
 *
 * Booting Electron in a unit test needs a display server and a ~1s startup per run, and on CI
 * there is no display at all. What is worth asserting here is the *contract*: the shell loads
 * the web app rather than reimplementing it, it locks to one instance, it keeps the renderer
 * isolated, and it has a doctor window. Those are all decidable from the source.
 */
describe('the shell contract', () => {
  it('loads the web app instead of reimplementing the UI', () => {
    expect(main).toMatch(/window\.loadURL\(WEB_ORIGIN\)/)
    expect(main).not.toMatch(/new BrowserWindow\(\{[\s\S]*?html:/)
  })

  it('keeps the renderer isolated and sandboxed', () => {
    expect(main).toMatch(/contextIsolation:\s*true/)
    expect(main).toMatch(/nodeIntegration:\s*false/)
    expect(main).toMatch(/sandbox:\s*true/)
  })

  it('takes a single-instance lock', () => {
    expect(main).toMatch(/requestSingleInstanceLock\(\)/)
    expect(main).toMatch(/'second-instance'/)
  })

  it('opens external links in the real browser rather than in the shell', () => {
    expect(main).toMatch(/setWindowOpenHandler/)
    expect(main).toMatch(/shell\.openExternal\(url\)/)
  })

  it('has a doctor window bound to a real menu item', () => {
    expect(main).toMatch(/label:\s*'Doctor'/)
    expect(main).toMatch(/openDoctorWindow/)
    // The doctor window delegates to the web app's own health route instead of probing again.
    expect(main).toMatch(/WEB_ORIGIN\}\/health/)
  })

  it('does not recompute the evidence root in the shell', () => {
    // The shell must not be able to disagree with the CLI and the web app about the root.
    expect(main).not.toMatch(/createHash|sha256|readFileSync/)
  })
})
