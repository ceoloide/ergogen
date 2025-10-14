async function toManifold(model) {
  const manifoldModule = await import('manifold-3d');
  const manifold = await manifoldModule.default();
  const makerjs = require('makerjs');

  const chains = makerjs.model.findChains(model);
  if (!chains) {
    return null;
  }

  const polygons = chains
    .filter(chain => chain && chain.links)
    .map(chain => {
      const points = [];
      chain.links.forEach(link => {
        if (!link.path) return;
        // For arcs and circles, we need to convert them to points
        if (link.path.type === 'arc' || link.path.type === 'circle') {
            const collector = { points: [] };
            makerjs.path.toPoints(link.path, 1, (point) => collector.points.push(point));
            points.push(...collector.points);
        } else {
            points.push(link.path.origin);
        }
      });
      return points.map(p => [p[0], p[1]]);
    });

  return new manifold.CrossSection(polygons, manifoldModule.FillRule.NonZero);
}

module.exports = {
  toManifold
};