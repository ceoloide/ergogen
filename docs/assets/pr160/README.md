# PR #160 illustration sources

These are drawings of real Ergogen outline models, with a gray key reference layer and blue generated outlines. The SVGs are editable masters; the PNGs are ready to attach to release notes. Every panel within a figure uses the same geometry scale.

| Figure | Source |
| --- | --- |
| `hull-symmetric` | Issue [#162](https://github.com/ergogen/ergogen/issues/162), without `fillet` and `expand`: `issue162_raw.yaml` and `issue162_off_raw.yaml`. Compares upstream `develop` at `8286e18`, release default, and `symmetric: false`. Dashed line: mirror axis. |
| `asym-clone` | `test/outlines/asym_filter.yaml`, `clone-regex`, run on both builds. |
| `solvers` | `test/outlines/solvers.yaml`: `gusset`, `notch`, and `thumb-keys`. |
| `svg-outlines` | `test/outlines/svg.yaml`, `svg-path-mirror`, and the included `sockets.yaml`. |

The release build used is `c7fc302`. To reproduce the SVGs, run from that release checkout after installing its dependencies, and provide a dependency-installed copy of upstream `develop` at `8286e18`:

```sh
node docs/assets/pr160/render.js /path/to/develop /tmp/pr160-figures
```

`spec.json` defines every panel, config, selected outline, and layer. The renderer calls `ergogen.process` with debug output and exports the returned Maker.js models; it does not trace or approximate the drawings.

The PNGs were rasterized with `@resvg/resvg-js` using DejaVu Sans at twice the SVG width, capped at 1800 pixels. Any SVG rasterizer can export the editable SVGs; font rendering can differ. Socket contours illustrate reusable geometry and do not define a KiCad footprint or manufacturing clearance.
