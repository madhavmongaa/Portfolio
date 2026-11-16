# Madhav Monga: portfolio

Live at https://madhavmongaa.github.io/Portfolio/

A night-time map you drive around in a Porsche 911; each project is a stop. A plain list view
("Skip the drive") is built into the page for recruiters, slow devices and reduced motion.

- `drive/`: the source (Three.js + Vite). Project copy lives in `drive/src/data/projects.js`.
- Repo root (`index.html`, `assets/`, `911.glb`): the built site that GitHub Pages serves. Don't edit by hand.
- `original/`: the previous portfolio page.

## Updating the site

```bash
cd drive
npm install
npm run dev       # local preview
npm run publish   # build and copy into the repo root, then commit and push to main
```

Car model: "Porsche 911 Carrera S (991.2)" by Mona x Supercars, CC BY 4.0, repainted black.
