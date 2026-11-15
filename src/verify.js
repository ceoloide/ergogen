const yaml = require('js-yaml')
const Ajv = require('ajv')
const u = require('./utils')
const prep = require('./prepare')
const schema = require('../meta/schema.json')

// compiled once, collecting every error so that independent problems are all reported
const validate = new Ajv({allErrors: true, verbose: true, allowUnionTypes: true}).compile(schema)

// keywords that describe one of several alternative forms of the same field
const alternatives = ['type', 'enum', 'const', 'anyOf']

const kind = val => Array.isArray(val) ? 'array' : (val === null ? 'null' : typeof val)

// structural diagnostics point into the canonical config, as path segments and a JSON pointer
const escape = key => key.replace(/~/g, '~0').replace(/\//g, '~1')
const unescape = segment => segment.replace(/~1/g, '/').replace(/~0/g, '~')
const segments = pointer => pointer.split('/').slice(1).map(unescape)
const dotted = pointer => segments(pointer).join('.')

const located = (code, pointer, message, extra) => Object.assign(
    {code, phase: 'structure', path: segments(pointer), pointer, message},
    extra
)

// diagnostics about a key within an object point to the key itself
const keyed = (code, label, parent, key, actual) => located(
    code,
    `${parent}/${escape(key)}`,
    `${label} key "${key}" within field "${dotted(parent)}"!`,
    {actual}
)

const structural = {
    required: e => {
        const pointer = `${e.instancePath}/${escape(e.params.missingProperty)}`
        return located('missing_field', pointer, `Field "${dotted(pointer)}" is missing!`)
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
        const fields = e.schema.required
        const names = fields.map(field => `"${field}"`).join(' and ')
        return located(
            'conflicting_fields',
            e.instancePath,
            `Fields ${names} cannot appear together in "${dotted(e.instancePath)}"!`,
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
    return located(
        code,
        e.instancePath,
        `Field "${dotted(e.instancePath)}" ${describe(e.params)}!`,
        {expected: e.params, actual: e.data}
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
    return located(
        values.length ? 'invalid_value' : 'invalid_type',
        pointer,
        `Field "${dotted(pointer)}" should be ${forms.join(', or ')}!`,
        {expected, actual: errors[0].data}
    )
}

const diagnose = exports._diagnose = errors => {

    // "if" only points at its "then", and keys failing propertyNames are reported by propertyNames itself
    errors = errors.filter(e => e.keyword != 'if' && e.propertyName === undefined)

    // a form that got further, with a nested or structural problem, supersedes the other forms of a field
    const superseded = pointer => errors.some(e => e.instancePath.startsWith(`${pointer}/`)
        || (e.instancePath == pointer && !alternatives.includes(e.keyword)))

    const diagnostics = []
    const grouped = {}
    for (const e of errors) {
        if (!alternatives.includes(e.keyword)) {
            diagnostics.push((structural[e.keyword] || generic)(e))
        } else if (!superseded(e.instancePath)) {
            if (!grouped[e.instancePath]) {
                grouped[e.instancePath] = []
                diagnostics.push(grouped[e.instancePath])
            }
            grouped[e.instancePath].push(e)
        }
    }
    return diagnostics.map(d => Array.isArray(d) ? alternative(d) : d)
}

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
    const fail = diagnostic => {
        result.diagnostics.push(diagnostic)
        return result
    }

    // parsing: YAML or JSON text, or an already parsed config object, but never JS code
    let config = raw
    if (typeof raw == 'string') {
        try {
            config = yaml.load(raw)
        } catch (ex) {
            return fail(syntax(ex))
        }
    }
    const type = kind(config)
    if (type == 'undefined' || type == 'null' || (type == 'object' && !Object.keys(config).length)) {
        return fail({code: 'empty_config', phase: 'parse', path: [], pointer: '', message: 'Input appears to be empty!'})
    }
    if (type != 'object') {
        return fail({
            code: 'invalid_root',
            phase: 'parse',
            path: [],
            pointer: '',
            message: `Input doesn't resolve into an object (got ${type})! Only YAML, JSON or config objects can be verified, not JS code or KLE layouts.`,
            expected: {type: ['object']},
            actual: type
        })
    }

    // preprocessing, in the same order as the engine, on a copy so that the input stays untouched
    result.checks.push('preprocess')
    config = u.deepcopy(config)
    for (const stage of prep.steps) {
        try {
            config = prep[stage](config)
        } catch (ex) {
            return fail({code: 'preprocess_error', phase: 'preprocess', stage, message: ex.message})
        }
    }
    result.canonical = config

    // structure, as described by the schema
    result.checks.push('structure')
    result.diagnostics = validate(config) ? [] : diagnose(validate.errors)
    result.valid = !result.diagnostics.length
    return result
}
