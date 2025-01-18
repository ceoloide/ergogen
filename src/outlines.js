const m = require('makerjs')
const u = require('./utils')
const a = require('./assert')
const o = require('./operation')
const Point = require('./point')
const prep = require('./prepare')
const anchor = require('./anchor').parse
const filter = require('./filter').parse
const hulljs = require('hull')

const binding = (base, bbox, point, units) => {

    let bind = a.trbl(point.meta.bind || 0, `${point.meta.name}.bind`)(units)
    // if it's a mirrored key, we swap the left and right bind values
    if (point.meta.mirrored) {
        bind = [bind[0], bind[3], bind[2], bind[1]]
    }

    const bt = Math.max(bbox.high[1], 0) + Math.max(bind[0], 0)
    const br = Math.max(bbox.high[0], 0) + Math.max(bind[1], 0)
    const bd = Math.min(bbox.low[1], 0) - Math.max(bind[2], 0)
    const bl = Math.min(bbox.low[0], 0) - Math.max(bind[3], 0)

    if (bind[0] || bind[1]) base = u.union(base, u.rect(br, bt))
    if (bind[1] || bind[2]) base = u.union(base, u.rect(br, -bd, [0, bd]))
    if (bind[2] || bind[3]) base = u.union(base, u.rect(-bl, -bd, [bl, bd]))
    if (bind[3] || bind[0]) base = u.union(base, u.rect(-bl, bt, [bl, 0]))

    return base
}

const rectangle = (config, name, points, outlines, units) => {

    // prepare params
    a.unexpected(config, `${name}`, ['size', 'corner', 'bevel'])
    const size = a.wh(config.size, `${name}.size`)(units)
    const rec_units = prep.extend({
        sx: size[0],
        sy: size[1]
    }, units)
    const corner = a.sane(config.corner || 0, `${name}.corner`, 'number')(rec_units)
    const bevel = a.sane(config.bevel || 0, `${name}.bevel`, 'number')(rec_units)

    // return shape function and its units
    return [() => {

        const error = (dim, val) => `Rectangle for "${name}" isn't ${dim} enough for its corner and bevel (${val} - 2 * ${corner} - 2 * ${bevel} <= 0)!`
        const [w, h] = size
        const mod = 2 * (corner + bevel)
        const cw = w - mod
        a.assert(cw >= 0, error('wide', w))
        const ch = h - mod
        a.assert(ch >= 0, error('tall', h))

        let rect = new m.models.Rectangle(cw, ch)
        if (bevel) {
            rect = u.poly([
                [-bevel, 0],
                [-bevel, ch],
                [0, ch + bevel],
                [cw, ch + bevel],
                [cw + bevel, ch],
                [cw + bevel, 0],
                [cw, -bevel],
                [0, -bevel]
            ])
        }
        if (corner > 0) rect = m.model.outline(rect, corner, 0)
        rect = m.model.moveRelative(rect, [-cw/2, -ch/2])
        const bbox = {high: [w/2, h/2], low: [-w/2, -h/2]}

        return [rect, bbox]
    }, rec_units]
}

const circle = (config, name, points, outlines, units) => {

    // prepare params
    a.unexpected(config, `${name}`, ['radius'])
    const radius = a.sane(config.radius, `${name}.radius`, 'number')(units)
    const circ_units = prep.extend({
        r: radius
    }, units)

    // return shape function and its units
    return [() => {
        let circle = u.circle([0, 0], radius)
        const bbox = {high: [radius, radius], low: [-radius, -radius]}
        return [circle, bbox]
    }, circ_units]
}

const polygon = (config, name, points, outlines, units) => {

    // prepare params
    a.unexpected(config, `${name}`, ['points'])
    const poly_points = a.sane(config.points, `${name}.points`, 'array')()

    // return shape function and its units
    return [point => {
        const parsed_points = []
        // the poly starts at [0, 0] as it will be positioned later
        // but we keep the point metadata for potential mirroring purposes
        let last_anchor = new Point(0, 0, 0, point.meta)
        let poly_index = -1
        for (const poly_point of poly_points) {
            const poly_name = `${name}.points[${++poly_index}]`
            last_anchor = anchor(poly_point, poly_name, points, last_anchor)(units)
            parsed_points.push(last_anchor.p)
        }
        let poly = u.poly(parsed_points)
        const bbox = u.bbox(parsed_points)
        return [poly, bbox]
    }, units]
}

const bezier = (config, name, points, outlines, units) => {

  // prepare params
  a.unexpected(config, `${name}`, ['type', 'accuracy', 'points'])
  const type = a.in(config.type || 'quadratic', `${name}.type`, ['cubic', 'quadratic'])
  const control_points = {
    'quadratic': 1,
    'cubic': 2,
  }
  const accuracy = a.sane(config.accuracy || -1, `${name}.accuracy`, 'number')(units)
  const bezier_points = a.sane(config.points, `${name}.points`, 'array')()
  a.assert(config.points.length%(control_points[type]+1)==0, `${name}.points doesn't contain enough points to form a closed Bezier spline, there should be a multiple of ${control_points[type]+1} points.`)
  
  // return shape function and its units
  return [point => {
    const parsed_points = []
    // the bezier starts at [0, 0] as it will be positioned later
    // but we keep the point metadata for potential mirroring purposes
    let last_anchor = new Point(0, 0, 0, point.meta)
    let bezier_index = -1
    for (const bezier_point of bezier_points) {
        const bezier_name = `${name}.points[${++bezier_index}]`
        last_anchor = anchor(bezier_point, bezier_name, points, last_anchor)(units)
        parsed_points.push(last_anchor.p)
    }
    return u.bezier(parsed_points, control_points[type], accuracy)
  }, units]
}


const hull = (config, name, points, outlines, units) => {

  // prepare params
  a.unexpected(config, `${name}`, ['concavity', 'extend', 'points'])
  const concavity = a.sane(config.concavity || 50, `${name}.concavity`, 'number')(units)
  // Extend should default to `true` if not defined
  const extend = a.sane(config.extend === undefined || config.extend, `${name}.extend`, 'boolean')(units)
  const hull_points = a.sane(config.points, `${name}.points`, 'array')()

  // return shape function and its units
  return [point => {
    const parsed_points = []
    // the poly starts at [0, 0] as it will be positioned later
    // but we keep the point metadata for potential mirroring purposes
    let last_anchor = new Point(0, 0, 0, point.meta)
    let poly_index = -1
    for (const poly_point of hull_points) {
        const poly_name = `${name}.points[${++poly_index}]`
        last_anchor = anchor(poly_point, poly_name, points, last_anchor)(units)
        if(extend) {
          const w = last_anchor.meta.width
          const h = last_anchor.meta.height
          const rect = u.rect(w, h, [-w/2, -h/2])
          const model = last_anchor.position(rect)
          const top_origin = model.paths.top.origin
          const top_end =  model.paths.top.end
          const bottom_origin =  model.paths.bottom.origin
          const bottom_end =  model.paths.bottom.end
          const model_origin = model.origin
          parsed_points.push([top_origin[0] + model_origin[0], top_origin[1] + model_origin[1]])
          parsed_points.push([top_end[0] + model_origin[0], top_end[1] + model_origin[1]])
          parsed_points.push([bottom_origin[0] + model_origin[0], bottom_origin[1] + model_origin[1]])
          parsed_points.push([bottom_end[0] + model_origin[0], bottom_end[1] + model_origin[1]])
          // When width or height are too large, we need to add additional points along the sides, or
          // the convex hull algorithm will fold "within" the key. Points are then added at regular
          // intervals, their number being at least 2, since MakerJS places the first two points at
          // either end of the path. When a side is longer than 18 divide the length of a side by
          // that amount and add it to 2, this way we always have at least a middle point for sides
          // longer than 18 
          const l = 18
          let intermediate_points = []
          if (w > l) {
            intermediate_points = intermediate_points.concat(m.path.toPoints(model.paths.top, 2 + Math.floor(w / l)))
            intermediate_points = intermediate_points.concat(m.path.toPoints(model.paths.bottom, 2 + Math.floor(w / l)))
          }
          if (h > l) {
            intermediate_points = intermediate_points.concat(m.path.toPoints(model.paths.left, 2 + Math.floor(h / l)))
            intermediate_points = intermediate_points.concat(m.path.toPoints(model.paths.right, 2 + Math.floor(h / l)))
          }
          for (let i = 0; i < intermediate_points.length; i++) {
            const p = intermediate_points[i];
            if (!m.measure.isPointEqual(p, top_origin) &&
              !m.measure.isPointEqual(p, top_end) &&
              !m.measure.isPointEqual(p, bottom_origin) &&
              !m.measure.isPointEqual(p, bottom_end)) {
              // Not one of the corners
              const intermediate_point = [p[0] + model_origin[0], p[1] + model_origin[1]]
              parsed_points.push(intermediate_point)
            }
          }
        } else {
          parsed_points.push(last_anchor.p)
        }
    }
    const poly_points = hulljs(parsed_points, concavity)
    let poly = u.poly(poly_points)
    const bbox = u.bbox(poly_points)
    return [poly, bbox]
  }, units]
}

const outline = (config, name, points, outlines, units) => {

    // prepare params
    a.unexpected(config, `${name}`, ['name', 'origin'])
    a.assert(outlines[config.name], `Field "${name}.name" does not name an existing outline!`)
    const origin = anchor(config.origin || {}, `${name}.origin`, points)(units)
    
    // return shape function and its units
    return [() => {
        let o = u.deepcopy(outlines[config.name])
        o = origin.unposition(o)
        const bbox = m.measure.modelExtents(o)
        return [o, bbox]
    }, units]
}

const path = (config, name, points, outlines, units) => {

    // prepare params
    a.unexpected(config, `${name}`, ['segments'])
    const segments = a.sane(config.segments, `${name}.segments`, 'array')()
    const segments_points = [];
    for(const [index, segment] of segments.entries()) {
      a.in(segment.type, `${name}.segments.${index}.type`, ['line', 'arc', 's_curve', 'bezier'])
      segments_points.push(a.sane(segment.points, `${name}.segments.${index}.points`, 'array')())
      const num_points = segment.points.length
      switch (segment.type) {
       case 'bezier':
          a.unexpected(segment, `${name}.segments.${index}`, ['type', `points`, 'accuracy'])
          break
        case 'arc':
        case 'line':
        case 's_curve':
          a.unexpected(segment, `${name}.segments.${index}`, ['type', `points`])
          break
      }
      switch (segment.type) {
       case 'bezier':
          a.assert(num_points > 2, `Bezier Curve needs 3 or 4 points, but ${num_points} were provided`)
          break
        case 'arc':
          a.assert(num_points === 3, `Arc needs 3 points, but ${num_points} ${num_points === 1 ? 'was' : 'were'} provided`)
          break
        case 'line':
          a.assert(num_points > 1, `Line need at least 2 points, but ${num_points} ${num_points === 1 ? 'was' : 'were'} provided`)
          break
        case 's_curve':
          a.assert(num_points === 2, `S-Curve needs 2 points, but ${num_points} ${num_points === 1 ? 'was' : 'were'} provided`)
          break
      }
    }

    // return shape function and its units
    return [(point) => {
      let shape = {
        models: {},
        paths: {}
      }
      // the segment starts at [0, 0] as it will be positioned later
      // but we keep the point metadata for potential mirroring purposes
      let first_anchor = undefined
      let last_anchor = new Point(0, 0, 0, point.meta)
      for (const [index, segment] of segments.entries()){
        const parsed_points = []
        let point_index = -1
        for (const segment_point of segments_points[index]) {
            const segment_points_name = `${name}.segments.${index}.points[${++point_index}]`
            last_anchor = anchor(segment_point, segment_points_name, points, last_anchor)(units)
            if(first_anchor === undefined) {
              first_anchor = last_anchor
            }
            parsed_points.push(last_anchor.p)
        }
        const segment_name = `path${index}`
        switch (segment.type) {
          case 'line':
            let line = new m.models.ConnectTheDots(false, parsed_points)
            shape.models[segment_name] = line
            break
          case 'arc':
            let arc = new m.paths.Arc(...parsed_points)
            shape.paths[segment_name] = arc
            break
          case 's_curve':
            const origin = parsed_points[0]
            a.assert(parsed_points[0][0] !== parsed_points[1][0], "The ${name}.segments.${index} S-Curve segment cannot have points on the same X axis")
            const width = Math.abs(parsed_points[1][0] - parsed_points[0][0])
            a.assert(parsed_points[0][1] !== parsed_points[1][1], "The ${name}.segments.${index} S-Curve segment cannot have points on the same Y axis")
            const height = Math.abs(parsed_points[1][1] - parsed_points[0][1])
            const mirrorX = parsed_points[0][0] > parsed_points[1][0]
            const mirrorY = parsed_points[0][1] > parsed_points[1][1]
            const s_curve_raw = new m.models.SCurve(width, height)
            const mirrored_s_curve = m.model.mirror(s_curve_raw, mirrorX, mirrorY)
            const s_curve = m.model.move(mirrored_s_curve, origin)
            shape.models[segment_name] = s_curve
          case 'bezier':
            let bezier = new m.models.BezierCurve(...parsed_points)
            shape.models[segment_name] = bezier
            break
        }
      }
      // We always close the shape with a line between the first and last anchor, if they are not already the same
      if(first_anchor.x !== last_anchor.x || first_anchor.y != last_anchor.y) {
        let closing_line = new m.paths.Line([first_anchor.x, first_anchor.y], [last_anchor.x, last_anchor.y])
        shape.paths["closing_line"] = closing_line
      }
      const chain = m.model.findSingleChain(shape)
      a.assert(chain.endless, "The provided path configuration doesn't generate a closed shape.")
      const bbox = m.measure.modelExtents(shape)
      return [shape, {low: bbox.low, high: bbox.high}]
    }, units]
}

const whats = {
    rectangle,
    circle,
    polygon,
    outline,
    path,
    hull
}

const expand_shorthand = (config, name, units) => {
    if (a.type(config.expand)(units) == 'string') {
        const prefix = config.expand.slice(0, -1)
        const suffix = config.expand.slice(-1)
        const valid_suffixes = [')', '>', ']']
        a.assert(valid_suffixes.includes(suffix), `If field "${name}" is a string, ` +
            `it should end with one of [${valid_suffixes.map(s => `'${s}'`).join(', ')}]!`)
        config.expand = prefix
        config.joints = config.joints || valid_suffixes.indexOf(suffix)
    }
    
    if (a.type(config.joints)(units) == 'string') {
        if (config.joints == 'round') config.joints = 0
        if (config.joints == 'pointy') config.joints = 1
        if (config.joints == 'beveled') config.joints = 2
    }
}

exports.parse = (config, points, units) => {

    // output outlines will be collected here
    const outlines = {}

    // the config must be an actual object so that the exports have names
    config = a.sane(config, 'outlines', 'object')()
    for (let [outline_name, parts] of Object.entries(config)) {

        // placeholder for the current outline
        outlines[outline_name] = {models: {}}

        // each export can consist of multiple parts
        // either sub-objects or arrays are fine...
        if (a.type(parts)() == 'array') {
            parts = {...parts}
        }
        parts = a.sane(parts, `outlines.${outline_name}`, 'object')()
        
        for (let [part_name, part] of Object.entries(parts)) {
            
            const name = `outlines.${outline_name}.${part_name}`

            // string part-shortcuts are expanded first
            if (a.type(part)() == 'string') {
                part = o.operation(part, {outline: Object.keys(outlines)})
            }

            // process keys that are common to all part declarations
            const operation = u[a.in(part.operation || 'add', `${name}.operation`, ['add', 'subtract', 'intersect', 'stack'])]
            const what = a.in(part.what || 'outline', `${name}.what`, ['rectangle', 'circle', 'polygon', 'outline', 'path', 'hull'])
            const bound = !!part.bound
            const asym = a.asym(part.asym || 'source', `${name}.asym`)

            // `where` is delayed until we have all, potentially what-dependent units
            // default where is [0, 0], as per filter parsing
            const original_where = part.where // need to save, so the delete's don't get rid of it below
            const where = units => filter(original_where, `${name}.where`, points, units, asym)
            
            const original_adjust = part.adjust // same as above
            const fillet = a.sane(part.fillet || 0, `${name}.fillet`, 'number')(units)
            expand_shorthand(part, `${name}.expand`, units)
            const expand = a.sane(part.expand || 0, `${name}.expand`, 'number')(units)
            const joints = a.in(a.sane(part.joints || 0, `${name}.joints`, 'number')(units), `${name}.joints`, [0, 1, 2])
            const scale = a.sane(part.scale || 1, `${name}.scale`, 'number')(units)

            // these keys are then removed, so ops can check their own unexpected keys without interference
            delete part.operation
            delete part.what
            delete part.bound
            delete part.asym
            delete part.where
            delete part.adjust
            delete part.fillet
            delete part.expand
            delete part.joints
            delete part.scale

            // a prototype "shape" maker (and its units) are computed
            const [shape_maker, shape_units] = whats[what](part, name, points, outlines, units)
            const adjust = start => anchor(original_adjust || {}, `${name}.adjust`, points, start)(shape_units)

            // and then the shape is repeated for all where positions
            for (const w of where(shape_units)) {
                const point = adjust(w.clone())
                let [shape, bbox] = shape_maker(point) // point is passed for mirroring metadata only...
                if (bound) {
                    shape = binding(shape, bbox, point, shape_units)
                }
                shape = point.position(shape) // ...actual positioning happens here
                outlines[outline_name] = operation(outlines[outline_name], shape)
            }

            if (scale !== 1) {
                outlines[outline_name] = m.model.scale(outlines[outline_name], scale)
            }
    
            if (expand) {
                outlines[outline_name] = m.model.outline(
                    outlines[outline_name], Math.abs(expand), joints, (expand < 0), {farPoint: u.farPoint}
                )
            }

            if (fillet) {
                for (const [index, chain] of m.model.findChains(outlines[outline_name]).entries()) {
                    outlines[outline_name].models[`fillet_${part_name}_${index}`] = m.chain.fillet(chain, fillet)
                }
            }
        }

        // final adjustments
        m.model.originate(outlines[outline_name])
        m.model.simplify(outlines[outline_name])

    }

    return outlines
}   
