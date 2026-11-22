const yaml = require('js-yaml')
const u = require('./utils')
const prep = require('./prepare')
const schema = require('../meta/schema.json')

// keywords that describe one of several alternative forms of the same field
const alternatives = ['type', 'enum', 'const', 'anyOf']

// configs are bounded before every step that walks them recursively: 256 levels stay far below where any step
// (or ajv) runs out of stack, even with a third of node's default stack, and the number of values bounds how far
// shared YAML aliases, inheritance or array lengths can expand a config
const max_depth = 256
const max_values = 100000

const kind = val => Array.isArray(val) ? 'array' : (val === null ? 'null' : typeof val)
const plain = val => [Object.prototype, null].includes(Object.getPrototypeOf(val))
const own = (val, key) => Object.prototype.hasOwnProperty.call(Object(val), key)

// diagnostics point into the parsed input, the unnested config or the canonical config, depending on their phase,
// as path segments and a JSON pointer
const escape = key => key.replace(/~/g, '~0').replace(/\//g, '~1')
const unescape = segment => segment.replace(/~1/g, '/').replace(/~0/g, '~')
const segments = pointer => pointer.split('/').slice(1).map(unescape)
const dotted = pointer => segments(pointer).join('.')
const field = pointer => pointer ? `field "${dotted(pointer)}"` : 'the config root'
const subject = pointer => pointer ? `Field "${dotted(pointer)}"` : 'The config root'

const located = (code, phase, pointer, message, extra) => Object.assign(
    {code, phase, path: segments(pointer), pointer, message},
    extra
)

//
// Input inspection
//

// verify accepts finite plain data, as YAML or JSON describes it: a plain object at the root, plain objects and
// dense arrays below, strings, numbers, booleans, null, and plain dates, which preprocessing turns into empty objects,
// just like when processing (once the input is checked, a config is only checked for its size)
const inspect = (config, phase, stage, check_values=true) => {
    const issues = []
    const ancestors = new Set()
    let values = 0
    let exhausted = false
    const issue = (code, pointer, message, extra) => issues.push(located(code, phase, pointer, message, Object.assign({}, stage && {stage}, extra)))
    const walk = (val, pointer, depth) => {
        if (exhausted) return
        // dotted keys count too, as they nest just as deep once unnested, whatever their value
        if (depth > max_depth) return issue('too_deep', pointer, `Value of ${field(pointer)} is nested deeper than ${max_depth} levels!`)
        // repeated aliases and inherited copies count as often as they appear, and arrays by their length
        values += Array.isArray(val) ? val.length + 1 : 1
        if (values > max_values) {
            exhausted = true
            return issue('too_large', pointer, `The config has more than ${max_values} values by ${field(pointer)}!`)
        }
        if (val === null || ['string', 'number', 'boolean'].includes(typeof val)) return
        if (!check_values && typeof val != 'object') return
        const date = val instanceof Date && depth > 0 && !Object.getOwnPropertyNames(val).length
        if (check_values && !date && (typeof val != 'object' || !(Array.isArray(val) || plain(val)))) {
            const type = Object.prototype.toString.call(val).slice(8, -1)
            return issue('unsupported_value', pointer, `Value of ${field(pointer)} isn't plain YAML or JSON data (got ${type})!`, {actual: type})
        }
        if (ancestors.has(val)) return issue('cyclic_value', pointer, `Value of ${field(pointer)} contains itself!`)
        ancestors.add(val)
        // array slots are read by index, so that holes show up as undefined values
        const entries = Array.isArray(val) ? Array.from({length: val.length}, (_, i) => [`${i}`, val[i]]) : Object.entries(val)
        for (const [key, child] of entries) {
            walk(child, `${pointer}/${escape(key)}`, depth + (Array.isArray(val) ? 1 : key.split('.').length))
        }
        ancestors.delete(val)
    }
    walk(config, '', 0)
    return issues
}

//
// Preprocessing boundaries
//

// the engine follows dotted paths through anything a value has, inherited or not, so verify only lets it into data
// the config owns: a level that resolves to an inherited value (like the object prototype, or an object, array,
// string or number method) is reported instead, while missing levels are created just like the engine does
const reach = (step, level) => step[level] && !own(step, level)

// unnesting, replayed on a copy in the engine's order, to find the dotted keys that would leave the config
const unnest_issues = (val, pointer, issues) => {
    if (Array.isArray(val)) return val.map((child, i) => unnest_issues(child, `${pointer}/${i}`, issues))
    if (kind(val) != 'object') return val
    const result = {}
    for (const [key, child] of Object.entries(val)) {
        const child_pointer = `${pointer}/${escape(key)}`
        const nested = unnest_issues(child, child_pointer, issues)
        const levels = key.split('.')
        const last = levels.pop()
        let step = result
        let outside
        for (const level of levels) {
            if (reach(step, level)) {
                outside = level
                break
            }
            if (step[level]) step = step[level]
            else if (typeof step == 'object') step = step[level] = {}
            // within strings or numbers, the engine can't create anything (and fails on its own)
            else break
        }
        // setting "__proto__" would replace the object's prototype instead of setting a field
        if (outside === undefined && last == '__proto__') outside = last
        if (outside !== undefined) {
            issues.push(located('unsafe_key', 'preprocess', child_pointer,
                `Key "${key}" within ${field(pointer)} would reach "${outside}", which isn't part of the config!`, {stage: 'unnest'}))
            continue
        }
        if (typeof step == 'object') step[last] = nested
    }
    return result
}

// inheritance targets, once unnesting has settled every $extends, are looked up the same way
const reference_issues = (root, val, pointer, issues) => {
    if (!['object', 'array'].includes(kind(val))) return
    for (const [key, child] of Object.entries(val)) {
        const child_pointer = `${pointer}/${escape(key)}`
        if (key == '$extends' && kind(val) == 'object') {
            const paths = Array.isArray(child) ? child.map((path, i) => [path, `${child_pointer}/${i}`]) : [[child, child_pointer]]
            for (const [path, path_pointer] of paths) {
                if (typeof path != 'string') continue
                let step = root
                for (const level of path.split('.')) {
                    if (reach(step, level)) {
                        issues.push(located('unsafe_reference', 'preprocess', path_pointer,
                            `Inheritance target "${path}" in ${field(child_pointer)} would reach "${level}", which isn't part of the config!`,
                            {stage: 'inherit', actual: path}))
                        break
                    }
                    // a missing level within an object or array is created, anything else ends the lookup
                    if (step[level]) step = step[level]
                    else if (typeof step == 'object') step = {}
                    else break
                }
            }
        }
        reference_issues(root, child, child_pointer, issues)
    }
}

//
// Structural diagnostics
//

// ajv is only loaded and compiled once a config gets this far, so that processing never depends on it
let validate
const compile = exports._compile = Ajv => {
    if (typeof Ajv != 'function') {
        throw new Error('Verifying a config needs Ajv, which isn\'t available (in browsers, load it as the "ajv7" global)!')
    }
    try {
        // collecting every error, so that independent problems are all reported
        return new Ajv({allErrors: true, verbose: true, allowUnionTypes: true, logger: false}).compile(schema)
    } catch (ex) {
        throw new Error(`Ajv couldn't compile the config schema (a content security policy that blocks code generation can cause this): ${ex.message.trim().replace(/[.!]$/, '')}!`)
    }
}
const validator = () => {
    if (!validate) validate = compile(require('ajv'))
    return validate
}

const structure = (code, pointer, message, extra) => located(code, 'structure', pointer, message, extra)

// diagnostics about a key within an object point to the key itself
const keyed = (code, label, parent, key, actual) => structure(
    code,
    `${parent}/${escape(key)}`,
    `${label} key "${key}" within ${field(parent)}!`,
    {actual}
)

const structural = {
    required: e => {
        const pointer = `${e.instancePath}/${escape(e.params.missingProperty)}`
        return structure('missing_field', pointer, `Field "${dotted(pointer)}" is missing!`)
    },
    additionalProperties: e => {
        const key = e.params.additionalProperty
        return keyed('unexpected_field', 'Unexpected', e.instancePath, key, e.data[key])
    },
    // a field forbidden by a false schema, like extrude for what=case
    'false schema': e => {
        const parts = e.instancePath.split('/')
        const key = unescape(parts.pop())
        return keyed('unexpected_field', 'Unexpected', parts.join('/'), key, e.data)
    },
    propertyNames: e => {
        const key = e.params.propertyName
        return keyed('reserved_field', 'Reserved', e.instancePath, key, e.data[key])
    },
    // the only negation in the schema keeps fields like "ref" and "aggregate" apart
    not: e => {
        // copied, so that the result never shares the schema's own arrays
        const fields = [...e.schema.required]
        const names = fields.map(name => `"${name}"`).join(' and ')
        return structure(
            'conflicting_fields',
            e.instancePath,
            `Fields ${names} cannot appear together in ${field(e.instancePath)}!`,
            {expected: {not_together: fields}}
        )
    }
}

// the remaining keywords limit a single value, with ajv's own wording for anything unforeseen
const limits = {
    minItems: ['invalid_length', p => `should have at least ${p.limit} items`],
    maxItems: ['invalid_length', p => `should have at most ${p.limit} items`],
    minLength: ['invalid_length', p => `should have at least ${p.limit} characters`],
    pattern: ['invalid_format', p => `should match the pattern "${p.pattern}"`]
}

const generic = e => {
    const [code, describe] = limits[e.keyword] || ['invalid_config', () => e.message]
    return structure(
        code,
        e.instancePath,
        `${subject(e.instancePath)} ${describe(e.params)}!`,
        {expected: {...e.params}, actual: e.data}
    )
}

// all the forms a field could have taken become a single diagnostic
const alternative = errors => {
    const types = []
    const values = []
    for (const e of errors) {
        if (e.keyword == 'type') types.push(...[].concat(e.params.type))
        if (e.keyword == 'enum') values.push(...e.params.allowedValues)
        if (e.keyword == 'const') values.push(e.params.allowedValue)
    }
    const expected = {}
    const forms = []
    if (values.length) {
        expected.values = [...new Set(values)]
        forms.push(`one of [${expected.values.map(val => JSON.stringify(val)).join(', ')}]`)
    }
    if (types.length) {
        expected.type = [...new Set(types)]
        forms.push(`of type ${expected.type.join(' or ')}`)
    }
    const pointer = errors[0].instancePath
    return structure(
        values.length ? 'invalid_value' : 'invalid_type',
        pointer,
        `${subject(pointer)} should be ${forms.join(', or ')}!`,
        {expected, actual: errors[0].data}
    )
}

const diagnose = exports._diagnose = errors => {

    // "if" only points at its "then", and keys failing propertyNames are reported by propertyNames itself
    errors = errors.filter(e => e.keyword != 'if' && e.propertyName === undefined)

    // a form that got further, with a nested or structural problem, supersedes the other forms of a field,
    // so every field above an error, and every field with a structural error, is collected once
    const further = new Set()
    for (const e of errors) {
        if (!alternatives.includes(e.keyword)) further.add(e.instancePath)
        let pointer = e.instancePath
        while (pointer) {
            pointer = pointer.slice(0, pointer.lastIndexOf('/'))
            further.add(pointer)
        }
    }

    const diagnostics = []
    const grouped = {}
    for (const e of errors) {
        if (!alternatives.includes(e.keyword)) {
            diagnostics.push((structural[e.keyword] || generic)(e))
        } else if (!further.has(e.instancePath)) {
            if (!grouped[e.instancePath]) {
                grouped[e.instancePath] = []
                diagnostics.push(grouped[e.instancePath])
            }
            grouped[e.instancePath].push(e)
        }
    }
    return diagnostics.map(d => Array.isArray(d) ? alternative(d) : d)
}

//
// Verification
//

const syntax = ex => {
    const diagnostic = {code: 'syntax_error', phase: 'parse'}
    let where = ''
    if (ex.mark) {
        diagnostic.line = ex.mark.line + 1
        diagnostic.column = ex.mark.column + 1
        where = ` at line ${diagnostic.line}, column ${diagnostic.column}`
    }
    diagnostic.message = `Input is not valid YAML or JSON${where}: ${ex.reason || ex.message}!`
    return diagnostic
}

exports.verify = raw => {

    const result = {valid: false, scope: 'structure', checks: ['parse'], diagnostics: []}
    const fail = diagnostics => {
        result.diagnostics = diagnostics
        return result
    }

    // parsing: YAML or JSON text, or an already parsed config object, but never JS code
    let config = raw
    if (typeof raw == 'string') {
        try {
            config = yaml.load(raw)
        } catch (ex) {
            return fail([syntax(ex)])
        }
    }
    const empty = () => fail([located('empty_config', 'parse', '', 'Input appears to be empty!')])
    const type = kind(config)
    if (type == 'undefined' || type == 'null') return empty()
    if (type != 'object') {
        return fail([located('invalid_root', 'parse', '',
            `Input should be a YAML or JSON object, not ${type}, as JS code and KLE layouts can only be processed!`,
            {expected: {type: ['object']}, actual: type})])
    }
    let issues = inspect(config, 'parse')
    if (issues.length) return fail(issues)
    if (!Object.keys(config).length) return empty()

    // anything that still throws while preprocessing or checking is reported, as config problems never throw
    const attempt = (phase, stage, run) => {
        try {
            return run()
        } catch (ex) {
            issues = [{code: `${phase}_error`, phase, stage, message: ex.message}]
        }
    }

    // preprocessing, in the same order as the engine, which builds a new config from the input,
    // as long as its dotted keys and inheritance targets only lead into the config itself
    result.checks.push('preprocess')
    attempt('preprocess', 'unnest', () => unnest_issues(config, '', issues))
    if (issues.length) return fail(issues)
    for (const stage of prep.steps) {
        if (stage == 'inherit') {
            reference_issues(config, config, '', issues)
            if (issues.length) return fail(issues)
        }
        config = attempt('preprocess', stage, () => prep[stage](config))
        // steps can expand the config, so its size is checked again before anything walks it
        if (!issues.length) issues = inspect(config, 'preprocess', stage, false)
        if (issues.length) return fail(issues)
    }
    // structure, as described by the schema, on the same copy the engine outputs as its canonical config
    // (compiling the schema is left to throw, as that's an environment problem rather than a config one)
    result.checks.push('structure')
    const validate_config = validator()
    result.valid = attempt('structure', 'schema', () => validate_config(result.canonical = u.deepcopy(config)))
    if (issues.length) return fail(issues)
    result.diagnostics = result.valid ? [] : diagnose(validate_config.errors)
    return result
}
