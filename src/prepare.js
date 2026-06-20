const u = require('./utils')
const a = require('./assert')

const _extend = exports._extend = (to, from) => {
    const to_type = a.type(to)()
    const from_type = a.type(from)()
    if (from === undefined || from === null) return to
    if (from === '$unset') return undefined
    if (to_type != from_type) return from
    if (from_type == 'object') {
        const res = u.deepcopy(to)
        for (const key of Object.keys(from)) {
            res[key] = _extend(to[key], from[key])
            if (res[key] === undefined) delete res[key]
        }
        return res
    } else if (from_type == 'array') {
        const res = u.deepcopy(to)
        for (const [i, val] of from.entries()) {
            res[i] = _extend(res[i], val)
        }
        return res
    } else return from
}

const extend = exports.extend = (...args) => {
    let res = args[0]
    for (const arg of args) {
        if (res == arg) continue
        res = _extend(res, arg)
    }
    return res
}

const traverse = exports.traverse = (config, root, breadcrumbs, op) => {
    if (a.type(config)() == 'object') {
        const result = {}
        for (const [key, val] of Object.entries(config)) {
            breadcrumbs.push(key)
            op(result, key, traverse(val, root, breadcrumbs, op), root, breadcrumbs)
            breadcrumbs.pop()
        }
        return result
    } else if (a.type(config)() == 'array') {
        // needed so that arrays can set output the same way as objects within ops
        const dummy = {}
        const result = []
        let index = 0
        for (const val of config) {
            breadcrumbs.push(`[${index}]`)
            op(dummy, 'dummykey', traverse(val, root, breadcrumbs, op), root, breadcrumbs)
            result[index] = dummy.dummykey
            breadcrumbs.pop()
            index++
        }
        return result
    }
    return config
}

exports.unnest = config => traverse(config, config, [], (target, key, val) => {
    u.deep(target, key, val)
})

exports.inherit = config => {
    const cache = new Map()
    const stack = []

    const resolve = (val, breadcrumbs) => {
        const type = a.type(val)()
        if (type !== 'object' && type !== 'array') return val
        if (cache.has(val)) return cache.get(val)

        a.assert(!stack.includes(val), `"${breadcrumbs.join('.')}" leads to a circular dependency!`)

        stack.push(val)
        let res
        if (type === 'object') {
            let current = val
            if (val.$extends !== undefined) {
                let candidates = val.$extends
                if (a.type(candidates)() !== 'array') candidates = [candidates]
                const list = []
                for (const path of candidates) {
                    const other = u.deep(config, path)
                    a.assert(other, `"${path}" (reached from "${breadcrumbs.join('.')}.$extends") does not name a valid inheritance target!`)
                    list.push(resolve(other, path.split('.')))
                }
                const own = u.deepcopy(val)
                delete own.$extends

                if (list.length === 1 && Object.keys(own).length === 0) {
                    current = list[0]
                } else {
                    list.push(own)
                    current = extend.apply(null, list)
                }
            }

            const current_type = a.type(current)()
            if (current_type === 'object') {
                res = {}
                for (const [k, v] of Object.entries(current)) {
                    res[k] = resolve(v, [...breadcrumbs, k])
                }
            } else if (current_type === 'array') {
                res = []
                for (let i = 0; i < current.length; i++) {
                    res[i] = resolve(current[i], [...breadcrumbs, `[${i}]`])
                }
            } else {
                res = current
            }
        } else { // array
            res = []
            for (let i = 0; i < val.length; i++) {
                res[i] = resolve(val[i], [...breadcrumbs, `[${i}]`])
            }
        }
        stack.pop()
        cache.set(val, res)
        return res
    }

    return resolve(config, [])
}

exports.parameterize = config => traverse(config, config, [], (target, key, val, root, breadcrumbs) => {

    // we only care about objects
    if (a.type(val)() !== 'object') {
        target[key] = val
        return 
    }

    let params = val.$params
    let args = val.$args

    // explicitly skipped (probably intermediate) template, remove (by not setting it)
    if (val.$skip) return

    // nothing to do here, just pass the original value through
    if (!params && !args) {
        target[key] = val
        return
    }

    // unused template, remove (by not setting it)
    if (params && !args) return

    if (!params && args) {
        throw new Error(`Trying to parameterize through "${breadcrumbs}.$args", but the corresponding "$params" field is missing!`)
    }

    params = a.strarr(params, `${breadcrumbs}.$params`)
    args = a.sane(args, `${breadcrumbs}.$args`, 'array')()
    if (params.length !== args.length) {
        throw new Error(`The number of "$params" and "$args" don't match for "${breadcrumbs}"!`)
    }

    let str = JSON.stringify(val)
    const zip = rows => rows[0].map((_, i) => rows.map(row => row[i]))
    for (const [par, arg] of zip([params, args])) {
        str = str.replace(new RegExp(`${par}`, 'g'), arg)
    }
    try {
        val = JSON.parse(str)
    } catch (ex) {
        throw new Error(`Replacements didn't lead to a valid JSON object at "${breadcrumbs}"! ` + ex)
    }

    delete val.$params
    delete val.$args
    target[key] = val
})

const parseArgs = (inner) => {
    const args = []
    let current = ''
    let depth = 0
    let inQuote = false
    let quoteChar = ''
    for (let i = 0; i < inner.length; i++) {
        const char = inner[i]
        if ((char === '"' || char === "'") && (i === 0 || inner[i-1] !== '\\')) {
            if (!inQuote) {
                inQuote = true
                quoteChar = char
                current += char
            } else if (char === quoteChar) {
                inQuote = false
                current += char
            } else {
                current += char
            }
        } else if (!inQuote && char === '(') {
            depth++
            current += char
        } else if (!inQuote && char === ')') {
            depth--
            current += char
        } else if (!inQuote && char === ',' && depth === 0) {
            args.push(current.trim())
            current = ''
        } else {
            current += char
        }
    }
    if (current.trim().length > 0 || inner.length === 0) {
        args.push(current.trim())
    }
    return args
}

const resolve = (val, root, breadcrumbs, seen = new Set()) => {
    if (a.type(val)() !== 'string') return val
    if (!val.startsWith('$concat(') || !val.endsWith(')')) return val

    if (seen.has(val)) {
        throw new Error(`Circular dependency detected in $concat at "${breadcrumbs.join('.')}": ${val}`)
    }
    seen.add(val)

    const inner = val.substring(8, val.length - 1)
    const args = parseArgs(inner)

    const res = args
        .filter(arg => arg.length > 0)
        .map(arg => {
            // String literal
            if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
                return arg.substring(1, arg.length - 1).replace(/\\(.)/g, '$1')
            }
            // $concat call
            if (arg.startsWith('$concat(')) {
                return resolve(arg, root, breadcrumbs, seen)
            }
            // Reference
            const ref = u.deep(root, arg)
            if (ref === undefined) {
                throw new Error(`Could not resolve reference "${arg}" in $concat at "${breadcrumbs.join('.')}"`)
            }
            return resolve(ref, root, breadcrumbs, seen)
        }).join('')

    seen.delete(val)
    return res
}

exports.concat = config => traverse(config, config, [], (target, key, val, root, breadcrumbs) => {
    target[key] = resolve(val, root, breadcrumbs)
})

exports.migrate = (config, logger = () => {}) => {
    let migrated = false

    // 1. Version-based detection
    if (config.meta && config.meta.engine) {
        const version = config.meta.engine
        try {
            const semver = u.semver(version)
            const threshold = u.semver('3.1.2')

            // If it's explicitly v3 or older, we migrate
            if (u.satisfies(threshold, semver)) {
                migrated = true
            }
        } catch (e) {
            // If semver parsing fails, we'll fall back to heuristics
        }
    }

    // 2. Heuristic-based detection (if version is not conclusive)
    if (!migrated) {
        const has_v3_points = () => {
             if (config.points && config.points.zones && a.type(config.points.zones)() == 'object') {
                for (const zone of Object.values(config.points.zones)) {
                    if (zone && zone.columns && a.type(zone.columns)() == 'object') {
                        for (const [col_name, col] of Object.entries(zone.columns)) {
                            if (col_name.includes('.')) continue
                            if (col && a.type(col)() == 'object') {
                                if (col.row_overrides !== undefined) return true
                                const to_move = ['stagger', 'spread', 'rotate', 'origin']
                                for (const attr of to_move) {
                                    if (col[attr] !== undefined) return true
                                }
                            }
                        }
                    }
                }
            }
            return false
        }

        const has_v3_parts = (obj) => {
            if (obj && a.type(obj)() == 'object') {
                for (const entry of Object.values(obj)) {
                    const parts = Array.isArray(entry) ? entry : (a.type(entry)() == 'object' ? Object.values(entry) : [])
                    for (const part of parts) {
                        if (part && a.type(part)() == 'object') {
                            if (part.type !== undefined && part.what === undefined) return true
                        }
                    }
                }
            }
            return false
        }

        if (has_v3_points() || has_v3_parts(config.outlines) || has_v3_parts(config.cases)) {
            migrated = true
        }

        if (!migrated && config.pcbs && a.type(config.pcbs)() == 'object') {
             for (const pcb of Object.values(config.pcbs)) {
                if (pcb && pcb.footprints && a.type(pcb.footprints)() == 'object') {
                    for (const fp of Object.values(pcb.footprints)) {
                        if (fp && a.type(fp)() == 'object') {
                            if (fp.type !== undefined && fp.what === undefined) {
                                migrated = true
                                break
                            }
                            const to_merge = ['anchor', 'nets', 'anchors']
                            for (const m of to_merge) {
                                if (fp[m] !== undefined) {
                                    migrated = true
                                    break
                                }
                            }
                        }
                        if (migrated) break
                    }
                }
                if (migrated) break
            }
        }
    }

    if (!migrated) return config

    logger('Ergogen v3 engine syntax detected, auto-updating...')
    logger('Suggest to enable debug to look at the canonical.yaml to see the result of the auto update.')

    // Perform migration
    const res = u.deepcopy(config)

    // points
    if (res.points && res.points.zones && a.type(res.points.zones)() == 'object') {
        for (const zone of Object.values(res.points.zones)) {
            if (zone && zone.columns && a.type(zone.columns)() == 'object') {
                for (const [col_name, col] of Object.entries(zone.columns)) {
                    if (col_name.includes('.')) continue
                    if (col && a.type(col)() == 'object') {
                        // move col-level attributes to key-level
                        const mapping = {
                            stagger: 'stagger',
                            spread: 'spread',
                            rotate: 'splay',
                            origin: 'origin'
                        }
                        for (const [old_attr, new_attr] of Object.entries(mapping)) {
                            if (col[old_attr] !== undefined) {
                                col.key = col.key || {}
                                if (a.type(col.key)() == 'object' && col.key[new_attr] === undefined) {
                                    col.key[new_attr] = col[old_attr]
                                }
                                delete col[old_attr]
                            }
                        }
                        // rename row_overrides to rows
                        if (col.row_overrides !== undefined) {
                            col.rows = col.row_overrides
                            delete col.row_overrides
                        }
                    }
                }
            }
        }
    }

    // outlines
    if (res.outlines && a.type(res.outlines)() == 'object') {
        for (const outline of Object.values(res.outlines)) {
            const parts = Array.isArray(outline) ? outline : (a.type(outline)() == 'object' ? Object.values(outline) : [])
            for (const part of parts) {
                if (part && a.type(part)() == 'object') {
                    if (part.type !== undefined && part.what === undefined) {
                        part.what = part.type
                        delete part.type
                    }
                }
            }
        }
    }

    // cases
    if (res.cases && a.type(res.cases)() == 'object') {
        for (const casing of Object.values(res.cases)) {
            const parts = Array.isArray(casing) ? casing : (a.type(casing)() == 'object' ? Object.values(casing) : [])
            for (const part of parts) {
                if (part && a.type(part)() == 'object') {
                    if (part.type !== undefined && part.what === undefined) {
                        part.what = part.type
                        delete part.type
                    }
                }
            }
        }
    }

    // pcbs
    if (res.pcbs && a.type(res.pcbs)() == 'object') {
        for (const pcb of Object.values(res.pcbs)) {
            if (pcb && pcb.footprints && a.type(pcb.footprints)() == 'object') {
                for (const fp of Object.values(pcb.footprints)) {
                    if (fp && a.type(fp)() == 'object') {
                        if (fp.type !== undefined && fp.what === undefined) {
                            fp.what = fp.type
                            delete fp.type
                        }
                        // merge anchor, nets, anchors into params
                        const to_merge = ['anchor', 'nets', 'anchors']
                        for (const m of to_merge) {
                            if (fp[m] !== undefined) {
                                fp.params = fp.params || {}
                                if (a.type(fp.params)() == 'object' && fp.params[m] === undefined) {
                                    fp.params[m] = fp[m]
                                }
                                delete fp[m]
                            }
                        }
                    }
                }
            }
        }
    }

    // ALWAYS include meta.engine: <current version>
    const package_json = require('../package.json')
    res.meta = res.meta || {}
    res.meta.engine = package_json.version

    return res
}
