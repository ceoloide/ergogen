// Renders real Ergogen geometry into labelled SVG panels.
// Run from the release checkout: node docs/assets/pr160/render.js <develop checkout> [output directory]
const fs = require('fs')
const path = require('path')

const roots = {head: process.cwd(), base: path.resolve(process.argv[2]), tools: __dirname}
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'spec.json'), 'utf8'))
const out_dir = process.argv[3] || __dirname
fs.mkdirSync(out_dir, {recursive: true})

const COLORS = {
  points: {stroke: '#9aa3ad', fill: '#eef1f4'},
  outline: {stroke: '#1f5fbf', fill: 'rgba(31,95,191,0.18)'},
  second: {stroke: '#c2410c', fill: 'rgba(194,65,12,0.15)'},
  axis: {stroke: '#6b7280', fill: 'none', dash: true},
  ghost: {stroke: '#9aa3ad', fill: 'none', dash: true},
}

const run = async (root, config_text, injections = []) => {
  const ergogen = require(path.join(roots[root], 'src/ergogen.js'))
  for (const inj of injections) ergogen.inject(...inj)
  return ergogen.process(config_text, {debug: true}, () => {})
}

const layer_paths = (root, model) => {
  const m = require(path.join(roots[root], 'node_modules/makerjs'))
  const ext = m.measure.modelExtents(model)
  const d = m.exporter.toSVGPathData(model, {origin: [0, 0], fillRule: 'evenodd'})
  return {d: typeof d === 'string' ? d : Object.values(d).join(' '), ext}
}

const main = async () => {
  for (const fig of spec) {
    const panels = []
    for (const panel of fig.panels) {
      const config_text = panel.yaml || fs.readFileSync(path.join(roots[panel.config_root || panel.root], panel.config), 'utf8')
      const res = await run(panel.root, config_text)
      const layers = []
      if (panel.points !== false) layers.push({...layer_paths(panel.root, res.demo.yaml), style: COLORS.points})
      for (const [i, name] of panel.outlines.entries()) {
        const style = COLORS[(panel.styles || [])[i] || (i ? 'second' : 'outline')]
        layers.push({...layer_paths(panel.root, res.outlines[name].yaml), style})
      }
      let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity]
      for (const l of layers) {
        if (!l.ext) continue
        lo = [Math.min(lo[0], l.ext.low[0]), Math.min(lo[1], l.ext.low[1])]
        hi = [Math.max(hi[0], l.ext.high[0]), Math.max(hi[1], l.ext.high[1])]
      }
      if (panel.axis_ref) {
        const P = res.points
        const ax = (P[panel.axis_ref].x + P['mirror_' + panel.axis_ref].x) / 2
        layers.push({d: `M ${ax} ${-hi[1] - 3} L ${ax} ${-lo[1] + 3}`, style: COLORS.axis})
      }
      panels.push({title: panel.title, layers, lo, hi})
    }
    // common scale for all panels of a figure
    const pad = 4
    const scale = fig.scale || 6
    const head = 30
    let x = 0
    const parts = []
    const panel_h = Math.max(...panels.map(p => (p.hi[1] - p.lo[1] + 2 * pad) * scale))
    for (const p of panels) {
      const w = (p.hi[0] - p.lo[0] + 2 * pad) * scale
      const vb = [p.lo[0] - pad, -p.hi[1] - pad, p.hi[0] - p.lo[0] + 2 * pad, p.hi[1] - p.lo[1] + 2 * pad]
      const body = p.layers.map(l => `<path d="${l.d}" fill="${l.style.fill}" fill-rule="evenodd" stroke="${l.style.stroke}" stroke-width="${1.6 / scale}"${l.style.dash ? ` stroke-dasharray="${4 / scale} ${3 / scale}"` : ''} stroke-linejoin="round"/>`).join('')
      parts.push(`<g transform="translate(${x},0)"><text x="${w / 2}" y="20" text-anchor="middle" font-family="DejaVu Sans" font-size="15" fill="#1f2328">${p.title}</text>` +
        `<svg x="0" y="${head}" width="${w}" height="${(vb[3]) * scale}" viewBox="${vb.join(' ')}">${body}</svg></g>`)
      x += w + 16
    }
    const W = Math.ceil(x - 16), H = Math.ceil(panel_h + head)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`
    fs.writeFileSync(path.join(out_dir, fig.name + '.svg'), svg)
    console.log(fig.name, W, H)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
