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

    // strictRequired would flag the ref/aggregate exclusion, which names fields defined elsewhere
    const validate = new Ajv({strict: true, allowUnionTypes: true, strictRequired: false, allErrors: true}).compile(schema)
    const violations = config => validate(config) ? [] : validate.errors.map(e => `${e.instancePath} ${e.message}`)

    // the schema describes the config after preprocessing, just like the engine sees it
    const canonical = raw => {
        const [config] = io.interpret(raw, () => {})
        return prep.concat(prep.parameterize(prep.inherit(prep.unnest(config))))
    }

    const engine_error = async config => {
        try {
            await ergogen.process(u.deepcopy(config))
        } catch (ex) {
            return ex.message
        }
        return ''
    }

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
            variables: {ky: 'kx - 1', step: 'triangle_sss(3, 4, 5)', $default_autobind: 5},
            points: {
                zones: {
                    matrix: {
                        anchor: {shift: 10, rotate: 5, affect: ['x', 'y']},
                        rotate: 1,
                        columns: {
                            pinky: {key: {splay: 5, origin: [0, -10], tags: ['outer']}},
                            ring: {
                                key: {stagger: 3, spread: 'kx', mirror: {width: 20, row: 'mirrored'}},
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
                    dot: {what: 'circle', radius: 1, where: ['matrix_pinkybottom', {shift: [1, 0]}]},
                    svg: {
                        what: 'svg', where: 'thumb', paths: ['M 0 0 L 0 -2.5 L -2.5 -2.5 Z'],
                        accuracy: 0.001, flip_vertically: true, origin: [1, 1], operation: 'stack'
                    },
                    socket: {what: 'choc_hotswap_socket', where: 'thumb', origin: [0, 'step / 10'], flip_horizontally: true, operation: 'stack'}
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
            [{points: {key: {zone: 'x'}}}, 'Reserved key "zone"', '/points/key'],
            [{points: {key: {mirror: {rows: {}}}}}, 'Reserved key "rows"', '/points/key/mirror'],
            [{points: {zones: {matrix: {rows: {only: {key: {width: 1}}}}}}}, 'Reserved key "key"', '/points/zones/matrix/rows/only'],
            [{points: {key: {asym: 'middle'}}}, 'should be one of', '/points/key/asym'],
            [{points: {key: {shift: 5}}}, 'should be an array', '/points/key/shift'],
            [{points: {key: {orient: {ref: 'matrix_one_only'}}}}, 'should be of type number', '/points/key/orient'],
            [{points: {key: {bind: [1, 2, 3, 4, 5]}}}, 'should be an array of length 4', '/points/key/bind'],
            [{points: {mirror: {ref: 'matrix_one_only', foo: 1}}}, 'Unexpected key "foo"', '/points/mirror'],
            [{points: {mirror: 100, key: {mirror: 'oops'}}}, 'mirror" should be of type object', '/points/key/mirror'],
            [{points: {mirror: 100, key: {mirror: {zone: 'z'}}}}, 'mirror.zone" should be of type object', '/points/key/mirror'],
            [{points: {mirror: 100, key: {mirror: {col: 'c'}}}}, 'mirror.col" should be of type object', '/points/key/mirror'],
            [{points: {mirror: {ref: 'matrix_one_only', aggregate: {parts: []}}}}, 'cannot appear together', '/points/mirror'],
            // a patch would apply $unset itself, so it is set directly
            [c => u.deep(c, 'points.zones.matrix.rows.only', '$unset'), 'should be of type number', '/points/zones/matrix/rows/only'],
            // anchors
            [{points: {zones: {matrix: {anchor: {foo: 1}}}}}, 'Unexpected key "foo"', '/points/zones/matrix/anchor'],
            [{points: {zones: {matrix: {anchor: {aggregate: {method: 'median'}}}}}}, 'Unknown aggregator method', '/points/zones/matrix/anchor'],
            [{points: {zones: {matrix: {anchor: {shift: [1, 1], affect: 'xz'}}}}}, 'should be one of', '/points/zones/matrix/anchor'],
            [{points: {zones: {matrix: {anchor: {ref: 'matrix_one_only', aggregate: {parts: []}}}}}}, 'cannot appear together', '/points/zones/matrix/anchor'],
            // outline parts, as far as the engine handles them for every shape
            [{outlines: {bad: [5]}}, 'should be of type object', '/outlines/bad/0'],
            [{outlines: {bad: [{what: 5}]}}, 'should be one of', '/outlines/bad/0/what'],
            [{outlines: {bad: [{what: 'circle', radius: 5, operation: 'union'}]}}, 'should be one of', '/outlines/bad/0/operation'],
            [{outlines: {bad: [{what: 'circle', radius: 5, asym: 'middle'}]}}, 'should be one of', '/outlines/bad/0/asym'],
            [{outlines: {bad: [{what: 'circle', radius: 5, where: 5}]}}, 'Unexpected type "number"', '/outlines/bad/0/where'],
            [{outlines: {bad: [{what: 'circle', radius: 5, where: [true, shift(1)]}]}}, 'should be of type object', '/outlines/bad/0/where'],
            [{outlines: {bad: [{what: 'circle', radius: 5, adjust: {foo: 1}}]}}, 'Unexpected key "foo"', '/outlines/bad/0/adjust'],
            [{outlines: {bad: [{what: 'circle', radius: 5, expand: 1, joints: 3}]}}, 'should be one of', '/outlines/bad/0/joints'],
            [{outlines: {bad: [{what: 'circle', radius: 5, fillet: {}}]}}, 'should be of type number', '/outlines/bad/0/fillet'],
            // cases
            [{cases: {bad: [{extrude: 1}]}}, 'should be of type string', '/cases/bad/0'],
            [{cases: {bad: [{name: 'box', where: true}]}}, 'Unexpected key "where"', '/cases/bad/0'],
            [{cases: {bad: ['^box']}}, 'should be one of', '/cases/bad/0'],
            [{cases: {bad: [{name: 'box', shift: [1, 2]}]}}, 'should be an array of length 3', '/cases/bad/0'],
            [{cases: {ok: ['box'], bad: [{what: 'case', name: 'ok', extrude: 5}]}}, 'should not be used when what=case', '/cases/bad/0'],
            // pcbs and footprints, as far as the engine handles them for every template and footprint
            [{pcbs: {main: {foo: 1}}}, 'Unexpected key "foo"', '/pcbs/main'],
            [{pcbs: {main: {references: 'yes'}}}, 'should be of type boolean', '/pcbs/main/references'],
            [{pcbs: {main: {template: 5}}}, 'should be one of', '/pcbs/main/template'],
            [{pcbs: {main: {outlines: [{layer: 'F.SilkS'}]}}}, 'should be one of', '/pcbs/main/outlines/0'],
            [{pcbs: {main: {footprints: ['via']}}}, 'should be of type object', '/pcbs/main/footprints/0'],
            [{pcbs: {main: {footprints: [{where: true}]}}}, 'should be one of', '/pcbs/main/footprints/0'],
            [{pcbs: {main: {footprints: [{what: 'via', foo: 1, params: {net: 'GND'}}]}}}, 'Unexpected key "foo"', '/pcbs/main/footprints/0'],
            [{pcbs: {main: {footprints: [{what: 'via', where: 5, params: {net: 'GND'}}]}}}, 'Unexpected type "number"', '/pcbs/main/footprints/0/where'],
            [{pcbs: {main: {footprints: [{what: 'via', asym: 'middle', params: {net: 'GND'}}]}}}, 'should be one of', '/pcbs/main/footprints/0/asym'],
            [{pcbs: {main: {footprints: [{what: 'via', params: 'GND'}]}}}, 'should be of type object', '/pcbs/main/footprints/0/params'],
            [
                {points: {mirror: 30}, pcbs: {main: {footprints: [{what: 'via', where: true, asym: 'both', params: {net: 'GND', mirror: 'x'}}]}}},
                'should be of type object', '/pcbs/main/footprints/0/params/mirror'
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
            if (!error || !error.includes(snippet)) {
                mismatches.push(`${label}: engine error "${error}" does not include "${snippet}"`)
            }
            const errors = violations(config)
            if (!errors.some(e => e.startsWith(where))) {
                mismatches.push(`${label}: no schema violation at "${where}" (${errors.join(', ')})`)
            }
        }
        mismatches.should.deep.equal([])
    })

    it('accepts numeric mirror axes', async function() {
        // expressions are valid numbers, even though the engine doesn't evaluate them yet (ergogen/ergogen#171)
        for (const axis of [30, '30', 'u', 'u * 2']) {
            violations({points: {zones: {matrix: null}, mirror: axis}}).should.deep.equal([])
            violations({points: {zones: {matrix: {mirror: axis}}}}).should.deep.equal([])
        }
        const results = await ergogen.process({points: {zones: {matrix: null}, mirror: '30'}}, {debug: true})
        results.points.mirror_matrix.x.should.equal(60)
    })

    it('describes the preprocessed config', async function() {
        // inheritance and concatenation produce what the schema validates, not the raw input
        const raw = {
            'points.zones.matrix': null,
            outlines: {
                base: [{what: 'rectangle', where: true, size: 18}],
                cut: [{$extends: 'outlines.base.0', operation: '$concat("sub", "tract")', size: 10}]
            }
        }
        violations(raw).should.not.deep.equal([])
        violations(canonical(raw)).should.deep.equal([])
        ;(await engine_error(raw)).should.equal('')
    })

    it('accepts every mirror override form', async function() {
        // as in the engine's own interface test: overrides can be inherited, cleared or relabel,
        // and only their first level is checked for reserved names
        const raw = {
            'points.mirror': 100,
            'points.key.mirror.width': 30,
            'points.zones.matrix.columns.c': {},
            'points.zones.matrix.rows': {
                inherit: {mirror: null},
                cleared: {mirror: false},
                unset: {mirror: '$unset'},
                relabel: {mirror: {row: 'P1', mirror: {key: 'inner'}}}
            }
        }
        violations(canonical(raw)).should.deep.equal([])
        ;(await engine_error(raw)).should.equal('')

        // zone and column references can be relabeled, or dropped from an inherited override
        const relabeled = {
            'points.mirror': 100,
            'points.zones.matrix.columns.c': {},
            'points.key.mirror': {
                zone: {name: 'thumb', label: 5}, col: {name: 'outer'}, row: 7, custom: 'anything', mirror: 'inert'
            },
            'points.zones.matrix.rows': {
                kept: {},
                unset: {mirror: {zone: '$unset', col: '$unset'}},
                replaced: {mirror: {zone: {name: 'other'}, col: {name: 'inner'}}}
            }
        }
        violations(canonical(relabeled)).should.deep.equal([])
        ;(await engine_error(relabeled)).should.equal('')
    })

    it('leaves names, fields and params of shapes, footprints and templates to the engine', async function() {
        // whatever a registered shape, footprint or template does with its own fields is checked at runtime
        const points = {zones: {matrix: null}}
        const runtime = [
            [{outlines: {bad: [{what: 'square'}]}}, 'should be one of'],
            [{outlines: {bad: [{what: 'rectangle', size: 5, radius: 5}]}}, 'Unexpected key "radius"'],
            [{outlines: {bad: [{what: 'circle'}]}}, 'should be of type number'],
            [{pcbs: {main: {template: 'kicad9'}}}, 'should be one of'],
            [{pcbs: {main: {footprints: [{what: 'via', params: {net: 'GND', foo: 1}}]}}}, 'Unexpected key "foo"'],
            [{pcbs: {main: {footprints: [{what: 'via'}]}}}, 'should be of type string']
        ]
        for (const [config, snippet] of runtime) {
            violations({points, ...config}).should.deep.equal([])
            ;(await engine_error({points, ...config})).should.include(snippet)
        }
    })

    it('checks mirror overrides per level', async function() {
        // the engine only checks the merged override, and only when the key is actually mirrored
        const mirrored = {'points.mirror': 100, 'points.zones.matrix.columns.c': {}}
        const inert = {'points.zones.matrix': {}, 'points.key.mirror': 'oops'}
        violations(prep.unnest(inert)).should.not.deep.equal([])
        ;(await engine_error(inert)).should.equal('')
        const cleared_later = {...mirrored, 'points.key.mirror.zone': 'z', 'points.zones.matrix.rows.r.mirror': false}
        violations(prep.unnest(cleared_later)).should.not.deep.equal([])
        ;(await engine_error(cleared_later)).should.equal('')
        const nothing_to_unset = {...mirrored, 'points.key.mirror.zone': '$unset'}
        violations(prep.unnest(nothing_to_unset)).should.deep.equal([])
        ;(await engine_error(nothing_to_unset)).should.include('mirror.zone" should be of type object')
    })

    it('accepts any shape, footprint and template, built-in or injected', async function() {
        // names can be new or replace a built-in, and their fields and params are their own
        const plugins = {
            points: {zones: {matrix: null}, mirror: 30},
            outlines: {
                shapes: [
                    {what: 'my_shape', where: true, side: 2},
                    {what: 'choc_hotswap_socket', where: true, side: 4, operation: 'stack'}
                ]
            },
            pcbs: {
                main: {
                    template: 'kicad8',
                    params: {secret: 42},
                    footprints: [
                        {what: 'my_footprint', params: {label: 'new'}},
                        {what: 'mx', where: true, asym: 'both', params: {label: 'source', net: 'GND', mirror: {label: 'clone'}}}
                    ]
                }
            }
        }
        violations(plugins).should.deep.equal([])
        // the built-ins alone can't process it
        ;(await engine_error(plugins)).should.include('should be one of')

        // but with injections in place (restored afterwards) the engine can
        const registries = {
            outline: require('../../src/outlines/index'),
            footprint: require('../../src/footprints'),
            template: require('../../src/templates')
        }
        const square = (config, name, points, outlines, units) => {
            const side = a.sane(config.side, `${name}.side`, 'number')(units)
            const half = side / 2
            return [() => [u.rect(side, side, [-half, -half]), {low: [-half, -half], high: [half, half]}], units]
        }
        const labeled = {
            params: {designator: 'L', label: '', net: {type: 'net', value: 'GND'}},
            body: p => `(labeled ${p.at} "${p.label}" ${p.net})`
        }
        const template = {
            convert_outline: () => '',
            body: params => `custom ${params.custom.secret}\n${params.footprints.join('\n')}`
        }
        const injections = [
            ['outline', 'my_shape', square],
            ['outline', 'choc_hotswap_socket', square],
            ['footprint', 'my_footprint', labeled],
            ['footprint', 'mx', labeled],
            ['template', 'kicad8', template]
        ]
        const saved = injections.map(([type, name]) => [type, name, registries[type][name]])
        try {
            for (const [type, name, value] of injections) ergogen.inject(type, name, value)
            const results = await ergogen.process(u.deepcopy(plugins))
            Object.keys(results.outlines).should.deep.equal(['shapes'])
            const pcb = results.pcbs.main
            pcb.should.include('custom 42')
            for (const label of ['new', 'source', 'clone']) pcb.should.include(`"${label}"`)
        } finally {
            for (const [type, name, value] of saved) {
                if (value === undefined) delete registries[type][name]
                else registries[type][name] = value
            }
        }
        // and the registries are back to their built-ins
        ;(await engine_error(plugins)).should.include('should be one of')
    })

    it('matches the engine defaults and aliases', function() {
        const defs = schema.definitions

        // default units
        Object.keys(defs.units.properties).should.deep.equal(Object.keys(units_lib.parse({})))

        // asym aliases
        for (const alias of defs.asym.enum) {
            a.asym(alias, 'asym').should.be.oneOf(['source', 'clone', 'both'])
        }
    })
})
