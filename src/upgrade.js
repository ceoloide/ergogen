const u = require('./utils')
const version = require('../package.json').version

const detectV3 = (config) => {
    if (config.meta && config.meta.engine) {
        try {
            const engine = u.semver(config.meta.engine)
            if (engine.major === 3) return true
        } catch (e) {
            // Not a valid semver, could be old
        }
    }

    // Structural cues for v3
    if (config.points && config.points.zones) {
        for (const zone of Object.values(config.points.zones)) {
            if (zone && typeof zone === 'object' && zone.columns) {
                for (const [col_name, col] of Object.entries(zone.columns)) {
                    // Only check actual column objects (no dots in names after unnest)
                    if (col_name.includes('.')) continue
                    if (typeof col === 'object' && col !== null) {
                        // These keys were moved to 'key' in v4
                        if (col.stagger !== undefined || col.spread !== undefined || col.rotate !== undefined || col.origin !== undefined || col.row_overrides !== undefined) return true
                    }
                }
            }
        }
    }

    if (config.outlines && config.outlines.exports) return true

    return false
}

const upgrade = (config, logger = () => {}) => {
    if (typeof config !== 'object' || config === null) return config
    if (!detectV3(config)) return config

    logger('Ergogen v3 engine syntax was detected and it would be auto-updated. Suggest to enable debug to look at the canonical.yaml to see the result of the auto update.')

    const res = u.deepcopy(config)

    // 1. Meta update
    res.meta = res.meta || {}
    res.meta.engine = version

    // 2. Points update
    if (res.points) {
        const processPointObj = (obj) => {
            if (!obj || typeof obj !== 'object') return

            // Fix columns in zones
            if (obj.zones && typeof obj.zones === 'object') {
                for (const zone of Object.values(obj.zones)) {
                    if (zone && typeof zone === 'object' && zone.columns) {
                        for (const [col_name, col] of Object.entries(zone.columns)) {
                            if (col_name.includes('.')) continue
                            if (typeof col === 'object' && col !== null) {
                                const key_updates = {}
                                if (col.stagger !== undefined) {
                                    key_updates.stagger = col.stagger
                                    delete col.stagger
                                }
                                if (col.spread !== undefined) {
                                    key_updates.spread = col.spread
                                    delete col.spread
                                }
                                if (col.rotate !== undefined) {
                                    key_updates.splay = col.rotate
                                    delete col.rotate
                                }
                                if (col.origin !== undefined) {
                                    key_updates.origin = col.origin
                                    delete col.origin
                                }

                                if (Object.keys(key_updates).length > 0) {
                                    col.key = Object.assign(key_updates, col.key || {})
                                }

                                if (col.row_overrides) {
                                    col.rows = col.row_overrides
                                    delete col.row_overrides
                                }
                            }
                        }
                    }
                }
            }

            // Fix asym
            if (obj.asym === 'left') obj.asym = 'source'
            if (obj.asym === 'right') obj.asym = 'clone'

            // Recurse
            for (const key of Object.keys(obj)) {
                if (key === 'zones') continue // zones handled specially
                if (typeof obj[key] === 'object') processPointObj(obj[key])
            }
        }
        processPointObj(res.points)
    }

    // 3. Outlines update
    if (res.outlines) {
        const old_outlines = res.outlines
        const new_outlines = {}

        if (old_outlines.glue) {
            new_outlines._glue = old_outlines.glue
        }

        const source_outlines = old_outlines.exports ? old_outlines.exports : old_outlines

        for (const [outline_name, parts] of Object.entries(source_outlines)) {
            if (outline_name === 'exports' || outline_name === 'glue' || outline_name.startsWith('_')) continue

            const new_parts = {}
            const parts_obj = (Array.isArray(parts) ? {...parts} : parts) || {}
            for (let [part_name, part] of Object.entries(parts_obj)) {
                let new_part = typeof part === 'string' ? part : u.deepcopy(part)
                if (typeof new_part === 'object' && new_part !== null) {
                    // anchor -> adjust
                    if (new_part.anchor) {
                        new_part.adjust = new_part.anchor
                        delete new_part.anchor
                    }

                    // type -> what
                    if (new_part.type) {
                        new_part.what = new_part.type
                        delete new_part.type
                    }
                    // keys -> rectangle with where: true
                    if (new_part.what === 'keys') {
                        new_part.what = 'rectangle'
                        if (new_part.side === 'left') new_part.where = {mirrored: false}
                        else if (new_part.side === 'right') new_part.where = {mirrored: true}
                        else new_part.where = true
                        delete new_part.side
                        if (new_part.bound === undefined) new_part.bound = true
                    }

                    // asym fix
                    if (new_part.asym === 'left') new_part.asym = 'source'
                    if (new_part.asym === 'right') new_part.asym = 'clone'

                    // rectangle alignment fix: v3 corner-aligned -> v4 center-aligned
                    if (new_part.what === 'rectangle' && new_part.size) {
                        const size = new_part.size
                        let sw, sh
                        if (Array.isArray(size)) {
                            sw = size[0]
                            sh = size[1]
                        } else {
                            sw = sh = size
                        }

                        new_part.adjust = new_part.adjust || {}
                        const shift = [
                            typeof sw === 'number' ? sw / 2 : '(' + sw + ') / 2',
                            typeof sh === 'number' ? sh / 2 : '(' + sh + ') / 2'
                        ]

                        if (new_part.adjust.shift) {
                            const old_shift = new_part.adjust.shift
                            if (Array.isArray(old_shift)) {
                                new_part.adjust.shift = [
                                    '(' + old_shift[0] + ') + ' + shift[0],
                                    '(' + old_shift[1] + ') + ' + shift[1]
                                ]
                            } else {
                                new_part.adjust.shift = [
                                    '(' + old_shift + ') + ' + shift[0],
                                    shift[1]
                                ]
                            }
                        } else {
                            new_part.adjust.shift = shift
                        }
                    }
                }
                new_parts[part_name] = new_part
            }
            new_outlines[outline_name] = new_parts
        }
        res.outlines = new_outlines
    }

    return res
}

module.exports = {
    detectV3,
    upgrade
}
