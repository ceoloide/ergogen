const fs = require('fs-extra')
const path = require('path')
const glob = require('glob')
const Ajv = require('ajv')
const u = require('../../src/utils')
const a = require('../../src/assert')
const io = require('../../src/io')
const prep = require('../../src/prepare')
const units_lib = require('../../src/units')
const ergogen = require('../../src/ergogen')
const schema = require('../../meta/schema.json')

const root = path.join(__dirname, '..', '..')

describe('Schema', function() {

    this.timeout(30000)
    this.slow(10000)

    // strictRequired would flag params that are required next to an allOf $ref
    const validate = new Ajv({strict: true, allowUnionTypes: true, strictRequired: false, allErrors: true}).compile(schema)
    const violations = config => validate(config) ? [] : validate.errors.map(e => `${e.instancePath} ${e.message}`)

    // the schema describes the config after preprocessing, just like the engine sees it
    const canonical = raw => {
        const [config] = io.interpret(raw, () => {})
        return prep.parameterize(prep.inherit(prep.unnest(config)))
    }

    const engine_error = async config => {
        try {
            await ergogen.process(u.deepcopy(config))
        } catch (ex) {
            return ex.message
        }
        return ''
    }

    // built-ins, as the registries themselves also contain the injected test-only entries
    const builtins = dir => fs.readdirSync(path.join(root, 'src', dir))
        .filter(file => file != 'index.js')
        .map(file => path.basename(file, '.js'))
        .sort()

    it('accepts every valid test config', function() {
        const inputs = glob.sync('test/{points,outlines,cases,pcbs,footprints}/*.yaml', {cwd: root})
            .filter(input => !fs.existsSync(path.join(root, input.replace(/\.yaml$/, '___EXCEPTION.txt'))))
            .concat(glob.sync('test/fixtures/*.{yaml,yml,json}', {cwd: root}))
            .concat([path.join('test', 'fixtures', 'bundle', 'config.yaml')])
        inputs.length.should.be.above(40)
        const failures = {}
        for (const input of inputs) {
            const errors = violations(canonical(fs.readFileSync(path.join(root, input)).toString()))
            if (errors.length) failures[input] = errors
        }
        failures.should.deep.equal({})
    })

    it('accepts every documented feature', async function() {
        const features = {
            meta: {engine: '4.0', version: 'v1.2.3', author: 'Tester'},
            units: {kx: 'u + 1', cy: null},
            variables: {ky: 'kx - 1', $default_autobind: 5},
            points: {
                zones: {
                    matrix: {
                        anchor: {shift: 10, rotate: 5, affect: ['x', 'y']},
                        rotate: 1,
                        columns: {
                            pinky: {key: {splay: 5, origin: [0, -10], tags: ['outer']}},
                            ring: {
                                key: {stagger: 3, spread: 'kx', mirror: {width: 20}},
                                rows: {top: '$unset'}
                            }
                        },
                        rows: {
                            bottom: {bind: [null, 5]},
                            top: {skip: null}
                        },
                        key: {
                            orient: 1, shift: [0, 1], rotate: -1, adjust: {shift: [0, 0]},
                            padding: 'ky', bind: [0, 0, 0, 0], asym: 'both',
                            colrow: '{{col.name}}{{row}}', name: '{{zone.name}}_{{colrow}}', custom: 1
                        }
                    },
                    thumb: {
                        anchor: [
                            {ref: 'matrix_pinkybottom', orient: {ref: 'matrix_ringbottom'}},
                            {
                                aggregate: {method: 'average', parts: ['matrix_pinkybottom', 'matrix_ringbottom']},
                                resist: true,
                                shift: [0, -20]
                            }
                        ],
                        mirror: {ref: 'matrix_pinkybottom', shift: [-30, 0], distance: 100},
                        key: {width: 20, height: 18}
                    }
                },
                key: {autobind: 3, origin: null, shift: null},
                rotate: 0,
                mirror: {ref: 'matrix_pinkytop', distance: 200}
            },
            outlines: {
                keys: [{what: 'rectangle', where: true, asym: 'both', size: ['cx', 'cy'], corner: 1, bevel: 0.5, bound: true}],
                shapes: {
                    plate: {what: 'polygon', points: ['matrix_pinkybottom', {shift: [10, 0]}, {shift: [0, 10]}]},
                    hole: {what: 'circle', radius: 3, where: '/matrix/', adjust: {shift: [0, 'r']}, operation: 'subtract'},
                    wrap: {
                        what: 'hull', where: 'thumb', points: ['matrix_pinkybottom', 'matrix_ringbottom'],
                        concavity: 100, extend: false, operation: 'stack'
                    },
                    line: {what: 'path', segments: [
                        {type: 'line', points: [{shift: [10, 10]}, {shift: [-20, 0]}]},
                        {type: 'bezier', points: [{shift: [-5, 10]}, {shift: [25, -10]}], accuracy: 1}
                    ]},
                    copy: {what: 'outline', name: 'keys', origin: 'matrix_pinkybottom', operation: 'intersect', fillet: 0.5, scale: 1.1},
                    dot: {what: 'circle', radius: 1, where: ['matrix_pinkybottom', {shift: [1, 0]}]}
                },
                grown: ['keys', {name: 'keys', expand: '2]'}, {name: 'keys', expand: 1, joints: 'round'}, '-shapes']
            },
            cases: {
                base: [{name: 'keys', extrude: 2, shift: [0, 0, 1], rotate: [0, 0, 5], operation: 'add'}, '-grown'],
                top: {first: {what: 'case', name: 'base', shift: [0, 0, 2]}, second: '~base'}
            },
            pcbs: {
                main: {
                    template: 'kicad8',
                    references: true,
                    params: {anything: 1},
                    outlines: [{outline: 'keys', layer: 'F.SilkS'}],
                    footprints: {
                        switches: {
                            what: 'mx', where: true, asym: 'both', adjust: {rotate: 180},
                            params: {hotswap: 1, from: '{{colrow}}', to: 'GND', mirror: {reverse: 'true'}}
                        },
                        mirrored_via: {what: 'via', where: 'matrix_pinkybottom', asym: 'clone', params: {mirror: {net: 'GND'}}},
                        unplaced: {what: 'mx', where: false},
                        mcu: {what: 'promicro', where: {ref: 'matrix_pinkybottom', shift: [0, 30]}, params: {orientation: 'up'}},
                        pad: {what: 'pad', params: {width: 'u / 10', mirrored: false, net: 'GND'}}
                    }
                }
            }
        }
        violations(features).should.deep.equal([])
        const results = await ergogen.process(u.deepcopy(features))
        Object.keys(results.outlines).should.deep.equal(['keys', 'shapes', 'grown'])
        Object.keys(results.cases).should.deep.equal(['base', 'top'])
        Object.keys(results.pcbs).should.deep.equal(['main'])
    })

    it('rejects what the engine rejects', async function() {
        const base = {
            points: {zones: {matrix: {columns: {one: null}, rows: {only: null}}}},
            outlines: {box: [{what: 'rectangle', where: true, size: 18}]}
        }
        const shift = x => ({shift: [x, 0]})
        // [config patch (or a function changing the base), engine error snippet, schema violation path]
        const invalid = [
            // meta, units and points
            [{meta: {engine: 'four'}}, 'Invalid semver', '/meta/engine'],
            [{units: [1]}, 'should be of type object', '/units'],
            [{points: '$unset'}, 'does not contain a points clause', ' must have required property \'points\''],
            [{points: {zones: '$unset'}}, 'should be of type object', '/points'],
            [{points: {foo: 1}}, 'Unexpected key "foo"', '/points'],
            [{points: {zones: {matrix: {stagger: 5}}}}, 'Unexpected key "stagger"', '/points/zones/matrix'],
            [{points: {zones: {matrix: {columns: {one: {spread: 5}}}}}}, 'Unexpected key "spread"', '/points/zones/matrix/columns/one'],
            [{points: {key: {skip: 'yes'}}}, 'should be of type boolean', '/points/key/skip'],
            [{points: {key: {asym: 'middle'}}}, 'should be one of', '/points/key/asym'],
            [{points: {key: {shift: 5}}}, 'should be an array', '/points/key/shift'],
            [{points: {key: {orient: {ref: 'matrix_one_only'}}}}, 'should be of type number', '/points/key/orient'],
            [{points: {key: {bind: [1, 2, 3, 4, 5]}}}, 'should be an array of length 4', '/points/key/bind'],
            [{points: {mirror: {ref: 'matrix_one_only', foo: 1}}}, 'Unexpected key "foo"', '/points/mirror'],
            [{points: {mirror: {ref: 'matrix_one_only', aggregate: {parts: []}}}}, 'cannot appear together', '/points/mirror'],
            // a patch would apply $unset itself, so it is set directly
            [c => u.deep(c, 'points.zones.matrix.rows.only', '$unset'), 'should be of type number', '/points/zones/matrix/rows/only'],
            // anchors
            [{points: {zones: {matrix: {anchor: {foo: 1}}}}}, 'Unexpected key "foo"', '/points/zones/matrix/anchor'],
            [{points: {zones: {matrix: {anchor: {aggregate: {method: 'median'}}}}}}, 'Unknown aggregator method', '/points/zones/matrix/anchor'],
            [{points: {zones: {matrix: {anchor: {shift: [1, 1], affect: 'xz'}}}}}, 'should be one of', '/points/zones/matrix/anchor'],
            [{points: {zones: {matrix: {anchor: {ref: 'matrix_one_only', aggregate: {parts: []}}}}}}, 'cannot appear together', '/points/zones/matrix/anchor'],
            // outlines
            [{outlines: {bad: [{what: 'square'}]}}, 'should be one of', '/outlines/bad/0'],
            [{outlines: {bad: [{what: 'rectangle', size: 5, radius: 5}]}}, 'Unexpected key "radius"', '/outlines/bad/0'],
            [{outlines: {bad: [{what: 'circle'}]}}, 'should be of type number', '/outlines/bad/0'],
            [{outlines: {bad: [{what: 'outline'}]}}, 'does not name an existing outline', '/outlines/bad/0'],
            [{outlines: {bad: [{what: 'circle', radius: 5, operation: 'union'}]}}, 'should be one of', '/outlines/bad/0'],
            [{outlines: {bad: [{what: 'circle', radius: 5, expand: 1, joints: 3}]}}, 'should be one of', '/outlines/bad/0'],
            [{outlines: {bad: [{what: 'circle', radius: 5, where: [true, shift(1)]}]}}, 'should be of type object', '/outlines/bad/0'],
            [{outlines: {bad: [{what: 'hull', points: ['matrix_one_only'], extend: 'yes'}]}}, 'should be of type boolean', '/outlines/bad/0'],
            [{outlines: {bad: [{what: 'path', segments: [{type: 'spline', points: [shift(0), shift(10)]}]}]}}, 'should be one of', '/outlines/bad/0'],
            [{outlines: {bad: [{what: 'path', segments: [{type: 'line', points: [shift(0), shift(10)], accuracy: 1}]}]}}, 'Unexpected key "accuracy"', '/outlines/bad/0'],
            // cases
            [{cases: {bad: [{extrude: 1}]}}, 'should be of type string', '/cases/bad/0'],
            [{cases: {bad: [{name: 'box', where: true}]}}, 'Unexpected key "where"', '/cases/bad/0'],
            [{cases: {bad: ['^box']}}, 'should be one of', '/cases/bad/0'],
            [{cases: {bad: [{name: 'box', shift: [1, 2]}]}}, 'should be an array of length 3', '/cases/bad/0'],
            [{cases: {ok: ['box'], bad: [{what: 'case', name: 'ok', extrude: 5}]}}, 'should not be used when what=case', '/cases/bad/0'],
            // pcbs and footprints
            [{pcbs: {main: {foo: 1}}}, 'Unexpected key "foo"', '/pcbs/main'],
            [{pcbs: {main: {references: 'yes'}}}, 'should be of type boolean', '/pcbs/main/references'],
            [{pcbs: {main: {footprints: [{where: true}]}}}, 'should be one of', '/pcbs/main/footprints/0'],
            [{pcbs: {main: {footprints: [{what: 'via', foo: 1, params: {net: 'GND'}}]}}}, 'Unexpected key "foo"', '/pcbs/main/footprints/0'],
            [{pcbs: {main: {footprints: [{what: 'via', params: {net: 'GND', foo: 1}}]}}}, 'Unexpected key "foo"', '/pcbs/main/footprints/0/params'],
            [{pcbs: {main: {footprints: [{what: 'via', params: {net: 5}}]}}}, 'should be of type string', '/pcbs/main/footprints/0/params/net'],
            [{pcbs: {main: {footprints: [{what: 'mx', params: {from: 'A'}}]}}}, 'should be of type string', '/pcbs/main/footprints/0/params'],
            [
                {points: {mirror: 30}, pcbs: {main: {footprints: [{what: 'via', where: true, asym: 'both', params: {net: 'GND', mirror: {foo: 1}}}]}}},
                'Unexpected key "foo"', '/pcbs/main/footprints/0/params/mirror'
            ]
        ]

        // the base itself has to be valid, so that each failure is down to its patch
        violations(base).should.deep.equal([])
        ;(await engine_error(base)).should.equal('')

        const mismatches = []
        for (const [patch, snippet, where] of invalid) {
            const is_fn = typeof patch == 'function'
            const config = is_fn ? patch(u.deepcopy(base)) : prep.extend(base, patch)
            const label = is_fn ? patch.toString() : JSON.stringify(patch)
            const error = await engine_error(config)
            if (!error.includes(snippet)) {
                mismatches.push(`${label}: engine error "${error}" does not include "${snippet}"`)
            }
            const errors = violations(config)
            if (!errors.some(e => e.startsWith(where))) {
                mismatches.push(`${label}: no schema violation at "${where}" (${errors.join(', ')})`)
            }
        }
        mismatches.should.deep.equal([])
    })

    it('rejects mirror axes the engine cannot evaluate', async function() {
        // a string axis is passed through unevaluated, so an expression silently yields NaN
        const config = {points: {zones: {matrix: null}, mirror: 'u'}}
        const results = await ergogen.process(u.deepcopy(config), {debug: true})
        results.points.mirror_matrix.x.should.be.NaN
        violations(config).should.include('/points/mirror must be number')
    })

    it('leaves placement-dependent checks to the engine', async function() {
        // mirror overrides only reach mirrored points, so a net set only there is accepted
        const mirror_only = {
            points: {zones: {matrix: null}, mirror: 30},
            pcbs: {main: {footprints: [{what: 'via', where: true, asym: 'both', params: {mirror: {net: 'GND'}}}]}}
        }
        violations(mirror_only).should.deep.equal([])
        ;(await engine_error(mirror_only)).should.include('should be of type string')

        // only an explicit "where: false" skips required nets, not a filter that happens to match nothing
        const unmatched = {
            points: {zones: {matrix: null}},
            pcbs: {main: {footprints: [{what: 'via', where: 'nothing'}]}}
        }
        violations(unmatched).should.not.deep.equal([])
        ;(await engine_error(unmatched)).should.equal('')
    })

    it('matches the built-in registries', function() {
        const defs = schema.definitions

        // footprint names, params and their types
        const footprint_names = defs.footprint.properties.what.anyOf[0].enum
        footprint_names.should.deep.equal(builtins('footprints'))
        const typed = defs.footprint.allOf.filter(cond => cond.if.properties.what)
        typed.map(cond => cond.if.properties.what.const).should.deep.equal(footprint_names)
        const requiring = defs.footprint.allOf.find(cond => cond.else).else.allOf
            .map(cond => cond.if.properties.what.const)
        for (const name of footprint_names) {
            const params = require(`../../src/footprints/${name}`).params

            // nets without a default are required, either directly or through mirror overrides
            const nets = Object.keys(params).filter(param => params[param] === undefined)
            const nets_def = defs[`footprint_nets_${name}`]
            if (nets.length) {
                requiring.should.include(name)
                nets_def.allOf.map(cond => cond.anyOf[0].required[0]).should.deep.equal(nets)
                nets_def.allOf.map(cond => cond.anyOf[1].properties.mirror.required[0]).should.deep.equal(nets)
            } else {
                requiring.should.not.include(name)
                should.not.exist(nets_def)
            }

            const props = defs[`footprint_params_${name}`].properties
            Object.keys(props).should.deep.equal(Object.keys(params).concat('mirror'))
            for (const [param, def] of Object.entries(params)) {
                let type = def === undefined ? 'net' : a.type(def)()
                if (type == 'object') type = def.type
                props[param].$ref.should.equal(`#/definitions/footprint_param_${type}`)
            }
        }

        // pcb templates
        defs.pcb.properties.template.anyOf[0].enum.should.deep.equal(builtins('templates'))

        // default units
        Object.keys(defs.units.properties).should.deep.equal(Object.keys(units_lib.parse({})))

        // asym aliases
        for (const alias of defs.asym.enum) {
            a.asym(alias, 'asym').should.be.oneOf(['source', 'clone', 'both'])
        }
    })
})
