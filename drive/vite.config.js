import { defineConfig } from 'vite'
import { person, projects } from './src/data/projects.js'
import { listHtml } from './src/ui/html.js'

// The plain list view is written into index.html at build time, so it is
// there before any script runs (and for visitors with no JavaScript at all).
export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'inject-list',
      transformIndexHtml: (html) => html.replace('<!--list-->', listHtml(person, projects)),
    },
  ],
})
