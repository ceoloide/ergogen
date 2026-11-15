const yaml = require('js-yaml')
const m = require('makerjs')
const ergogen = require('../../src/ergogen')
const version = require('../../package.json').version
const {fixture} = require('../helpers/fixture')

// fixtures
const minimal = fixture('minimal.yaml')
const medium = fixture('medium.yaml')
const big = fixture('big.yaml')
const minimal_kle = fixture('minimal_kle.json')
const atreus_kle = fixture('atreus_kle.json')

describe('Interface', function() {

    this.timeout(120000)
    this.slow(120000)

    it('debug', async function() {
        // to check whether the output has "private" exports
        const underscore = obj => {
            for (const val of Object.values(obj)) {
                for (const key of Object.keys(val)) {
                    if (key.startsWith('_')) return true
                }
            }
            return false
        }
        underscore(await ergogen.process(minimal)).should.be.false
        underscore(await ergogen.process(big, {debug: false})).should.be.false
        underscore(await ergogen.process(big, {debug: true})).should.be.true
    })

    it('formats', async function() {
        const logger = msg => {
            if (msg.startsWith('Interpreting format:')) {
                throw msg.split(':')[1].trim()
            }
        }
        return Promise.all([
            ergogen.process(minimal, {debug: true}, logger).should.be.rejectedWith('OBJ'),
            ergogen.process(yaml.dump(minimal), {debug: true}, logger).should.be.rejectedWith('YAML'),
            ergogen.process(`
                //:
                return {points: {}}
            `, {debug: true}, logger).should.be.rejectedWith('JS'),
            ergogen.process(`
                //:
                return 'not an object';
            `, {debug: true}, logger).should.be.rejectedWith('not valid'),
            ergogen.process(minimal_kle, {debug: true}, logger).should.be.rejectedWith('KLE'),
            ergogen.process(atreus_kle, {debug: true}, logger).should.be.rejectedWith('KLE'),
            ergogen.process('not an object', {debug: true}, logger).should.be.rejectedWith('object'),
            ergogen.process({}, {debug: true}, logger).should.be.rejectedWith('empty'),
            ergogen.process({not_points: {}}, {debug: true}, () => {}).should.be.rejectedWith('points clause'),
            ergogen.process({points: {zones: {}}}, {debug: true}, () => {}).should.be.rejectedWith('any points')
        ])
    })

    it('preprocessor', async function() {
        return Promise.all([
            // unnesting
            ergogen.process({'points.zones.matrix': {}}).should.eventually.have.deep.property('canonical', {
                points: {zones: {matrix: {}}}
            }),
            // inheritance
            ergogen.process({
                'points.zones.parent.key.a': 1,
                'points.zones.child': {
                    '$extends': 'points.zones.parent',
                    'key.b': 2
                }
            }).should.eventually.have.deep.nested.property('canonical.points.zones.child.key', {
                a: 1,
                b: 2
            }),
            // parameterization
            ergogen.process({
                'points.zones.matrix.key': {
                    a: 'PAR',
                    $params: ['PAR'],
                    $args: [1]
                }
            }).should.eventually.have.deep.nested.property('canonical.points.zones.matrix.key', {
                a: '1'
            })
        ])
    })
    
    it('reserved keys', async function() {
        const reserved = (config, field, key) => ergogen.process(config).should.be.rejectedWith(
            `Reserved key "${key}" within field "${field}"`
        )
        const structure = 'this block is already a key-level config; move its fields up one level!'
        const metadata = 'it is reserved for engine-managed point metadata!'
        const zone = {'points.zones.matrix': {}}
        return Promise.all([
            // every reserved name, with a reason fitting the name
            ergogen.process({...zone, 'points.key.key': {}}).should.be.rejectedWith(
                `Reserved key "key" within field "points.key": ${structure}`
            ),
            reserved({...zone, 'points.key.zones': {}}, 'points.key', 'zones'),
            reserved({...zone, 'points.key.columns': {}}, 'points.key', 'columns'),
            reserved({...zone, 'points.key.rows': {}}, 'points.key', 'rows'),
            ergogen.process({...zone, 'points.key.zone': 'z'}).should.be.rejectedWith(
                `Reserved key "zone" within field "points.key": ${metadata}`
            ),
            reserved({...zone, 'points.key.col': 'c'}, 'points.key', 'col'),
            reserved({...zone, 'points.key.row': 'r'}, 'points.key', 'row'),
            // every key-level site, with dotted unnesting
            reserved({'points.zones.matrix.key.rows': {}}, 'points.zones.matrix.key', 'rows'),
            reserved({'points.zones.matrix.columns.c.key.columns': {}}, 'points.zones.matrix.columns.c.key', 'columns'),
            reserved({'points.zones.matrix.rows.r.key.width': 30}, 'points.zones.matrix.rows.r', 'key'),
            reserved({'points.zones.matrix.columns.c.rows.r.col': 'c'}, 'points.zones.matrix.columns.c.rows.r', 'col'),
            // immediate mirror overrides can't restructure, even without an active mirror
            reserved({...zone, 'points.key.mirror.key': {}}, 'points.key.mirror', 'key'),
            reserved({'points.zones.matrix.key.mirror.zones': {}}, 'points.zones.matrix.key.mirror', 'zones'),
            reserved({'points.zones.matrix.columns.c.key.mirror.columns': {}}, 'points.zones.matrix.columns.c.key.mirror', 'columns'),
            reserved({'points.zones.matrix.rows.r.mirror.rows': {}}, 'points.zones.matrix.rows.r.mirror', 'rows'),
            reserved({'points.zones.matrix.columns.c.rows.r.mirror.key': {}}, 'points.zones.matrix.columns.c.rows.r.mirror', 'key'),
            // inherited declarations are reported where they are used
            reserved({
                'shared.row.key.width': 30,
                'points.zones.matrix.rows.r.$extends': 'shared.row'
            }, 'points.zones.matrix.rows.r', 'key'),
            // an unset only resolves away through inheritance, otherwise the field survives
            reserved({'points.zones.matrix.rows.r.key': '$unset'}, 'points.zones.matrix.rows.r', 'key'),
            // later merge levels (or skipping the keys) can't rescue a surviving declaration
            reserved({
                'points.zones.matrix.key.skip': true,
                'points.zones.matrix.rows.r.key.width': 30,
                'points.zones.matrix.columns.c.rows.r': '$unset'
            }, 'points.zones.matrix.rows.r', 'key'),
            // inheriting and unsetting in the same object is fine
            ergogen.process({
                'shared.row': {key: {width: 30}, height: 20},
                'points.zones.matrix.rows.r': {$extends: 'shared.row', key: '$unset'}
            }).should.eventually.have.nested.property('points.matrix_default_r.meta.height', 20)
        ])
    })

    it('unreserved metadata', async function() {
        const names = result => Object.keys(result.points)

        // column-level row unsets still work, without new row type checks
        names(await ergogen.process({'points.zones.matrix': {
            rows: {a: {}, b: {}},
            columns: {c: {rows: {a: '$unset'}}, d: {}}
        }})).should.deep.equal(['matrix_c_b', 'matrix_d_a', 'matrix_d_b'])
        names(await ergogen.process({'points.zones.matrix': {
            rows: {gone: 123, keep: {}},
            columns: {single: {rows: {gone: '$unset'}}}
        }})).should.deep.equal(['matrix_single_keep'])

        // nested custom metadata isn't inspected, and prototype names aren't reserved
        const custom = (await ergogen.process({
            'points.zones.matrix': {},
            'points.key': {custom: {key: 1, rows: 2, col: 3}, toString: 'ts', constructor: 'ctor'}
        })).points.matrix.meta
        custom.custom.should.deep.equal({key: 1, rows: 2, col: 3})
        custom.toString.should.equal('ts')
        custom.constructor.should.equal('ctor')

        // allowed metadata can be consumed by templates and filters
        const consumed = await ergogen.process({
            'points.zones.matrix.columns': {
                one: {key: {'anchor.pin': 'P1'}},
                two: {key: {'anchor.pin': 'P2'}}
            },
            'points.key': {'extra.net': 'GND', label: '{{anchor.pin}}_{{extra.net}}'},
            'outlines.pins.main': {what: 'rectangle', where: 'meta.anchor.pin ~ P1', size: 4}
        }, {debug: true})
        consumed.points.matrix_one.meta.label.should.equal('P1_GND')
        consumed.points.matrix_two.meta.label.should.equal('P2_GND')
        const lines = consumed.outlines.pins.dxf.split('\n').filter(line => line.trim() == 'LINE')
        lines.length.should.equal(4) // a single rectangle, around the P1 key only

        // mirror overrides keep their null/false/$unset semantics, and can relabel rows
        const mirrored = (await ergogen.process({
            'points.mirror': 100,
            'points.key.mirror.width': 30,
            'points.zones.matrix.columns.c': {},
            'points.zones.matrix.rows': {
                inherit: {mirror: null},
                cleared: {mirror: false},
                unset: {mirror: '$unset'},
                relabel: {mirror: {row: 'P1', mirror: {key: 'inner'}}}
            }
        })).points
        mirrored.mirror_matrix_c_inherit.meta.width.should.equal(30)
        mirrored.mirror_matrix_c_cleared.meta.width.should.equal(18)
        mirrored.mirror_matrix_c_unset.meta.width.should.equal(18)
        mirrored.mirror_matrix_c_relabel.meta.row.should.equal('P1')
        mirrored.matrix_c_relabel.meta.mirror.mirror.should.deep.equal({key: 'inner'})
    })

    it('mirror overrides', async function() {
        const mirrored = {'points.mirror': 100, 'points.zones.matrix.columns.c': {}}
        const invalid = (config, field, _type) => ergogen.process({...mirrored, ...config}).should.be.rejectedWith(
            `Field "${field}" should be of type ${_type}!`
        )

        await Promise.all([
            // the override itself has to be an object (or one of the clearing forms)
            invalid({'points.key.mirror': 'oops'}, 'matrix_c.mirror', 'object'),
            invalid({'points.key.mirror': 5}, 'matrix_c.mirror', 'object'),
            invalid({'points.key.mirror': true}, 'matrix_c.mirror', 'object'),
            invalid({'points.key.mirror': [{width: 30}]}, 'matrix_c.mirror', 'object'),
            // checked on the merged key, so the breadcrumb names the affected key
            invalid({'points.zones.matrix.rows.r.mirror': 'oops'}, 'matrix_c_r.mirror', 'object'),
            // zone and column references can be relabeled, but not replaced
            invalid({'points.key.mirror.zone': 'z'}, 'matrix_c.mirror.zone', 'object'),
            invalid({'points.key.mirror.zone': '$unset'}, 'matrix_c.mirror.zone', 'object'),
            invalid({'points.key.mirror.zone.columns': '$unset'}, 'matrix_c.mirror.zone.columns', 'object'),
            invalid({'points.key.mirror.col': 'c'}, 'matrix_c.mirror.col', 'object'),
            // zone-level mirroring goes through the same checks
            ergogen.process({
                'points.zones.matrix': {mirror: 100, columns: {c: {}}},
                'points.key.mirror.zone': 'z'
            }).should.be.rejectedWith('Field "matrix_c.mirror.zone" should be of type object!')
        ])

        // without an active mirror, or for source-only keys, the override stays inert metadata
        const inert = (await ergogen.process({'points.zones.matrix': {}, 'points.key.mirror': 'oops'})).points
        inert.matrix.meta.mirror.should.equal('oops')
        const source = (await ergogen.process({
            ...mirrored, 'points.key': {asym: 'source', mirror: {zone: 'z'}}
        })).points
        Object.keys(source).should.deep.equal(['matrix_c'])

        // a later level can clear an invalid override before it's used
        const cleared = (await ergogen.process({
            ...mirrored,
            'points.key.mirror': {zone: 'z', col: 'c', width: 30},
            'points.zones.matrix.rows': {
                unset: {mirror: {zone: '$unset', col: '$unset'}},
                cleared: {mirror: false},
                replaced: {mirror: {zone: {name: 'thumb'}, col: {name: 'outer'}}}
            }
        })).points
        cleared.mirror_matrix_c_unset.meta.width.should.equal(30)
        cleared.mirror_matrix_c_unset.meta.zone.name.should.equal('matrix')
        cleared.mirror_matrix_c_unset.meta.col.name.should.equal('c')
        cleared.mirror_matrix_c_cleared.meta.width.should.equal(18)
        cleared.mirror_matrix_c_replaced.meta.zone.name.should.equal('thumb')
        cleared.mirror_matrix_c_replaced.meta.col.name.should.equal('outer')

        // valid relabels keep the rest of the shared structure, and nested metadata isn't inspected
        const relabeled = (await ergogen.process({
            ...mirrored,
            'points.zones.matrix.columns.d': {},
            'points.key.mirror': {
                zone: {name: 'thumb', label: 5},
                col: {name: 'outer'},
                row: 7,
                custom: 'anything',
                mirror: 'inert'
            }
        })).points
        const relabeled_meta = relabeled.mirror_matrix_c.meta
        relabeled_meta.zone.name.should.equal('thumb')
        relabeled_meta.zone.label.should.equal(5)
        Object.keys(relabeled_meta.zone.columns).should.deep.equal(['c', 'd'])
        relabeled_meta.col.name.should.equal('outer')
        relabeled_meta.row.should.equal(7)
        relabeled_meta.custom.should.equal('anything')
        // the source keys keep their own zone and column
        relabeled.matrix_c.meta.mirror.mirror.should.equal('inert')
        relabeled.matrix_c.meta.zone.name.should.equal('matrix')
        relabeled.matrix_c.meta.col.name.should.equal('c')

        // names that read as numbers or math constants stay plain names, with global or zone mirroring
        const numeric = (await ergogen.process({
            'points.mirror': 100,
            'points.zones': {
                1: {columns: {1: {}, e: {}}},
                e: {mirror: 50, columns: {pi: {}}}
            }
        })).points
        Object.keys(numeric).should.have.members(['1_1', '1_e', 'e_pi', 'mirror_e_pi', 'mirror_1_1', 'mirror_1_e'])
        numeric.mirror_1_1.meta.zone.name.should.equal('1')
        numeric.mirror_1_e.meta.col.name.should.equal('e')
        numeric.mirror_e_pi.meta.zone.name.should.equal('e')
        numeric.mirror_e_pi.meta.col.name.should.equal('pi')

        // and so do numeric relabels
        const renumbered = (await ergogen.process({
            ...mirrored, 'points.key.mirror': {zone: {name: 5}, col: {name: 7}}
        })).points
        renumbered.mirror_matrix_c.meta.zone.name.should.equal(5)
        renumbered.mirror_matrix_c.meta.col.name.should.equal(7)
    })

    it('engine', async function() {
        return Promise.all([
            ergogen.process({'meta.engine': 'invalid'}).should.be.rejectedWith('Invalid'),
            ergogen.process({'meta.engine': '0.1.2'}).should.be.rejectedWith('satisfy'),
            // no "points clause" means we're over the engine check, so it "succeeded"
            ergogen.process({'meta.engine': `${version}`}).should.be.rejectedWith('points clause')
        ])
    })

    it('svg', async function() {
        const result_svg = await ergogen.process(medium, {svg: true})
        result_svg.should.have.nested.property('outlines.export.svg')
        const result_no_svg = await ergogen.process(medium, {svg: false})
        result_no_svg.should.not.have.nested.property('outlines.export.svg')
    })

    it('colors', async function() {
        const at = shift => ({ref: 'matrix_col_row', shift})
        const rect = (color, operation, shift=[0, 0], size=[20, 10]) => ({what: 'rectangle', size, color, operation, adjust: {shift}})
        const circle = (color, operation, shift, radius=4) => ({what: 'circle', radius, color, operation, adjust: {shift}})
        const ref = (name, color) => ({what: 'outline', name, color})
        // red add, blue stack, uncolored subtract cutting through both
        const stacked = () => [rect('red'), rect('blue', 'stack', [20, 0], 10), circle(undefined, 'subtract', [12.5, 0])]
        // the same square, drawn in red and blue
        const twins = () => [rect('red', 'add', [0, 0], 10), rect('blue', 'stack', [0, 0], 10)]
        const config = {
            points: {zones: {matrix: {columns: {col: {}}, rows: {row: {}}}}, mirror: 50},
            outlines: {
                kept: [rect('red'), circle(undefined, 'subtract', [10, 0])],
                swapped: [rect('red'), circle('blue', 'subtract', [10, 0])],
                stacked: stacked(),
                recolored: [...stacked(), circle('green', 'add', [-10, 0])],
                inherited: [rect('red'), rect(undefined, 'stack', [15, 0], 10)],
                referenced: [ref('stacked'), circle(undefined, 'add', [0, 20], 2)],
                overridden: [ref('stacked', 'lime')],
                retained: [circle('navy', 'add', [0, 20], 2), ref('stacked')],
                scaled: [{...ref('stacked'), scale: 0.5}],
                // expansion makes a whole new outline in the chain color, fillets add arcs in it
                expanded: [...stacked(), {...rect(undefined, 'stack', [0, 20], 4), expand: 1}],
                filleted: [rect('red'), {...circle(undefined, 'subtract', [-10, 0], 2), fillet: 1}],
                curve: [{what: 'path', color: 'red', segments: [
                    {type: 'bezier', points: [at([0, 0]), at([10, 20]), at([20, -20]), at([30, 0])]}
                ]}],
                square: [rect('black', 'add', [0, 0], 10), rect('white', 'stack', [5, 0], 10)],
                twins: twins(),
                // stacked references keep their drawing, wherever they're placed
                placed: [{...ref('twins'), operation: 'stack', where: true, origin: {shift: [1, 2]}, scale: 2}],
                // but other operations, and later steps on stacks, use simplified geometry
                framed: [rect(undefined, 'add', [0, 0], [40, 30]), {...ref('twins'), operation: 'subtract'}],
                cut: [...twins(), circle(undefined, 'subtract', [5, 0], 2)],
                rounded: [rect('red', 'add', [0, 0], 10), {...rect('blue', 'stack', [0, 0], 10), fillet: 1}]
            },
            cases: {plate: ['stacked', 'square', 'twins', 'placed', 'framed', 'cut', 'rounded'].map((name, i) => ({name, extrude: i + 1}))},
            pcbs: {main: {outlines: ['recolored', 'curve', 'square', 'twins', 'placed', 'framed', 'rounded'].map(outline => ({outline}))}}
        }
        const source = JSON.stringify(config)
        const strip = (obj, key) => JSON.parse(JSON.stringify(obj, (k, v) => k == key ? undefined : v))
        const colored = await ergogen.process(config, {debug: true})
        const uncolored = await ergogen.process(strip(config, 'color'), {debug: true})
        const layers = name => {
            const counts = {}
            m.model.walk(colored.outlines[name].yaml, {onPath: wp => {
                const layer = wp.layer || 'default'
                counts[layer] = (counts[layer] || 0) + 1
            }})
            return counts
        }

        // an omitted color changes nothing, so the subtracted cut stays red...
        layers('kept').should.deep.equal({red: 6})
        // ...while an explicit one recolors the whole outline
        layers('swapped').should.deep.equal({blue: 6})
        // stacked parts keep their own color, and the cut takes the chain color, even through them
        layers('stacked').should.deep.equal({red: 7, blue: 5})
        // until an explicit boolean color recolors everything, stacked parts included
        layers('recolored').should.deep.equal({green: 14})
        // uncolored stacked parts take the chain color too, so they're merged with it
        layers('inherited').should.deep.equal({red: 5})
        // references keep their colors, without starting a chain in the outline using them...
        layers('referenced').should.deep.equal({red: 7, blue: 5, default: 1})
        layers('scaled').should.deep.equal({red: 7, blue: 5})
        // ...unless overridden, nor are they repainted by an existing chain
        layers('overridden').should.deep.equal({lime: 12})
        layers('retained').should.deep.equal({navy: 1, red: 7, blue: 5})
        // uncolored expansions and fillets keep the chain color
        Object.keys(layers('expanded')).should.deep.equal(['red'])
        Object.keys(layers('filleted')).should.deep.equal(['red'])

        // different colors are only simplified separately, so their overlaps all show in the drawings...
        layers('square').should.deep.equal({black: 4, white: 4})
        layers('twins').should.deep.equal({red: 4, blue: 4})
        layers('placed').should.deep.equal({red: 8, blue: 8})
        // ...but not in their geometry, used when subtracting or by stacks before later steps
        layers('framed').should.deep.equal({default: 4, red: 4})
        layers('cut').should.deep.equal({red: 6})
        layers('rounded').should.deep.equal({red: 8})
        m.model.findChains(colored.outlines.rounded.yaml).length.should.equal(1)

        // colors are only layers, so the geometry of outlines, cases and pcbs stays the same
        const overlapping = ['square', 'twins', 'placed']
        for (const name of Object.keys(config.outlines)) {
            if (overlapping.includes(name)) continue
            strip(colored.outlines[name].yaml, 'layer').should.deep.equal(uncolored.outlines[name].yaml)
        }
        colored.cases.should.deep.equal(uncolored.cases)
        colored.pcbs.should.deep.equal(uncolored.pcbs)
        // and the inputs are left untouched
        JSON.stringify(config).should.equal(source)

        // uniformly colored curves keep their native svg reconstruction
        const count = (str, regex) => (str.match(regex) || []).length
        count(colored.outlines.curve.svg, / C /g).should.equal(1)
        count(colored.outlines.curve.svg, / C /g).should.equal(count(uncolored.outlines.curve.svg, / C /g))
        colored.outlines.curve.svg.should.include('stroke="red"')

        // black is literal in svg, but ACI 7 in dxf, just like white
        colored.outlines.square.svg.should.include('stroke="black"')
        colored.outlines.square.svg.should.include('stroke="white"')
        colored.outlines.square.dxf.should.match(/LAYER\n2\nblack\n70\n0\n62\n7\n/)
        colored.outlines.square.dxf.should.match(/LAYER\n2\nwhite\n70\n0\n62\n7\n/)

        // layers coming from injected outlines are kept, unless a color overrides them
        ergogen.inject('outline', 'layered_test', (config, name, points, outlines, units) => [() => [
            {models: {inner: {layer: 'aqua', paths: {circle: new m.paths.Circle([0, 0], 5)}}}},
            {low: [-5, -5], high: [5, 5]}
        ], units])
        const layered = color => ergogen.process({
            points: config.points,
            outlines: {layered: [{what: 'layered_test', color}]}
        })
        const kept = await layered()
        kept.outlines.layered.dxf.should.match(/\naqua\n/)
        const overridden = await layered('red')
        overridden.outlines.layered.dxf.should.not.match(/\naqua\n/)

        // only the exact color names are valid, with no default for falsy values
        const invalid = color => ergogen.process({
            points: config.points,
            outlines: {wrong: [{what: 'circle', radius: 1, color}]}
        }).should.be.rejectedWith('outlines.wrong.0.color')
        return Promise.all(['', null, '#ff0000', 'Red', 'pink'].map(invalid))
    })
})