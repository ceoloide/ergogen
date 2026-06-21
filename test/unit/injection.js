const ergogen = require('../../src/ergogen')
const m = require('makerjs')

describe('Injection', function() {
    it('should allow injecting outlines', function() {
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

        return ergogen.process(config).then(result => {
            result.outlines.test.should.exist
        })
    })
})
