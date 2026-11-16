// Entry. The list view is already in the HTML; this only decides whether to
// load the 3D drive on top of it. Three.js is not fetched in list mode.

const root = document.documentElement
const toggle = document.getElementById('mode')
// `?motion=reduce` forces the reduced-motion version, for testing without changing system settings.
const reduced =
  matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.search).get('motion') === 'reduce'

function hasWebGL() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}
const canDrive = hasWebGL()

let drive = null
let loading = null

function wanted() {
  if (!canDrive) return 'list'
  if (location.hash === '#list') return 'list'
  if (location.hash === '#drive') return 'drive'
  return reduced ? 'list' : 'drive'
}

async function apply() {
  const mode = wanted()
  root.classList.toggle('drive', mode === 'drive')
  toggle.hidden = !canDrive
  toggle.textContent = mode === 'drive' ? 'Skip the drive' : 'Drive the map'
  toggle.href = mode === 'drive' ? '#list' : '#drive'

  if (mode === 'list') {
    drive?.stop()
    root.classList.remove('ready', 'panel-open')
    return
  }
  try {
    loading ??= import('./drive.js').then((m) => m.createDrive({ reduced }))
    drive = await loading
  } catch (err) {
    console.error(err)
    location.hash = '#list'
    return
  }
  if (wanted() !== 'drive') return
  drive.start()
  root.classList.add('ready')
  scrollTo(0, 0)
}

addEventListener('hashchange', apply)
apply()
