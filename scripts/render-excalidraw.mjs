#!/usr/bin/env node
// Render the tracked `.excalidraw` sources under docs/ to the `.png` files the
// docs embed. The diagrams are the source of truth; the PNGs are build output that
// happens to be committed (GitHub cannot render `.excalidraw` inline).
//
//   node scripts/render-excalidraw.mjs
//
// Requires network on first run (npm install into a temp dir) and a Chrome or
// Chromium binary. Set CHROME_CHANNEL=chromium to use Chromium instead, or
// CHROME_PATH=/path/to/binary to point at one explicitly.
//
// PNGs are downscaled and quantized to stay under the 750 KB `check-added-large-files`
// prek limit. If a redrawn diagram pushes a PNG over the limit, lower its `maxWidth`.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// maxWidth caps the committed PNG's pixel width; it is the only knob that
// meaningfully moves file size once the diagram is fixed.
const DIAGRAMS = [
  { src: 'docs/pipelines/anonymizer/pipeline.excalidraw', out: 'docs/pipelines/anonymizer/pipeline.png', maxWidth: 5200 },
  { src: 'docs/anonymization/pipeline.excalidraw', out: 'docs/anonymization/pipeline.png', maxWidth: 4300 },
]

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'aymurai-excalidraw-'))
const run = (cmd, args) => execFileSync(cmd, args, { cwd: work, stdio: 'inherit' })

console.log('> installing render toolchain')
fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ type: 'module', private: true }))
run('npm', ['install', '--no-audit', '--no-fund', '--silent',
  'playwright', '@excalidraw/excalidraw', 'react', 'react-dom', 'esbuild', 'sharp'])

console.log('> bundling excalidraw')
fs.writeFileSync(path.join(work, 'entry.js'), 'import * as L from "@excalidraw/excalidraw"; window.ExcalidrawLib = L;')
run('npx', ['esbuild', 'entry.js', '--bundle', '--outfile=bundle.js', '--format=iife', '--minify',
  '--define:process.env.NODE_ENV="production"', '--loader:.woff2=dataurl', '--loader:.ttf=dataurl', '--log-level=warning'])

fs.copyFileSync(
  path.join(work, 'node_modules/@excalidraw/excalidraw/dist/prod/index.css'),
  path.join(work, 'index.css'),
)
fs.writeFileSync(path.join(work, 'page.html'),
  '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./index.css"><script src="./bundle.js"></script>')

// Resolve from the temp install rather than from this script's own location,
// which has no node_modules of its own.
const require = createRequire(path.join(work, 'noop.cjs'))
const { chromium } = require('playwright')
const sharp = require('sharp')

const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: process.env.CHROME_CHANNEL || 'chrome' },
)
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 })
await page.goto('file://' + path.join(work, 'page.html'))
await page.waitForFunction(() => !!window.ExcalidrawLib, null, { timeout: 60_000 })

for (const { src, out, maxWidth } of DIAGRAMS) {
  const diagram = JSON.parse(fs.readFileSync(path.join(REPO, src), 'utf8'))
  const dataUrl = await page.evaluate(async (diagram) => {
    const blob = await window.ExcalidrawLib.exportToBlob({
      elements: diagram.elements,
      files: diagram.files || {},
      appState: {
        ...(diagram.appState || {}),
        exportBackground: true,
        viewBackgroundColor: '#ffffff',
        exportWithDarkMode: false,
      },
      mimeType: 'image/png',
      exportPadding: 24,
      getDimensions: (w, h) => ({ width: w * 2, height: h * 2, scale: 2 }),
    })
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
  }, diagram)

  // Quantizing to a 128-colour palette is what actually keeps these under the
  // size limit — these are line drawings, so the loss is invisible. dither: 0
  // is not cosmetic: sharp's default dithering is non-deterministic, so without
  // it an unchanged diagram re-renders to different bytes and shows up as a
  // spurious diff on every run.
  const png = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64'))
    .flatten({ background: '#ffffff' })
    .resize({ width: maxWidth, withoutEnlargement: true })
    .png({ palette: true, colours: 128, dither: 0, compressionLevel: 9 })
    .toBuffer()

  fs.writeFileSync(path.join(REPO, out), png)
  const kb = Math.round(png.length / 1024)
  console.log(`  ${out}  ${kb} KB${kb > 750 ? '  !! over the 750 KB prek limit — lower maxWidth' : ''}`)
}

await browser.close()
fs.rmSync(work, { recursive: true, force: true })
