const yaml = require('js-yaml')
const u = require('./utils')
const prep = require('./prepare')
const schema = require('../meta/schema.json')

// keywords that describe one of several alternative forms of the same field
const alternatives = ['type', 'enum', 'const', 'anyOf']

// names that the engine's dotted paths would follow into the object prototype
const reserved_names = ['__proto__', 'constructor', 'prototype']

const kind = val => Array.isArray(val) ? 'array' : (val === null ? 'null' : typeof val)
const plain = val => [Object.prototype, null].includes(Object.getPrototypeOf(val))

// diagnostics point into the parsed input (before preprocessing) or the canonical config (after it),
// as path segments and a JSON pointer
const escape = key => key.replace(/~/g, '~0').replace(/\//g, '~1')
const unescape = segment => segment.replace(/~1/g, '/').replace(/~0/g, '~')
const segments = pointer => pointer.split('/').slice(1).map(unescape)
const dotted = pointer => segments(pointer).join('.')
const field = pointer => pointer ? `field "${dotted(pointer)}"` : 'the config root'

const located = (code, phase, pointer, message, extra) => Object.assign(
    {code, phase, path: segments(pointer), pointer, message},
    extra
)

//
// Input inspection
//

// a dotted key may end in "constructor" or "prototype" (that's just a field), but never passes through them
const unsafe_key = key => {
    const levels = key.split('.')
    const last = levels.pop()
    return last == '__proto__' || levels.some(level => reserved_names.includes(level))
}

const unsafe_references = val => {
    const paths = Array.isArray(val) ? val : [val]
    return paths.filter(path => typeof path == 'string' && path.split('.').some(level => reserved_names.includes(level)))
}

// verify accepts the data YAML can describe: plain objects and arrays, strings, numbers, booleans,
// null (or undefined) and dates, which preprocessing turns into empty objects, just like when processing
const inspect = (val, pointer, ancestors, inspected, issues) => {
    if (val === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof val) || val instanceof Date) return
    if (typeof val != 'object' || !(Array.isArray(val) || plain(val))) {
        const type = Object.prototype.toString.call(val).slice(8, -1)
        issues.push(located('unsupported_value', 'parse', pointer,
            `Value of ${field(pointer)} isn't plain YAML or JSON data (got ${type})!`, {actual: type}))
        return
    }
    if (ancestors.has(val)) {
        issues.push(located('cyclic_value', 'parse', pointer, `Value of ${field(pointer)} contains itself!`))
        return
    }
    // shared values, like YAML aliases, only need checking once
    if (inspected.has(val)) return
    inspected.add(val)
    ancestors.add(val)
    for (const [key, child] of Object.entries(val)) {
        const child_pointer = `${pointer}/${escape(key)}`
        if (unsafe_key(key)) {
            issues.push(located('unsafe_key', 'parse', child_pointer,
                `Key "${key}" within ${field(pointer)} would reach the object prototype!`))
            continue
        }
        if (key == '$extends') {
            for (const path of unsafe_references(child)) {
                issues.push(located('unsafe_reference', 'parse', child_pointer,
                    `Inheritance target "${path}" in ${field(child_pointer)} would reach the object prototype!`, {actual: path}))
            }
        }
        inspect(child, child_pointer, ancestors, inspected, issues)
    }
    ancestors.delete(val)
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
        throw new Error(`Ajv couldn't compile the config schema, which needs code generation (a strict content security policy blocks it): ${ex.message}`)
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
        `Field "${dotted(e.instancePath)}" ${describe(e.params)}!`,
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
        `Field "${dotted(pointer)}" should be ${forms.join(', or ')}!`,
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
    const issues = []
    inspect(config, '', new Set(), new Set(), issues)
    if (issues.length) return fail(issues)
    if (!Object.keys(config).length) return empty()

    // preprocessing, in the same order as the engine, which builds a new config from the input
    result.checks.push('preprocess')
    for (const stage of prep.steps) {
        try {
            config = prep[stage](config)
        } catch (ex) {
            return fail([{code: 'preprocess_error', phase: 'preprocess', stage, message: ex.message}])
        }
    }
    // the same copy the engine outputs as its canonical config
    config = result.canonical = u.deepcopy(config)

    // structure, as described by the schema
    result.checks.push('structure')
    const valid = validator()
    result.diagnostics = valid(config) ? [] : diagnose(valid.errors)
    result.valid = !result.diagnostics.length
    return result
}
