const u = require('../utils')

// PJ-320A TRRS jack, matching the built-in trrs footprint (not reversed) and seen from the top
module.exports = (config, name, points, outlines, units) => {
    // svg coordinates relative to the footprint center (y pointing down), so the default origin needs no offset
    // these are subpaths of a single path, so they stay visible as separate loops instead of being unioned
    const paths = [[
        // the body
        'M -5.35 0 L 0.75 0 L 0.75 12.1 L -5.35 12.1 Z',
        // the barrel that the plug enters from the north
        'M -5.1 -2 L 0.5 -2 L 0.5 0 L -5.1 0 Z',
        // the four pins
        u.svg_circle(-4.6, 11.3, 0.45),
        u.svg_circle(0, 10.2, 0.45),
        u.svg_circle(0, 6.2, 0.45),
        u.svg_circle(0, 3.2, 0.45),
        // the two locating pegs
        u.svg_circle(-2.3, 8.6, 0.75),
        u.svg_circle(-2.3, 1.6, 0.75)
    ].join(' ')]
    return u.svg_paths_to_outline(paths, config, name, points, outlines, units)
}