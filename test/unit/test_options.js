const options = require('../helpers/options')

describe('Test options', function() {

    it('selects tests by argument or npm config', function() {
        const env = {npm_config_what: 'assert,cli/minimal'}
        options.parse([], env).what.should.deep.equal(['assert', 'cli/minimal'])
        options.parse(['--what', 'points'], env).what.should.deep.equal(['points'])
        options.parse(['--what=outlines/hull'], env).what.should.deep.equal(['outlines/hull'])
    })

    it('rewrites references only when requested', function() {
        for (const value of ['', 'false', '0']) {
            options.parse([`--dump=${value}`], {npm_config_dump: 'true'}).dump.should.be.false
            options.parse([], {npm_config_dump: value}).dump.should.be.false
        }
        options.parse([], {}).dump.should.be.false
        options.parse(['--dump'], {}).dump.should.be.true
        options.parse(['--dump', 'true'], {}).dump.should.be.true
        options.parse([], {npm_config_dump: '1'}).dump.should.be.true
        options.parse.bind(this, ['--dump=typo'], {}).should.throw('--dump')
    })
})
