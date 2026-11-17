// Pure string templates, shared by the build-time list view and the in-drive panel.

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export const num = (i) => String(i + 1).padStart(2, '0')

export function bodyHtml(p) {
  const links = p.links.length
    ? `<ul class="links">${p.links
        .map((l) => {
          const ext = l.href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''
          return `<li><a href="${esc(l.href)}"${ext}>${esc(l.label)}</a></li>`
        })
        .join('')}</ul>`
    : ''
  const credit = p.credit
    ? `<p class="credit"><a href="${esc(p.credit.href)}" target="_blank" rel="noopener">${esc(p.credit.text)}</a></p>`
    : ''
  const facts = p.facts?.length
    ? `<dl class="meta">${p.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v.map(esc).join(' · ')}</dd>`).join('')}</dl>`
    : ''
  // Loaded and played only when on screen (see main.js); the poster shows until then.
  const preview = p.preview
    ? `<figure class="preview"><video class="reel" src="${esc(p.preview.src)}" poster="${esc(p.preview.poster)}" muted loop playsinline preload="none" width="270" height="480"></video><figcaption class="mono">${esc(p.preview.label)}</figcaption></figure>`
    : ''
  return `${p.summary.map((s) => `<p>${esc(s)}</p>`).join('')}
${preview}${facts}
${links}${credit}`
}

export function panelHtml(p, i, total) {
  return `<p class="mono tag">${num(i)} / ${num(total - 1)}</p>
<h2>${esc(p.title)}</h2>
<p class="kind">${esc(p.kind)}</p>
${bodyHtml(p)}`
}

export function listHtml(person, projects) {
  return `<div class="intro">
<h1>${esc(person.name)}</h1>
<p>${esc(person.line)}</p>
</div>
<ol class="index">
${projects
  .map(
    (p, i) => `<li id="p-${p.id}">
<span class="mono n">${num(i)}</span>
<div class="t"><h2>${esc(p.title)}</h2><p class="kind">${esc(p.kind)}</p></div>
<div class="b">${bodyHtml(p)}</div>
</li>`,
  )
  .join('\n')}
</ol>`
}
