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

    it('should throw on circular dependencies', function() {
        const config = {
            a: '$concat(b)',
            b: '$concat(a)'
        }
        p.concat.bind(this, config).should.throw('Circular dependency')
    })

    it('should throw on unresolved references', function() {
        const config = {
            res: '$concat(nonexistent)'
        }
        p.concat.bind(this, config).should.throw('Could not resolve reference')
    })

    it('should handle mixed quotes and escaped quotes in literals', function() {
        const config = {
            res: '$concat("double", \'single\', "contains \\"quotes\\"")'
        }
        p.concat(config).res.should.equal('doublesinglecontains "quotes"')
    })

    it('should handle nested quotes of different types', function() {
        const config = {
            res: '$concat("it\'s a test", \'he said "hello"\')'
        }
        p.concat(config).res.should.equal('it\'s a testhe said "hello"')
    })

    it('should handle empty or whitespace-only arguments', function() {
        const config = {
            empty: '$concat()',
            whitespace: '$concat( )',
            mixed: '$concat(a, , b)',
            a: 'foo',
            b: 'bar'
        }
        const res = p.concat(config)
        res.empty.should.equal('')
        res.whitespace.should.equal('')
        res.mixed.should.equal('foobar')
    })
})
