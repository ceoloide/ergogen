const fs = require('fs')
const path = require('path')
const m = require('makerjs')
const yaml = require('js-yaml')
const jszip = require('jszip')
const svg_lib = require('../../src/svg')
const io = require('../../src/io')
const ergogen = require('../../src/ergogen')

describe('SVG', function() {

    this.timeout(120000)

    const ns = 'xmlns="http://www.w3.org/2000/svg"'
    const square = 'M 0 0 L 10 0 L 10 10 L 0 10 Z'
    const far_square = 'M 100 0 L 110 0 L 110 10 L 100 10 Z'
    const doc = (body, attributes=ns) => `<svg ${attributes}>${body}</svg>`
    const fixture_svg = path.join(__dirname, '..', 'fixtures', 'bundle', 'outlines', 'outline_injected_svg.svg')

    const round = val => Number(val.toFixed(6)) + 0 // also turns -0 into 0
    const measure = model => {
        const {low, high} = m.measure.modelExtents(model)
        return {low: low.map(round), high: high.map(round), chains: m.model.findChains(model).length}
    }
    const unit_square = {low: [0, -10], high: [10, 0], chains: 1}

    // a real zip bundle, loaded the way the cli loads bundles
    const via_bundle = async (text, part={}) => {
        const name = 'svg_bundle_test'
        const zip = new jszip()
        zip.file('config.yaml', yaml.dump({
            points: {zones: {matrix: null}},
            outlines: {o: [{what: name, where: true, ...part}]}
        }))
        zip.file(`outlines/${name}.svg`, text)
        const loaded = await jszip.loadAsync(await zip.generateAsync({type: 'nodebuffer'}))
        const [config_text, injections] = await io.unpack(loaded)
        for (const [type, injection_name, value] of injections) {
            ergogen.inject(type, injection_name, value)
        }
        const results = await ergogen.process(config_text, {debug: true})
        return measure(results.outlines.o.yaml)
    }

    const accepted = {
        'plain path without viewBox': [doc(`<path d="${square}"/>`), unit_square],
        'existing fixture': [fs.readFileSync(fixture_svg).toString(), {low: [0, -6.7], high: [14.2, 0], chains: 1}],
        'commented path': [doc(`<path d="${square}"/><!-- <path d="${far_square}"/> -->`), unit_square],
        'unreferenced definitions': [doc(`<defs><path d="${far_square}"/><rect width="5" height="5"/></defs>` +
            `<clipPath id="c"><path d="${far_square}"/><circle r="5"/></clipPath><path d="${square}"/>`), unit_square],
        'spaced attributes and both quotes': [doc(`<path id = 'a' d = "${square}" /><path d\n=\n'${far_square}'></path>`), {low: [0, -10], high: [110, 0], chains: 2}],
        'entities': [doc(`<path id="&lt;&amp;&gt;&quot;&apos;" d="M&#32;0 0 L 10 0 L&#x20;10 10 L 0 10 Z"/>`), unit_square],
        'path effects and foreign elements': [doc(`<defs><inkscape:path-effect d="${far_square}"/></defs>` +
            `<sodipodi:namedview><inkscape:page d="${far_square}"/></sodipodi:namedview>` +
            `<g><path inkscape:original-d="${far_square}" d="${square}"/></g>`,
            `${ns} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"`), unit_square],
        'svg prefix': [`<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:g><s:path d="${square}"/></s:g></s:svg>`, unit_square],
        'prolog and descriptions': [`﻿<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n` +
            doc(`<title>t</title><desc>d</desc><metadata><rect/></metadata><style><![CDATA[path { fill: red }]]></style>` +
            `<path style="fill:none;;stroke:red" transform="" clip-path="none" d="${square}"/>`) + '\n', unit_square],
        'millimetre dimensions without viewBox do not rescale': [doc(`<path d="${square}"/>`, `${ns} width="20mm" height="5"`), unit_square],
        'matching viewBox': [doc(`<path d="${square}"/>`, `${ns} x="0" y="0" width="14.2mm" height=" 6.7 " viewBox="0,0,14.2,6.7"`), unit_square],
        'viewBox roundoff': [doc(`<path d="${square}"/>`, `${ns} width="37.795mm" viewBox="0 0 37.7953 10"`), unit_square],
        'no paths': [doc('<g/>'), 'must have at least one path'],
    }

    const rejected = {
        'malformed markup': [doc(`<path d="${square}"id="x"/>`), 'malformed markup at offset'],
        'unclosed element': [`<svg ${ns}><g>`, 'unclosed elements'],
        'mismatched element': [doc('<g></a>'), 'unexpected closing tag'],
        'stray closing tag': ['</svg>', 'unexpected closing tag'],
        'malformed closing tag': [doc('<g></ g>'), 'unexpected closing tag'],
        'unknown entity': [doc(`<path d="${square}&nbsp;"/>`), 'unknown entity "&nbsp;"'],
        'bare ampersand': [doc(`<path id="a & b" d="${square}"/>`), 'malformed entity "&"'],
        'unterminated entity': [doc(`<path id="&amp" d="${square}"/>`), 'malformed entity "&amp"'],
        'invalid character reference': [doc(`<path id="&#x110000;" d="${square}"/>`), 'invalid character reference'],
        'repeated attribute': [doc(`<path d="${square}" d="${far_square}"/>`), 'repeats the attribute "d"'],
        'empty document': ['', 'does not contain an <svg> element'],
        'other root': ['<html/>', 'should have an <svg> root element'],
        'foreign root': ['<svg xmlns="urn:other"/>', 'should have an <svg> root element'],
        'two roots': [doc('') + doc(''), 'more than one root element'],
        'text outside root': [doc('') + 'text', 'text outside of its root element'],
        'unterminated comment': [doc('<!-- '), 'unterminated comment'],
        'misplaced cdata': ['<![CDATA[x]]>' + doc(''), 'misplaced or unterminated CDATA'],
        'unterminated cdata': [doc('<![CDATA[x'), 'misplaced or unterminated CDATA'],
        'unterminated instruction': ['<?xml ' + doc(''), 'unterminated processing instruction'],
        'doctype declarations': ['<!DOCTYPE svg [<!ENTITY e "M 0 0">]>' + doc(''), 'DOCTYPE'],
        'undeclared prefix': [doc('<x:g/>'), 'undeclared namespace prefix "x"'],
        'unsupported element': [doc(`<switch><path d="${square}"/></switch>`), 'unsupported element <switch>'],
        'unprefixed path effect': [doc(`<path-effect d="${square}"/>`), 'unsupported element <path-effect>'],
        'path without data': [doc('<path/>'), 'without "d" data at index 0'],
        'nested viewport': [doc(`<svg><path d="${square}"/></svg>`), 'nested <svg> viewport'],
        'path transform': [doc(`<path transform="translate(5 0)" d="${square}"/>`), 'transform on <path> affecting path 0'],
        'group scale': [doc(`<g transform="scale(2)"><path d="${square}"/></g>`), 'transform on <g> affecting path 0'],
        'nested ancestor transform': [doc(`<path d="${square}"/><g transform="rotate(5)"><g><path d="${square}"/></g></g>`), 'transform on <g> affecting path 1'],
        'root transform': [doc(`<path d="${square}"/>`, `${ns} transform="scale(2)"`), 'transform on <svg> affecting path 0'],
        'css transform': [doc(`<a style="transform: translate(5px)"><path d="${square}"/></a>`), 'transform on <a> affecting path 0'],
        'clipping': [doc(`<defs><clipPath id="c"><rect/></clipPath></defs><g clip-path="url(#c)"><path d="${square}"/></g>`), 'uses "clip-path" on <g>'],
        'masking': [doc(`<path style="Mask: url(#m)" d="${square}"/>`), 'uses "mask" on <path>'],
        'width in inches': [doc(`<path d="${square}"/>`, `${ns} width="10in"`), 'Field "width" of SVG outline'],
        'percentage height': [doc(`<path d="${square}"/>`, `${ns} height="100%"`), 'Field "height" of SVG outline'],
        'zero width': [doc(`<path d="${square}"/>`, `${ns} width="0mm"`), 'positive length in mm'],
        'infinite width': [doc(`<path d="${square}"/>`, `${ns} width="1e999"`), 'positive length in mm'],
        'scaled viewBox': [doc(`<path d="${square}"/>`, `${ns} width="10mm" height="10mm" viewBox="0 0 37.795 37.795"`), 'scaled viewBoxes are not supported'],
        'offset viewBox': [doc(`<path d="${square}"/>`, `${ns} viewBox="100 100 10 10"`), 'should start at "0 0"'],
        'offset viewport': [doc(`<path d="${square}"/>`, `${ns} x="5"`), 'Field "x" of SVG outline'],
        'malformed viewport': [doc(`<path d="${square}"/>`, `${ns} y="a"`), 'Field "y" of SVG outline'],
        'short viewBox': [doc(`<path d="${square}"/>`, `${ns} viewBox="0 0 10"`), 'four finite numbers'],
        'nonnumeric viewBox': [doc(`<path d="${square}"/>`, `${ns} viewBox="0 0 10 x"`), 'four finite numbers'],
        'infinite viewBox': [doc(`<path d="${square}"/>`, `${ns} viewBox="0 0 1e999 10"`), 'four finite numbers'],
        'empty viewBox': [doc(`<path d="${square}"/>`, `${ns} viewBox="0 0 0 10"`), 'positive width and height'],
        'misplaced doctype': [doc('') + '<!DOCTYPE svg>', 'misplaced DOCTYPE'],
    }
    for (const shape of ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use']) {
        rejected[`visible ${shape}`] = [doc(`<path d="${square}"/><g><${shape}/></g>`), `contains a visible <${shape}>, but only paths are supported! Convert objects to paths`]
    }

    it('extract', function() {
        // multiple paths, in document order, with their data decoded
        svg_lib.extract(doc(`<path d='${square}'/><g><path d="M&#x20;1 1"/></g>`), 'n').should.deep.equal([square, 'M 1 1'])
        // non-text input
        svg_lib.extract.bind(this, undefined, 'n').should.throw('SVG outline "n" should be text')
        // errors name the outline
        svg_lib.extract.bind(this, doc('<rect/>'), 'named').should.throw('SVG outline "named" contains a visible <rect>')
        svg_lib.tolerance.should.equal(1e-4)
    })

    const runners = {'bundle loading': via_bundle}
    const scope = {'bundle loading': 'svg_bundle_test'}
    for (const [runner_name, run] of Object.entries(runners)) {
        describe(runner_name, function() {
            for (const [title, [text, expected]] of Object.entries(accepted)) {
                it(title, async function() {
                    if (typeof expected == 'string') {
                        await run(text).should.be.rejectedWith(expected)
                    } else {
                        (await run(text)).should.deep.equal(expected)
                    }
                })
            }
            for (const [title, [text, expected]] of Object.entries(rejected)) {
                it(title, async function() {
                    await run(text).should.be.rejectedWith(`SVG outline "${scope[runner_name]}"`)
                    await run(text).should.be.rejectedWith(expected)
                })
            }
        })
    }

    it('ergogen export reimport', async function() {
        const config = {
            points: {zones: {matrix: null}},
            outlines: {o: [
                {what: 'circle', radius: 5, where: true},
                {what: 'rectangle', size: [30, 4], where: true},
                {what: 'circle', radius: 1, where: true, adjust: {shift: [-10, 5]}},
            ]}
        }
        const results = await ergogen.process(config, {debug: true})
        const original = measure(results.outlines.o.yaml)
        original.chains.should.equal(2)
        // exports are positioned at the origin and rounded to 3 decimals, so compare sizes to 0.01mm
        const size = ({low, high, chains}) => ({size: [0, 1].map(i => Number((high[i] - low[i]).toFixed(2))), chains})
        size(await via_bundle(results.outlines.o.svg)).should.deep.equal(size(original))
    })
})