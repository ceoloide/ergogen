const p = require('../../src/prepare')
const u = require('../../src/utils')

describe('Concat', function() {
    it('should concatenate references and literals', function() {
        const config = {
            meta: {
                name: 'ThinkCorney',
                version: 'v1-b1',
                name_full: '$concat(meta.name, "-", meta.version)'
            }
        }
        // We need to unnest first so that meta.name works
        const unnested = p.unnest(config)
        const result = p.concat(unnested)
        result.meta.name_full.should.equal('ThinkCorney-v1-b1')
    })

    it('should handle multiple references and literals', function() {
        const config = {
            a: 'foo',
            b: 'bar',
            c: 'baz',
            res: '$concat(a, " and ", b, " and ", c)'
        }
        p.concat(config).res.should.equal('foo and bar and baz')
    })

    it('should handle nested concats', function() {
        const config = {
            a: 'foo',
            b: 'bar',
            res: '$concat(a, $concat("-", b))'
        }
        p.concat(config).res.should.equal('foo-bar')
    })

    it('should handle references to non-string values', function() {
        const config = {
            name: 'engine',
            version: 4.0,
            res: '$concat(name, ": ", version)'
        }
        p.concat(config).res.should.equal('engine: 4')
    })
})
