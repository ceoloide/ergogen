const { expect } = require('chai');
const makerjs = require('makerjs');
const { toManifold } = require('../../src/step');

describe('toManifold', () => {
  it('should convert a simple maker.js model to a manifold cross-section', async () => {
    const model = new makerjs.models.Rectangle(10, 5);
    const manifoldCrossSection = await toManifold(model);
    expect(manifoldCrossSection).to.exist;
  });

  it('should handle models with holes', async () => {
    const model = {
      paths: {
        outer: new makerjs.models.Rectangle(10, 10),
        inner: new makerjs.models.Rectangle(5, 5)
      }
    };
    makerjs.model.center(model.paths.inner, makerjs.model.findChains(model)[0]);
    const manifoldCrossSection = await toManifold(model);
    expect(manifoldCrossSection).to.exist;
  });
});
