const m = require('makerjs')
const kicad5 = require('../../src/templates/kicad5')
const kicad8 = require('../../src/templates/kicad8')
const ergogen = require('../../src/ergogen')
const io = require('../../src/io')

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

    it('injection', async function() {
        // warn on unknown injection type
        ergogen.inject.bind(this, 'nonexistent', 'name', 'value').should.throw('Unknown injection type')

        // should allow injecting outlines
        const injected = (config, name, points, outlines, units) => {
            return [() => {
                const shape = new m.models.Rectangle(10, 10)
                const bbox = m.measure.modelExtents(shape)
                return [shape, {low: bbox.low, high: bbox.high}]
            }, units]
        }
        ergogen.inject('outline', 'my_injected', injected)

        const config = {
            points: {
                zones: {
                    matrix: {
                        columns: {
                            pos: {
                                key: { x: 0, y: 0 }
                            }
                        }
                    }
                }
            },
            outlines: {
                test: [
                    { what: 'my_injected' }
                ]
            }
        }

        const result = await ergogen.process(config)
        result.outlines.test.should.exist
    })
})

describe('IO', function() {
    it('should unpack outlines from zip with multiple paths and mirroring', async function() {
        const mockZip = {
            file: function(regex) {
                if (regex.toString().includes('config')) {
                    return [{ async: () => Promise.resolve('points: { zones: { matrix: { columns: { pos: { key: { x: 0, y: 0 } } } } } }') }]
                }
                return []
            },
            folder: function(name) {
                if (name === 'outlines') {
                    return {
                        file: function(regex) {
                            return [{
                                name: 'outlines/test.svg',
                                async: () => Promise.resolve('<svg><path d="M 0 0 L 10 0 L 10 10 Z" /><path d="M 20 20 L 30 20 L 30 30 Z" /></svg>')
                            }]
                        }
                    }
                }
                return { file: () => [] }
            }
        }

        const [config, injections] = await io.unpack(mockZip)
        injections.should.have.lengthOf(1)
        injections[0][0].should.equal('outline')
        injections[0][1].should.equal('test')

        // Verify the injected function works with multiple paths
        const shapeMaker = injections[0][2]
        const [maker, units] = shapeMaker({}, 'test', {}, {}, {})

        // Test non-mirrored
        const [shape, bbox] = maker({ meta: { mirrored: false } })
        shape.should.exist

        // Test mirrored (covers io.js:81)
        const [mirroredShape, mirroredBbox] = maker({ meta: { mirrored: true } })
        mirroredShape.should.exist
    })
})
