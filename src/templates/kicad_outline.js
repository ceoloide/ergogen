const m = require('makerjs')

// makerjs has y pointing up, while kicad has y pointing down
const xy = val => `${val[0]} ${-val[1]}`

exports.convert_outline = formatters => (model, layer) => {
    const grs = []
    m.model.walk(model, {
        onPath: wp => {
            const p = wp.pathContext
            switch (p.type) {
                case 'line':
                    grs.push(formatters.line({
                        start: xy(p.origin),
                        end: xy(p.end),
                        layer
                    }))
                    break
                case 'arc': {
                    const center = p.origin
                    const angle_start = p.startAngle > p.endAngle ? p.startAngle - 360 : p.startAngle
                    const angle_diff = Math.abs(p.endAngle - angle_start)
                    const start = m.point.rotate(m.point.add(center, [p.radius, 0]), angle_start, center)
                    const mid = m.point.rotate(start, angle_diff / 2, center)
                    const end = m.point.rotate(start, angle_diff, center)
                    grs.push(formatters.arc({
                        center: xy(center),
                        start: xy(start),
                        mid: xy(mid),
                        end: xy(end),
                        angle: -angle_diff,
                        layer
                    }))
                    break
                }
                case 'circle': {
                    const center = p.origin
                    const end = m.point.add(center, [p.radius, 0])
                    grs.push(formatters.circle({
                        center: xy(center),
                        end: xy(end),
                        layer
                    }))
                    break
                }
                default:
                    throw new Error(`Can't convert path type "${p.type}" to kicad!`)
            }
        }
    })
    return grs.join('\n')
}