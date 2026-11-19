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
        // a single part is placed everywhere by default, while a list of parts is taken as it is
        const outlines = Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, Array.isArray(part) ? part : [{where: true, ...part}]]))
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

    it('trigonometry solvers', async function() {
        const units = {base: 60, left: 45, right: 35, notch: 30, pitch: 21, radius: 80, step: 'triangle_sss(pitch, radius, radius)'}
        // thumb keys 21mm apart on an 80mm radius, so that neighbouring key centers are exactly one pitch apart
        const thumb = {
            anchor: {shift: [0, -40]},
            key: {spread: 0, origin: [0, '-radius']},
            columns: {inner: null, home: {key: {splay: '-step'}}, outer: {key: {splay: '-step'}}}
        }
        const solved = await measured({
            // a triangle with all three sides known, mirrored to the other half
            // (it turns back along the base, then opens up by the angle opposite the left side)
            gusset: {what: 'polygon', where: 'matrix', asym: 'both', points: [
                {shift: [0, 0]}, {shift: ['base', 0]}, {orient: '180 - triangle_sss(left, right, base)', shift: ['right', 0]}
            ]},
            // an isosceles notch with 75 degree base angles
            notch: {what: 'polygon', where: 'matrix', points: [
                {shift: [0, 0]}, {shift: ['notch', 0]}, {orient: 105, shift: ['triangle_asa(75, notch, 75)', 0]}
            ]},
            thumb: {what: 'rectangle', where: '/thumb/', size: 18},
        }, {units, points: {zones: {matrix: null, thumb}, mirror: {distance: 200}}})
        solved.should.deep.equal({
            gusset: [[0, 0], [200, 26.087], 2, 'a28c735b04f0'],
            notch: [[0, 0], [30, 55.981], 1, 'd3b9f692f035'],
            thumb: [[-9, -63.139], [209, -31], 6, '21210378db94'],
        })
    })

    it('svg placement', async function() {
        const reference = {what: 'outline', name: 'reference', operation: 'stack'}
        const corner = 'M 0 0 L 0 -2.5 L -2.5 -2.5 L -2.5 0 Z'
        const wedge = 'M 0 0 L 0 -2.5 L -2.5 -2.5 L -2.5 5 Z'
        const placed = await measured({
            reference: {what: 'rectangle', size: 20},
            // several paths on the source half only
            multiple: [{what: 'svg', where: 'matrix', paths: [corner, 'M 5 5 L 10 5 L 10 10 L 5 10 Z']}, reference],
            // an asymmetric path is mirrored on the mirrored half
            mirror: [{what: 'svg', where: true, paths: wedge}, reference],
            // flipped both ways around an offset origin, then placed on both halves
            flip: [{what: 'svg', where: true, flip_vertically: true, flip_horizontally: true, origin: [-10, -10], paths: wedge}, reference],
        }, {points: {zones: {matrix: null}, mirror: {distance: 40}}})
        delete placed.reference
        placed.should.deep.equal({
            multiple: [[-10, -10], [50, 10], 4, '98188dbf77b2'],
            mirror: [[-10, -10], [50, 10], 4, '1d8d6bccceed'],
            flip: [[-10, -12.5], [50, 10], 2, '262bc8c5b9f1'],
        })
    })
})