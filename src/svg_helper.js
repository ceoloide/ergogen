const m = require('makerjs')
const a = require('./assert')
const u = require('./utils')

exports.svg_paths_to_outline = (paths_raw, config, name, points, outlines, units, accuracy = 0.0001) => {
    a.unexpected(config, name, ['paths', 'accuracy', 'flip_horizontally', 'flip_vertically', 'origin'])
    const actual_accuracy = a.sane(config.accuracy || accuracy, `${name}.accuracy`, 'number')(units)
    a.assert(actual_accuracy !== 0, `Accuracy for SVG outline "${name}" cannot be 0!`)

    const flip_horizontally = a.sane(config.flip_horizontally || false, `${name}.flip_horizontally`, 'boolean')(units)
    const flip_vertically = a.sane(config.flip_vertically || false, `${name}.flip_vertically`, 'boolean')(units)
    const origin = a.xy(config.origin || [0, 0], `${name}.origin`)(units)

    return [point => {
        let paths = []
        if (a.type(paths_raw)() == 'string') {
            paths = [paths_raw]
        } else if (a.type(paths_raw)() == 'array') {
            paths = paths_raw
        } else {
            a.assert(false, `Field "paths" for SVG outline "${name}" must be a string or an array!`)
        }

        let combined = undefined
        for (const [i, p] of paths.entries()) {
            a.assert(a.type(p)() == 'string', `Path ${i} for SVG outline "${name}" must be a string!`)
            const imported = m.importer.fromSVGPathData(p, actual_accuracy)
            if (combined === undefined) {
                combined = imported
            } else {
                combined = u.union(combined, imported)
                m.model.simplify(combined)
            }
        }
        let shape = combined
        shape = m.model.mirror(shape, false, true)

        if (origin[0] !== 0 || origin[1] !== 0) {
            shape = m.model.moveRelative(shape, [-origin[0], -origin[1]])
        }

        if (flip_horizontally || flip_vertically) {
            shape = m.model.mirror(shape, flip_horizontally, flip_vertically)
        }

        const chains = m.model.findChains(shape)
        a.assert(chains.length > 0, `SVG outline "${name}" does not contain any valid paths!`)
        for (const chain of chains) {
            a.assert(chain.endless, `SVG paths need to be closed shapes (check failed for "${name}")`)
        }

        if (point.meta.mirrored) {
            shape = m.model.mirror(shape, true, false)
        }
        const bbox = m.measure.modelExtents(shape)
        return [shape, {low: bbox.low, high: bbox.high}]
    }, units]
}
