const m = require('makerjs')
const kicad5 = require('../../src/templates/kicad5')
const kicad8 = require('../../src/templates/kicad8')
const ergogen = require('../../src/ergogen')

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
})




const io = require('../../src/io')

describe('IO', function() {
    it('should unpack outlines from zip', async function() {
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
                                async: () => Promise.resolve('<svg><path d="M 0 0 L 10 0 L 10 10 Z" /></svg>')
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

        // Verify the injected function works
        const shapeMaker = injections[0][2]
        const [maker, units] = shapeMaker({}, 'test', {}, {}, {})
        const [shape, bbox] = maker({ meta: {} })

        shape.paths.should.not.be.empty
    })
})
