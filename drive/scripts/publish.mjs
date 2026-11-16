// Copy the built site from drive/dist into the repo root, which is what
// GitHub Pages serves (branch: main, folder: /). Run with `npm run publish`.
import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist')
const root = join(here, '..', '..')

if (!existsSync(join(dist, 'index.html'))) throw new Error('Run `vite build` first: drive/dist is empty.')

// Remove the previous build's files (hashed asset names change every build).
for (const name of readdirSync(dist)) rmSync(join(root, name), { recursive: true, force: true })

cpSync(dist, root, { recursive: true })
writeFileSync(join(root, '.nojekyll'), '') // serve files as they are, no Jekyll step
console.log(`Published ${readdirSync(dist).join(', ')} to the repo root.`)
