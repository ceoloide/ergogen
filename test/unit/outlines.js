const crypto = require('crypto')
const m = require('makerjs')
const ergogen = require('../../src/ergogen')
const lineends = require('../helpers/fixture').lineends

describe('Outline geometry', function() {

    const round = val => Number(val.toFixed(3)) + 0 // also turns -0 into 0
    // the extents and the number of chains describe a shape, and the digest of its dxf pins down every detail
    // (which stands in for a full reference file, so update it like one, after looking at the new dxf)
    const measure = outline => {
        const {low, high} = m.measure.modelExtents(outline.yaml)
        const digest = crypto.createHash('sha256').update(outline.dxf.replace(lineends, '\n')).digest('hex').slice(0, 12)
        return [low.map(round), high.map(round), m.model.findChains(outline.yaml).length, digest]
    }
    const measured = async (parts, config={}) => {
        const outlines = Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, [{where: true, ...part}]]))
        const results = await ergogen.process({points: {zones: {matrix: null}}, ...config, outlines}, {debug: true})
        return Object.fromEntries(Object.entries(results.outlines).map(([name, outline]) => [name, measure(outline)]))
    }

    it('built-in shapes', async function() {
        // each outline matches the built-in footprint of the same name, seen from the top
        // (the logo is a decoration without a footprint, and details like the rotary knob stay separate chains)
        const expected = {
            ergogen_logo: [[-7.5, -4.529], [7.5, 4.529], 3, '3652642f2e77'],
            jstph: [[-2.95, -6.25], [2.95, 1.35], 6, 'e069054a114e'],
            oled: [[-34.8, -11.99], [3.2, 0.01], 6, 'e329e22044e0'],
            promicro: [[-19.304, -8.89], [15.24, 8.89], 26, '163021a80477'],
            rgb: [[-2.5, -2.5], [2.5, 2.5], 2, '6d0df9615ba8'],
            rotary: [[-8.62, -8.46], [8.38, 8.54], 3, 'c7b338f3a093'],
            scrollwheel: [[-8.4, -7.6], [9.8, 6.6], 9, 'd061ebbe853b'],
            trrs: [[-5.35, -12.1], [0.75, 2], 8, 'b67aff9d7422'],
        }
        const parts = Object.fromEntries(Object.keys(expected).map(what => [what, {what}]))
        ;(await measured(parts)).should.deep.equal(expected)
    })

    it('hotswap sockets', async function() {
        const sockets = await measured({
            mx: {what: 'mx_hotswap_socket'},
            expression: {what: 'choc_hotswap_socket', origin: ['u/2', 'u']},
            literal: {what: 'choc_hotswap_socket', origin: [9.525, 19.05]},
        }, {units: {u: 19.05}, points: {zones: {matrix: null}, mirror: {distance: 40}}})
        // the mx socket is north of the key center, and mirrored on the mirrored half
        sockets.mx.should.deep.equal([[-8.36, 0.8], [48.36, 6.8], 2, '612cf70d97de'])
        // the origin of the choc socket takes units and expressions
        sockets.expression.should.deep.equal([[-19.125, -27.25], [59.125, -20.55], 2, 'b1fe8c47da5b'])
        sockets.literal.should.deep.equal(sockets.expression)
    })

    it('asym clone filters', async function() {
        // two distinguishable keys on the source half (around x=0), mirrored around x=75
        const points = {zones: {matrix: {columns: {c1: {key: {shift: [-10, 10], rotate: 45}}, c2: null}}}, mirror: {distance: 150}}
        const rectangle = where => ({what: 'rectangle', where, asym: 'clone', size: 18})
        const clones = await measured({
            // an explicit list of source points, cloned to the other half
            list: rectangle(['matrix_c1', 'matrix_c2']),
            // filters that match both halves should only yield the mirrored half, too
            regex: rectangle('/matrix/'),
            all: rectangle(true),
        }, {points})
        clones.list.should.deep.equal([[122, -9], [172.728, 22.728], 2, '732072edc2a8'])
        clones.regex.should.deep.equal(clones.list)
        clones.all.should.deep.equal(clones.list)
    })
})