import sys

def main():
    file_path = 'src/outlines.js'
    with open(file_path, 'r') as f:
        lines = f.readlines()

    start_line = -1
    end_line = -1
    for i, line in enumerate(lines):
        if 'const svg = (config, name, points, outlines, units) => {' in line:
            start_line = i
        if start_line != -1 and 'return [shape, {low: bbox.low, high: bbox.high}]' in line:
            end_line = i + 2 # capture return and close brace
            break

    if start_line == -1 or end_line == -1:
        print("Could not find svg function")
        sys.exit(1)

    new_svg = """const svg = (config, name, points, outlines, units) => {
    a.unexpected(config, name, ['path', 'points', 'accuracy'])
    let path_raw = config.path
    let points_raw = config.points
    const accuracy = a.sane(config.accuracy || 0.0001, `${name}.accuracy`, 'number')(units)
    a.assert(accuracy !== 0, `Accuracy for SVG outline \"${name}\" cannot be 0!`)

    a.assert(path_raw || points_raw, `Either \"path\" or \"points\" must be provided for SVG outline \"${name}\"!`)
    a.assert(!(path_raw && points_raw), `Both \"path\" and \"points\" cannot be provided for SVG outline \"${name}\"!`)

    return [() => {
        let shape
        if (path_raw) {
            let paths = []
            if (a.type(path_raw)() == 'string') {
                paths = [path_raw]
            } else if (a.type(path_raw)() == 'array') {
                paths = path_raw
            } else {
                a.assert(false, `Field \"path\" for SVG outline \"${name}\" must be a string or an array!`)
            }

            shape = { models: {} }
            for (const [i, p] of paths.entries()) {
                a.assert(a.type(p)() == 'string', `Path ${i} for SVG outline \"${name}\" must be a string!`)
                shape.models['path' + i] = m.importer.fromSVGPathData(p, accuracy)
            }
        } else {
            let parsed_points = []
            if (a.type(points_raw)() == 'string') {
                const parts = points_raw.split(/[\\s,]+/).filter(p => p.length > 0)
                a.assert(parts.length % 2 == 0, `Points string for SVG outline \"${name}\" must have an even number of coordinates!`)
                for (let i = 0; i < parts.length; i += 2) {
                    parsed_points.push([parseFloat(parts[i]), parseFloat(parts[i+1])])
                }
            } else if (a.type(points_raw)() == 'array') {
                for (const [i, p] of points_raw.entries()) {
                    if (a.type(p)() == 'array') {
                        a.assert(p.length == 2, `Point ${i} for SVG outline \"${name}\" must have 2 coordinates!`)
                        parsed_points.push([p[0], p[1]])
                    } else if (a.type(p)() == 'object') {
                        a.assert(p.x !== undefined && p.y !== undefined, `Point ${i} for SVG outline \"${name}\" must have x and y properties!`)
                        parsed_points.push([p.x, p.y])
                    } else {
                        a.assert(false, `Point ${i} for SVG outline \"${name}\" is not a valid point!`)
                    }
                }
            } else {
                a.assert(false, `Field \"points\" for SVG outline \"${name}\" must be a string or an array!`)
            }
            shape = new m.models.ConnectTheDots(true, parsed_points)
        }

        const chains = m.model.findChains(shape)
        a.assert(chains.length > 0, `SVG outline \"${name}\" does not contain any valid paths!`)
        for (const chain of chains) {
            a.assert(chain.endless, `SVG paths need to be closed shapes (check failed for \"${name}\")`)
        }

        const bbox = m.measure.modelExtents(shape)
        return [shape, {low: bbox.low, high: bbox.high}]
    }, units]
}
"""

    new_lines = lines[:start_line] + [new_svg] + lines[end_line:]
    with open(file_path, 'w') as f:
        f.writelines(new_lines)

if __name__ == "__main__":
    main()
