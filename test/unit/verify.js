const fs = require('fs')
const path = require('path')
const u = require('../../src/utils')
const ergogen = require('../../src/ergogen')
const {fixture, lineends} = require('../helpers/fixture')

describe('Verify', function() {

    this.timeout(30000)
    this.slow(10000)

    const text = name => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name)).toString().replace(lineends, '\n')
    const summary = result => result.diagnostics.map(d => `${d.code} ${d.pointer}`)

    it('valid configs', async function() {
        // yaml text and config objects, with the same canonical config as the engine
        for (const raw of [fixture('minimal.yml'), text('big.yaml'), fixture('medium.yaml')]) {
            const result = ergogen.verify(raw)
            result.valid.should.be.true
            result.scope.should.equal('structure')
            result.checks.should.deep.equal(['parse', 'preprocess', 'structure'])
            result.diagnostics.should.deep.equal([])
            const processed = await ergogen.process(raw, {debug: true})
            result.canonical.should.deep.equal(processed.canonical)
        }
    })

    it('syntax errors', function() {
        // positions are 1-based, and nothing else is checked after a syntax error
        const result = ergogen.verify('points:\n  zones:\n    matrix: [\n  bad')
        result.should.deep.equal({
            valid: false,
            scope: 'structure',
            checks: ['parse'],
            diagnostics: [{
                code: 'syntax_error',
                phase: 'parse',
                line: 5,
                column: 1,
                message: 'Input is not valid YAML or JSON at line 5, column 1: unexpected end of the stream within a flow collection!'
            }]
        })
        // json is yaml, so its errors are reported the same way
        ergogen.verify('{"points": {"zones": [1, 2}}').diagnostics[0].should.include({code: 'syntax_error', line: 1, column: 27})
    })

    it('empty and non-object inputs', function() {
        for (const raw of ['', '# nothing here', null, undefined, {}]) {
            const result = ergogen.verify(raw)
            result.checks.should.deep.equal(['parse'])
            result.diagnostics.should.deep.equal([
                {code: 'empty_config', phase: 'parse', path: [], pointer: '', message: 'Input appears to be empty!'}
            ])
        }
        // kle layouts and js code are only understood by process, and the code is never run
        global.verify_ran = false
        const inputs = [
            [fixture('atreus_kle.json'), 'array'],
            ['global.verify_ran = true; return {}', 'string'],
            ['[1, 2]', 'array'],
            [5, 'number'],
            [true, 'boolean']
        ]
        for (const [raw, type] of inputs) {
            const diagnostic = ergogen.verify(raw).diagnostics[0]
            diagnostic.should.include({code: 'invalid_root', pointer: '', actual: type})
            diagnostic.expected.should.deep.equal({type: ['object']})
            diagnostic.message.should.include(`not ${type}`)
        }
        global.verify_ran.should.be.false
        delete global.verify_ran
    })

    it('unsupported inputs', function() {
        // only the data YAML can describe is accepted, reported where it was found in the input
        class Custom {}
        const cyclic = {points: {zones: {matrix: null}}}
        cyclic.points.again = cyclic.points
        const inputs = [
            ['points: &p\n  zones: {matrix: null}\n  again: *p', 'cyclic_value', '/points/again'],
            [cyclic, 'cyclic_value', '/points/again'],
            [{points: {zones: {matrix: null}}, units: {a: 10n}}, 'unsupported_value', '/units/a', 'BigInt'],
            [{points: {zones: {matrix: null}}, meta: {author: () => 'me'}}, 'unsupported_value', '/meta/author', 'Function'],
            [{points: {zones: {matrix: null}}, meta: {author: new Map([['a', 1]])}}, 'unsupported_value', '/meta/author', 'Map'],
            [{points: {zones: {matrix: null}}, meta: {author: Buffer.from('me')}}, 'unsupported_value', '/meta/author', 'Uint8Array'],
            [{points: {zones: {matrix: new Custom()}}}, 'unsupported_value', '/points/zones/matrix', 'Object'],
            [new Map([['points', {}]]), 'unsupported_value', '', 'Map']
        ]
        for (const [raw, code, pointer, actual] of inputs) {
            const result = ergogen.verify(raw)
            result.checks.should.deep.equal(['parse'])
            result.diagnostics.length.should.equal(1)
            result.diagnostics[0].should.include({code, phase: 'parse', pointer})
            if (actual) result.diagnostics[0].actual.should.equal(actual)
        }
        ergogen.verify(cyclic).diagnostics[0].message.should.equal('Value of field "points.again" contains itself!')
        ergogen.verify(new Map()).diagnostics[0].message.should.equal('Value of the config root isn\'t plain YAML or JSON data (got Map)!')

        // shared but acyclic values, prototype-less objects and undefined fields are fine
        const prototypeless = Object.assign(Object.create(null), {zones: {matrix: null}})
        ergogen.verify('shared: &s {matrix: null}\npoints:\n  zones: *s\n  key: {tags: *s}').valid.should.be.true
        ergogen.verify({points: prototypeless, meta: {author: undefined}}).valid.should.be.true
    })

    it('dates', async function() {
        // yaml dates end up just like when processing, and date objects in the input stay untouched
        const yaml = 'meta.created: 2026-01-01\npoints.zones.matrix:\n'
        const result = ergogen.verify(yaml)
        result.valid.should.be.true
        result.canonical.should.deep.equal((await ergogen.process(yaml, {debug: true})).canonical)
        const date = new Date(0)
        const input = {meta: {created: date}, points: {zones: {matrix: null}}}
        ergogen.verify(input).canonical.meta.should.deep.equal({created: {}})
        input.meta.created.should.equal(date)
    })

    it('keys reaching the object prototype', function() {
        const probe = () => Object.prototype.schema_probe
        try {
            const inputs = [
                ['points.zones.matrix:\n__proto__.schema_probe: 1\n', 'unsafe_key', '/__proto__.schema_probe',
                    'Key "__proto__.schema_probe" within the config root would reach the object prototype!'],
                [{points: {zones: {matrix: null}, key: {'constructor.prototype.schema_probe': 1}}}, 'unsafe_key',
                    '/points/key/constructor.prototype.schema_probe',
                    'Key "constructor.prototype.schema_probe" within field "points.key" would reach the object prototype!'],
                ['{"points": {"zones": {"matrix": null}}, "__proto__": {"schema_probe": 1}}', 'unsafe_key', '/__proto__'],
                [{points: {zones: {matrix: {$extends: 'a.__proto__.schema_probe.x'}}}, a: {}}, 'unsafe_reference',
                    '/points/zones/matrix/$extends',
                    'Inheritance target "a.__proto__.schema_probe.x" in field "points.zones.matrix.$extends" would reach the object prototype!'],
                [{points: {zones: {matrix: {$extends: ['a', 'constructor.prototype']}}}, a: {}}, 'unsafe_reference',
                    '/points/zones/matrix/$extends']
            ]
            for (const [raw, code, pointer, message] of inputs) {
                const result = ergogen.verify(raw)
                result.checks.should.deep.equal(['parse'])
                result.diagnostics.length.should.equal(1)
                result.diagnostics[0].should.include({code, phase: 'parse', pointer})
                if (message) result.diagnostics[0].message.should.equal(message)
                should.not.exist(probe())
            }
            // those names can still end a key, as plain custom metadata
            ergogen.verify({points: {zones: {matrix: null}, key: {constructor: 1, 'meta.prototype': 2}}}).valid.should.be.true
            should.not.exist(probe())
            // and later calls are unaffected
            ergogen.verify(fixture('minimal.yml')).valid.should.be.true
        } finally {
            delete Object.prototype.schema_probe
        }
    })

    it('preprocessing errors', function() {
        // the failing step is named, and the config is not checked any further
        const failing = [
            [{points: {zones: {matrix: {$extends: 'nowhere'}}}}, 'inherit', 'does not name a valid inheritance target'],
            [{points: {zones: {matrix: {$params: ['a'], $args: ['b', 'c']}}}}, 'parameterize', 'don\'t match'],
            [{points: {zones: {matrix: null}}, units: {a: '$concat("x"'}}, 'concat', 'missing closing parenthesis']
        ]
        for (const [raw, stage, snippet] of failing) {
            const result = ergogen.verify(raw)
            result.valid.should.be.false
            result.checks.should.deep.equal(['parse', 'preprocess'])
            should.not.exist(result.canonical)
            result.diagnostics.length.should.equal(1)
            result.diagnostics[0].should.include({code: 'preprocess_error', phase: 'preprocess', stage})
            result.diagnostics[0].message.should.include(snippet)
        }
    })

    it('preprocessed configs', function() {
        // dotted keys, inheritance, parameters and concatenation are resolved before checking
        const result = ergogen.verify([
            'units.side: 18',
            'templates:',
            '  box: {what: rectangle, where: true, size: side}',
            '  cut: {$params: [__op__], $args: [subtract], what: circle, where: true, radius: 3, operation: __op__}',
            'points.zones.matrix:',
            'outlines:',
            '  plate:',
            '    - $extends: templates.box',
            '    - $extends: templates.cut',
            '      operation: $concat("sub", "tract")'
        ].join('\n'))
        result.diagnostics.should.deep.equal([])
        result.canonical.outlines.plate.should.deep.equal([
            {what: 'rectangle', where: true, size: 'side'},
            {what: 'circle', where: true, radius: 3, operation: 'subtract'}
        ])
    })

    it('independent structural errors', function() {
        // every problem is reported once, at the field it concerns
        const result = ergogen.verify({
            points: {
                zones: {matrix: {stagger: 5, columns: {one: {key: {zone: 1}}}}},
                mirror: {ref: 'matrix', aggregate: {parts: []}}
            },
            outlines: {plate: [5, {what: 'circle', operation: 'union', joints: 3}, '']},
            cases: {shell: [{what: 'case', name: 'plate', extrude: 1, shift: [1]}]},
            pcbs: {main: {references: 'yes', footprints: [{where: true}, {what: 'mx', params: 'x'}]}}
        })
        result.valid.should.be.false
        result.checks.should.deep.equal(['parse', 'preprocess', 'structure'])
        summary(result).should.deep.equal([
            'unexpected_field /points/zones/matrix/stagger',
            'reserved_field /points/zones/matrix/columns/one/key/zone',
            'conflicting_fields /points/mirror',
            'invalid_type /outlines/plate/0',
            'invalid_value /outlines/plate/1/operation',
            'invalid_value /outlines/plate/1/joints',
            'invalid_length /outlines/plate/2',
            'unexpected_field /cases/shell/0/extrude',
            'invalid_length /cases/shell/0/shift',
            'invalid_type /pcbs/main/references',
            'missing_field /pcbs/main/footprints/0/what',
            'invalid_type /pcbs/main/footprints/1/params'
        ])

        // the contract of each kind of diagnostic
        const by_pointer = pointer => result.diagnostics.find(d => d.pointer == pointer)
        by_pointer('/points/zones/matrix/stagger').should.deep.equal({
            code: 'unexpected_field',
            phase: 'structure',
            path: ['points', 'zones', 'matrix', 'stagger'],
            pointer: '/points/zones/matrix/stagger',
            message: 'Unexpected key "stagger" within field "points.zones.matrix"!',
            actual: 5
        })
        by_pointer('/points/zones/matrix/columns/one/key/zone').message
            .should.equal('Reserved key "zone" within field "points.zones.matrix.columns.one.key"!')
        by_pointer('/points/mirror').should.deep.include({
            message: 'Fields "ref" and "aggregate" cannot appear together in field "points.mirror"!',
            expected: {not_together: ['ref', 'aggregate']}
        })
        by_pointer('/outlines/plate/0').should.deep.include({
            message: 'Field "outlines.plate.0" should be of type string or object!',
            expected: {type: ['string', 'object']},
            actual: 5
        })
        by_pointer('/outlines/plate/1/joints').should.deep.include({
            message: 'Field "outlines.plate.1.joints" should be one of [0, 1, 2, "round", "pointy", "beveled"], or of type string!',
            expected: {values: [0, 1, 2, 'round', 'pointy', 'beveled'], type: ['string']},
            actual: 3
        })
        by_pointer('/outlines/plate/2').message.should.equal('Field "outlines.plate.2" should have at least 1 characters!')
        by_pointer('/cases/shell/0/shift').should.deep.include({
            message: 'Field "cases.shell.0.shift" should have at least 3 items!',
            expected: {limit: 3},
            actual: [1]
        })
        by_pointer('/pcbs/main/footprints/0/what').should.deep.equal({
            code: 'missing_field',
            phase: 'structure',
            path: ['pcbs', 'main', 'footprints', '0', 'what'],
            pointer: '/pcbs/main/footprints/0/what',
            message: 'Field "pcbs.main.footprints.0.what" is missing!'
        })
    })

    it('alternative forms', function() {
        // a value that fits none of the forms of a field gets one diagnostic, listing all of them
        const result = ergogen.verify({
            meta: {engine: 'four'},
            points: {
                zones: {
                    matrix: {anchor: 5, key: {origin: [1, 2, 3]}, columns: {one: {rows: {top: 5}}}},
                    thumb: {anchor: {ref: 'matrix', foo: 1}}
                },
                mirror: [1]
            }
        })
        summary(result).should.deep.equal([
            'invalid_format /meta/engine',
            'invalid_type /points/zones/matrix/anchor',
            'invalid_value /points/zones/matrix/columns/one/rows/top',
            'invalid_length /points/zones/matrix/key/origin',
            'unexpected_field /points/zones/thumb/anchor/foo',
            'invalid_type /points/mirror'
        ])
        const messages = result.diagnostics.map(d => d.message)
        messages.should.include('Field "meta.engine" should match the pattern "^v?\\d+(\\.\\d+){0,2}(-.*)?$"!')
        messages.should.include('Field "points.zones.matrix.anchor" should be of type string or array or object!')
        messages.should.include('Field "points.zones.matrix.key.origin" should have at most 2 items!')
        messages.should.include('Field "points.zones.matrix.columns.one.rows.top" should be one of ["$unset"], or of type object or null!')
        // a field name with special characters keeps its exact path
        const odd = ergogen.verify({points: {zones: {'a/b~c': {stagger: 1}}}}).diagnostics[0]
        odd.pointer.should.equal('/points/zones/a~1b~0c/stagger')
        odd.path.should.deep.equal(['points', 'zones', 'a/b~c', 'stagger'])
    })

    it('results never share the schema', function() {
        // changing a diagnostic doesn't change what later calls report
        const config = {
            points: {zones: {matrix: null}, mirror: {ref: 'matrix', aggregate: {parts: []}}},
            outlines: {plate: [{what: 'circle', operation: 'union'}]}
        }
        const first = ergogen.verify(config).diagnostics
        first[0].expected.not_together.push('changed')
        first[1].expected.values.push('changed')
        const second = ergogen.verify(config).diagnostics
        second[0].expected.not_together.should.deep.equal(['ref', 'aggregate'])
        second[1].expected.values.should.deep.equal(['add', 'subtract', 'intersect', 'stack'])
    })

    it('large configs', function() {
        // every independent problem is still reported, one per field
        const zones = {}
        for (let i = 0; i < 2000; i++) zones[`zone${i}`] = {stagger: 1, anchor: 5}
        const result = ergogen.verify({points: {zones}})
        result.diagnostics.length.should.equal(4000)
        result.diagnostics.filter(d => d.code == 'unexpected_field').length.should.equal(2000)
        result.diagnostics.filter(d => d.code == 'invalid_type').length.should.equal(2000)
    })

    it('dynamic and injected configs', function() {
        // shapes, footprints and templates are checked when processing, so any name and field is fine
        const result = ergogen.verify({
            points: {zones: {matrix: null}, key: {custom: {anything: [1]}}},
            outlines: {plate: [{what: 'my_shape', where: true, sides: 5, style: {round: true}}]},
            pcbs: {main: {template: 'my_template', params: ['any'], footprints: [{what: 'my_footprint', params: {label: 'x'}}]}}
        })
        result.valid.should.be.true
        result.diagnostics.should.deep.equal([])
    })

    it('inputs stay untouched', async function() {
        const input = {
            'points.zones.matrix': {key: {$extends: 'shared'}},
            shared: {width: 20},
            outlines: {plate: [{what: 'rectangle', where: true, size: '$concat("1", "8")'}]}
        }
        const original = u.deepcopy(input)
        const result = ergogen.verify(input)
        result.valid.should.be.true
        input.should.deep.equal(original)
        // the result is plain data
        JSON.parse(JSON.stringify(result)).should.deep.equal(result)
        // and processing the same object afterwards is unaffected
        const after = await ergogen.process(input, {debug: true})
        const fresh = await ergogen.process(original, {debug: true})
        after.outlines.should.deep.equal(fresh.outlines)
        after.canonical.should.deep.equal(result.canonical)
    })
})
