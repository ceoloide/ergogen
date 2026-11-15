const a = require('./assert')

// path extraction for SVG outlines, shared by bundle loading (io.js) and the rollup build
//
// only a path-data subset of SVG is supported, without any rendering:
//  - the "d" data of every rendered <path> becomes an outline path, in millimetres
//  - without a viewBox, one path unit is 1mm, and width/height never rescale paths
//  - width/height must be positive, either unitless or in mm
//  - a viewBox must start at 0 0, and must match width/height (if present) up to `tolerance`
//  - comments, foreign (e.g. inkscape) elements and unreferenced defs/clipPath/etc. are ignored
//  - other visible geometry, transforms, clipping, masking and nested viewports are rejected
//  - css (style elements, display, visibility, stroke, fill) never selects or expands paths

const svg_namespace = 'http://www.w3.org/2000/svg'

// relative difference allowed between root width/height and the viewBox, for decimal roundoff
const tolerance = exports.tolerance = 1e-4

// visible geometry that is not path data, and that would otherwise silently go missing
const shapes = ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use']
// containers that are only rendered when referenced
const definitions = ['defs', 'clipPath', 'mask', 'pattern', 'marker', 'symbol', 'linearGradient', 'radialGradient', 'filter']
// elements without geometry
const descriptions = ['title', 'desc', 'metadata', 'style', 'script']
const containers = ['g', 'a']

const xml_name = '[A-Za-z_][\\w.\\-]*(?::[A-Za-z_][\\w.\\-]*)?'
const attribute_regex = new RegExp(`(${xml_name})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'g')
const start_tag_regex = new RegExp(`<(${xml_name})((?:\\s+${xml_name}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(\\/?)>`, 'y')
const end_tag_regex = new RegExp(`<\\/(${xml_name})\\s*>`, 'y')
const doctype_regex = /<!DOCTYPE[^<>\[\]]*>/y
const number_regex = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const length_regex = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(mm)?\s*$/

const entities = {lt: '<', gt: '>', amp: '&', quot: '"', apos: '\''}

const decode = (raw, name) => raw.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z]+))?;?/g, (match, hex, dec, entity) => {
    a.assert(match.length > 1 && match.endsWith(';'), `SVG outline "${name}" contains a malformed entity "${match}"!`)
    if (entity !== undefined) {
        a.assert(entities[entity] !== undefined, `SVG outline "${name}" contains an unknown entity "${match}"!`)
        return entities[entity]
    }
    const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10)
    a.assert(code <= 0x10FFFF, `SVG outline "${name}" contains an invalid character reference "${match}"!`)
    return String.fromCodePoint(code)
})

const parse_attributes = (raw, name) => {
    const attributes = {}
    for (const [, key, double, single] of raw.matchAll(attribute_regex)) {
        a.assert(attributes[key] === undefined, `SVG outline "${name}" repeats the attribute "${key}" on an element!`)
        attributes[key] = decode(double !== undefined ? double : single, name)
    }
    return attributes
}

// css properties set through an inline style attribute
const style_properties = style => {
    const properties = {}
    for (const declaration of (style || '').split(';')) {
        const colon = declaration.indexOf(':')
        if (colon == -1) continue
        properties[declaration.slice(0, colon).trim().toLowerCase()] = declaration.slice(colon + 1).trim()
    }
    return properties
}

const active = value => value !== undefined && value.trim() !== '' && value.trim() != 'none'

const positive_length = (raw, field, name) => {
    const match = length_regex.exec(raw)
    const value = match ? parseFloat(match[1]) : NaN
    a.assert(Number.isFinite(value) && value > 0, `Field "${field}" of SVG outline "${name}" should be a positive length in mm (or unitless mm), not "${raw}"! ` +
        'Export the SVG in millimetres so that one path unit is 1mm.')
    return value
}

const check_root = (attributes, name) => {
    for (const field of ['x', 'y']) {
        if (attributes[field] === undefined) continue
        a.assert(number_regex.test(attributes[field].trim()) && parseFloat(attributes[field]) === 0,
            `Field "${field}" of SVG outline "${name}" should be 0, offset root viewports are not supported!`)
    }
    const dimensions = {}
    for (const field of ['width', 'height']) {
        if (attributes[field] === undefined) continue
        dimensions[field] = positive_length(attributes[field], field, name)
    }
    if (attributes.viewBox === undefined) return
    const raw = attributes.viewBox
    const parts = raw.trim().split(/\s*,\s*|\s+/)
    a.assert(parts.length == 4 && parts.every(part => number_regex.test(part)) && parts.map(parseFloat).every(Number.isFinite),
        `Field "viewBox" of SVG outline "${name}" should be four finite numbers, not "${raw}"!`)
    const [min_x, min_y, width, height] = parts.map(parseFloat)
    a.assert(min_x === 0 && min_y === 0, `Field "viewBox" of SVG outline "${name}" should start at "0 0", not "${raw}"! ` +
        'Move the drawing to the origin of the page before exporting.')
    a.assert(width > 0 && height > 0, `Field "viewBox" of SVG outline "${name}" should have a positive width and height, not "${raw}"!`)
    for (const [field, extent] of Object.entries({width, height})) {
        if (dimensions[field] === undefined) continue
        const difference = Math.abs(dimensions[field] - extent) / Math.max(dimensions[field], extent)
        a.assert(difference <= tolerance, `Field "${field}" of SVG outline "${name}" (${attributes[field]}) does not match the viewBox ${field} (${extent}), ` +
            'scaled viewBoxes are not supported! Make one user unit equal 1mm before exporting.')
    }
}

// the namespace of an element name (`undefined` means an unprefixed name without a default namespace)
const namespace_of = (qname, namespaces, name) => {
    const colon = qname.indexOf(':')
    if (colon == -1) return namespaces['']
    const prefix = qname.slice(0, colon)
    a.assert(namespaces[prefix] !== undefined, `SVG outline "${name}" uses the undeclared namespace prefix "${prefix}"!`)
    return namespaces[prefix]
}

exports.extract = (text, name) => {

    a.assert(typeof text == 'string', `SVG outline "${name}" should be text!`)
    if (text.startsWith('﻿')) text = text.slice(1)

    const paths = []
    const stack = []
    let root_seen = false
    let pos = 0

    // the geometry-relevant state of an element, given its parent's state
    const visit = (qname, attributes) => {
        const parent = stack[stack.length - 1]
        const namespaces = {...(parent ? parent.namespaces : {})}
        for (const [key, val] of Object.entries(attributes)) {
            if (key == 'xmlns') namespaces[''] = val
            else if (key.startsWith('xmlns:')) namespaces[key.slice('xmlns:'.length)] = val
        }
        const frame = {qname, namespaces, ignored: false, transformed: undefined}
        const namespace = namespace_of(qname, namespaces, name)
        const local = qname.slice(qname.indexOf(':') + 1)
        const svg = namespace === undefined || namespace == svg_namespace

        if (!parent) {
            a.assert(!root_seen, `SVG outline "${name}" has more than one root element!`)
            a.assert(svg && local == 'svg', `SVG outline "${name}" should have an <svg> root element, not <${qname}>!`)
            root_seen = true
            check_root(attributes, name)
        } else if (parent.ignored || !svg) {
            // children of unrendered definitions and foreign (e.g. inkscape) elements have no geometry
            frame.ignored = true
            return frame
        }

        if (definitions.includes(local) || descriptions.includes(local)) {
            frame.ignored = true
            return frame
        }
        a.assert(!shapes.includes(local), `SVG outline "${name}" contains a visible <${qname}>, but only paths are supported! ` +
            'Convert objects to paths before exporting.')
        a.assert(parent === undefined || local != 'svg', `SVG outline "${name}" contains a nested <svg> viewport, which is not supported! ` +
            'Flatten the drawing into a single <svg> before exporting.')
        a.assert(local == 'svg' || local == 'path' || containers.includes(local), `SVG outline "${name}" contains an unsupported element <${qname}>!`)

        // references to definitions that would change the imported geometry
        const style = style_properties(attributes.style)
        for (const property of ['clip-path', 'mask']) {
            a.assert(!active(attributes[property]) && !active(style[property]), `SVG outline "${name}" uses "${property}" on <${qname}>, ` +
                'clipping and masking are not supported! Apply them to the paths before exporting.')
        }
        frame.transformed = parent && parent.transformed
        if (active(attributes.transform) || active(style.transform)) frame.transformed = qname

        if (local == 'path') {
            a.assert(frame.transformed === undefined, `SVG outline "${name}" has a transform on <${frame.transformed}> affecting path ${paths.length}, ` +
                'transforms are not supported! Flatten transforms before exporting.')
            a.assert(attributes.d !== undefined, `SVG outline "${name}" has a <path> without "d" data at index ${paths.length}!`)
            paths.push(attributes.d)
        }
        return frame
    }

    while (pos < text.length) {
        const next = text.indexOf('<', pos)
        const content = text.slice(pos, next == -1 ? text.length : next)
        a.assert(stack.length || content.trim() === '', `SVG outline "${name}" has text outside of its root element!`)
        if (next == -1) break
        pos = next

        if (text.startsWith('<!--', pos)) {
            const end = text.indexOf('-->', pos + 4)
            a.assert(end != -1, `SVG outline "${name}" has an unterminated comment!`)
            pos = end + 3
        } else if (text.startsWith('<![CDATA[', pos)) {
            const end = text.indexOf(']]>', pos)
            a.assert(stack.length && end != -1, `SVG outline "${name}" has a misplaced or unterminated CDATA section!`)
            pos = end + 3
        } else if (text.startsWith('<?', pos)) {
            const end = text.indexOf('?>', pos)
            a.assert(end != -1, `SVG outline "${name}" has an unterminated processing instruction!`)
            pos = end + 2
        } else if (text.startsWith('<!DOCTYPE', pos)) {
            doctype_regex.lastIndex = pos
            a.assert(!root_seen && doctype_regex.test(text), `SVG outline "${name}" has a misplaced DOCTYPE, or one with declarations, which are not supported!`)
            pos = doctype_regex.lastIndex
        } else if (text.startsWith('</', pos)) {
            end_tag_regex.lastIndex = pos
            const match = end_tag_regex.exec(text)
            const open = stack.pop()
            a.assert(match && open && open.qname == match[1], `SVG outline "${name}" has malformed markup: unexpected closing tag at offset ${pos}!`)
            pos = end_tag_regex.lastIndex
        } else {
            start_tag_regex.lastIndex = pos
            const match = start_tag_regex.exec(text)
            a.assert(match, `SVG outline "${name}" has malformed markup at offset ${pos}!`)
            const frame = visit(match[1], parse_attributes(match[2], name))
            if (!match[3]) stack.push(frame)
            pos = start_tag_regex.lastIndex
        }
    }

    a.assert(root_seen, `SVG outline "${name}" does not contain an <svg> element!`)
    a.assert(!stack.length, `SVG outline "${name}" has unclosed elements!`)
    return paths
}