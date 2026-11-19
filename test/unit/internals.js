const m = require('makerjs')
const kicad5 = require('../../src/templates/kicad5')
const kicad8 = require('../../src/templates/kicad8')
const jszip = require('jszip')
const ergogen = require('../../src/ergogen')
const io = require('../../src/io')
const whats = require('../../src/outlines')._whats

describe('Internals', function() {

    it('pcb outline conversion with kicad5', function() {
        // warn on unknown path type
        sinon.stub(m.model, 'walk').callsFake(function(model, config) {
            config.onPath({pathContext: {type: 'nonexistent'}})
        })
        kicad5.convert_outline.bind(this).should.throw("Can't convert path type")
    })

    it('pcb outline conversion with kicad8', function() {
        // warn on unknown path type
        sinon.stub(m.model, 'walk').callsFake(function(model, config) {
            config.onPath({pathContext: {type: 'nonexistent'}})
        })
        kicad8.convert_outline.bind(this).should.throw("Can't convert path type")
    })

    it('injection', function() {
        // warn on unknown injection type
        ergogen.inject.bind(this, 'nonexistent', 'name', 'value').should.throw('Unknown injection type')
    })

    // a 10x10 square with its corner on the anchor point
    const square_outline = (config, name, points, outlines, units) => {
        return [() => [new m.models.Rectangle(10, 10), {low: [0, 0], high: [10, 10]}], units]
    }
    const outline_config = what => ({
        points: { zones: { matrix: { columns: { pos: { key: { x: 0, y: 0 } } } } } },
        outlines: { test: [ { what } ] }
    })
    const builtin_outlines = ['rectangle', 'circle', 'polygon', 'outline', 'path', 'hull', 'svg']
    const prototype_names = ['constructor', 'toString', '__proto__']

    it('should replace built-in outline types with injections', async function() {
        const registry_before = Object.keys(whats)
        const originals = {}
        for (const what of builtin_outlines) originals[what] = whats[what]
        const sized_rectangle = outline_config('rectangle')
        sized_rectangle.outlines.test[0].size = 10
        const svg_rectangle = outline_config('rectangle')
        svg_rectangle.outlines.test[0].accuracy = 0.001

        // the built-in rectangle rejects svg-only keys
        await ergogen.process(svg_rectangle).should.be.rejectedWith('Unexpected key "accuracy"')
        try {
            for (const what of builtin_outlines) {
                const first = sinon.spy(square_outline)
                const second = sinon.spy(square_outline)
                ergogen.inject('outline', what, first)
                ergogen.inject('outline', what, second)
                // the latest injection is used, without any built-in keys
                const result = await ergogen.process(outline_config(what))
                result.outlines.test.dxf.should.exist
                first.called.should.be.false
                second.calledOnce.should.be.true
            }
        } finally {
            for (const what of builtin_outlines) ergogen.inject('outline', what, originals[what])
        }

        // restoring the originals brings back the built-in behavior
        Object.keys(whats).should.deep.equal(registry_before)
        await ergogen.process(svg_rectangle).should.be.rejectedWith('Unexpected key "accuracy"')
        const result = await ergogen.process(sized_rectangle)
        result.outlines.test.dxf.should.exist
    })

    it('should dispatch prototype-named outline injections as own entries', async function() {
        const registry_before = Object.keys(whats)
        // not injected yet, so nothing is inherited from Object.prototype
        for (const what of prototype_names) {
            await ergogen.process(outline_config(what)).should.be.rejectedWith('should be one of')
        }
        const factories = {}
        try {
            for (const what of prototype_names) {
                factories[what] = sinon.spy(square_outline)
                ergogen.inject('outline', what, factories[what])
            }
            for (const what of prototype_names) {
                const result = await ergogen.process(outline_config(what))
                result.outlines.test.dxf.should.exist
                factories[what].calledOnce.should.be.true
            }
        } finally {
            for (const what of prototype_names) delete whats[what]
        }
        Object.keys(whats).should.deep.equal(registry_before)
    })

    it('should replace library outlines with later injections', async function() {
        const original = whats.choc_hotswap_socket
        const replacement = sinon.spy(square_outline)
        try {
            ergogen.inject('outline', 'choc_hotswap_socket', replacement)
            const result = await ergogen.process(outline_config('choc_hotswap_socket'))
            result.outlines.test.dxf.should.exist
            replacement.calledOnce.should.be.true
        } finally {
            ergogen.inject('outline', 'choc_hotswap_socket', original)
        }
        whats.choc_hotswap_socket.should.equal(original)
    })

    it('should inject bundled outlines with prototype and built-in names', async function() {
        const registry_before = Object.keys(whats)
        const original_rectangle = whats.rectangle
        const zip = new jszip()
        zip.file('config.yaml', [
            'points.zones.matrix.columns.pos.key: {x: 0, y: 0}',
            'outlines.js_test: [{what: constructor}]',
            'outlines.svg_test: [{what: __proto__}]',
            // the built-in rectangle would reject the svg-only "accuracy" key
            'outlines.builtin_test: [{what: rectangle, accuracy: 0.001}]'
        ].join('\n'))
        zip.file('outlines/constructor.js', 'const m = require("makerjs")\nmodule.exports = (config, name, points, outlines, units) => [() => [new m.models.Rectangle(10, 10), {low: [0, 0], high: [10, 10]}], units]')
        zip.file('outlines/__proto__.svg', '<svg><path d="M 0 0 L 10 0 L 10 10 L 0 10 Z" /></svg>')
        zip.file('outlines/rectangle.svg', '<svg><path d="M 0 0 L 10 0 L 10 10 Z" /></svg>')
        const [config_text, injections] = await io.unpack(zip)
        try {
            for (const [type, name, value] of injections) ergogen.inject(type, name, value)
            const result = await ergogen.process(config_text)
            result.outlines.js_test.dxf.should.exist
            result.outlines.svg_test.dxf.should.exist
            result.outlines.builtin_test.dxf.should.exist
        } finally {
            for (const what of prototype_names) delete whats[what]
            ergogen.inject('outline', 'rectangle', original_rectangle)
        }
        Object.keys(whats).should.deep.equal(registry_before)
    })

    it('should overwrite existing injections on duplicate register calls', async function() {
        const first_footprint = {
            params: {},
            body: () => 'first-footprint-body'
        }
        const second_footprint = {
            params: {},
            body: () => 'second-footprint-body'
        }
        ergogen.inject('footprint', 'overwrite_footprint', first_footprint)
        ergogen.inject('footprint', 'overwrite_footprint', second_footprint)

        const config = {
            points: { zones: { matrix: { columns: { pos: { key: { x: 0, y: 0 } } } } } },
            outlines: {
                box: [
                    { what: 'rectangle', size: 20 }
                ]
            },
            pcbs: {
                board: {
                    outlines: { board: { outline: 'box' } },
                    footprints: [
                        { what: 'overwrite_footprint', where: true }
                    ]
                }
            }
        }

        const result = await ergogen.process(config)
        result.pcbs.board.should.contain('second-footprint-body')
        result.pcbs.board.should.not.contain('first-footprint-body')
    })
})



