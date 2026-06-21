const m = require('makerjs')
const fs = require('fs-extra')
const path = require('path')
const {fixture} = require('../helpers/fixture')

const dump = process.env.npm_config_dump

describe('MakerJS', function() {

    const check = (actual, name) => {
        const ref_path = path.join(__dirname, '../fixtures', name)
        if (dump) {
            fs.writeFileSync(ref_path, actual)
        } else {
            const ref = fixture(name)
            actual.should.equal(ref)
        }
    }

    it('disappearance', function() {
        // test combination disappearance, as per https://github.com/microsoft/maker.js/issues/465
        const disappear = fixture('makerjs/bug_465_disappear.json')
        const combined = m.model.combineUnion(disappear.models.a, disappear.models.b)
        check(m.exporter.toDXF(combined), 'makerjs/bug_465_disappear_good.dxf')
    })

    it('weird combination', function() {
        // test second weird combination, again in https://github.com/microsoft/maker.js/issues/465
        // this isn't fixed by default yet, needs custom farPoint to work properly
        const base = new m.models.RoundRectangle(10, 10, 1)
        const a = m.model.move(new m.models.Rectangle(10, 10), [5, 5])
        const b = m.model.move(new m.models.Rectangle(10, 10), [5, -5])
        const base_plus_a = m.model.combineUnion(base, a)
        
        const {farPoint, deepcopy} = require('../../src/utils')

        const bad = m.model.combineUnion(deepcopy(base_plus_a), deepcopy(b))
        check(m.exporter.toDXF(bad), 'makerjs/bug_465_weird_bad.dxf')
        
        const good = m.model.combine(deepcopy(base_plus_a), deepcopy(b), false, true, false, true, {farPoint})
        check(m.exporter.toDXF(good), 'makerjs/bug_465_weird_good.dxf')
    })
})
