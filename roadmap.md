# Ergogen TODO

## CLI

### Major

- Straightforward-ize `extends` behaviour for tagging (see #129)
- Switch the default PCB template to `kicad8`
- Merge, generalize, uniform-ize and externalize footprints!
    - onnx-like incremental opset versioning
    - Template for creating them, built-in variables they can use, documentation, external links, etc.
        - Add access to whole set of points + filtering logic, so they can implement their own connection logic as well maybe (see daisy chaining)
        - Maybe ordering for the filter (so every instance can know that it really is the next in line)
        - Add `chain` to footprint API similarly to how `local_net` behaves, only for daisy chaining
        - Also, rename `local_net` to `local`, probably
    - Also considering how (or, on which layer) they define their silks, universal mirroring behaviour (see ixy/xy/sxy note), etc.
    - When breaking anyway, remove a lot of footprints from built-in status

### Minor

- Support "direct" anchors, as in, recognize num arrays and parse them as x/y/r
- Add `origin` to zone-wide and global rotation in points
- Allow footprints to access raw array/object fields from points with templating
- Include raw kicad footprint integrations
    - pull torik's script to be able to convert raw kicad footprints into positionable ergogen ones
    - have a `dummy` footprint which can just be updated from schematic
- Allow footprints to publish outlines
    - Make these usable in the `outlines` section through a new `what`
- Add footprint sanitization to check compatibility for externally loaded ones
    - Or to double check internal ones for compliance
- Even more extreme anchor stuff
    - Checkpoints
    - Distances
    - Weighted combinations
    - Extend the "turning towards" capabilities of `orient` and `rotate` to `shift` as well (to move as much as it would take the current anchor location to get there)
- Parse combinations of outlines by SVG line color
- Consider STL or other input for cases or PCB renders
- Support text silk output to PCBs (in configurable fonts, through SVG?)
    - Maybe a partial markdown preprocess to support bold and italic?
- Look into gr_curve to possibly add beziers to the kicad conversion
    - Support curves directly in `polygon` point definitions
    - Tangents and other circle tools
- Add snappable line footprint
- Figure out a manual, but still reasonably comfortable routing method directly from the config
- Eeschema support for pcbs
- Generate ZMK shield from config
- Export **to** KLE?
- Include 3D models paths in kicad output for visualization
    - Also, provide 3D models for built-in footprints
- Update json schema and add syntax highlight to editors
- Support different netclasses
- Allow a potential filter for filleting (only on angles =90°, <45°, left turn vs. right turn when going clockwise, etc.)
- Add `operation: skip` to allow easily "commenting out" whole outline parts
- Better error message for negative rectangle (it may not only be because of corner/bevel)

### Patch

- Check unexpected keys at top level, too
- Better error handling for the fillet option?
- Add custom fillet implementation that considers line-line connections only?
- Add nicer filleting error messages when makerjs dies for some reason
- Debug point (orient+shift) differences in circles vs. polygons (see Discord)

## WEBUI

### Major

- Change over to Cache's live preview implementation
- Add missing KLE functionality
- Visualizing multiple outlines at once, with different colors
- Add snapping/measurement capabilities for quicker iteration

### Minor

- Propagate log output from the ergogen module
- Attempt to auto-compile (if inactive for n secs, or whatever)
- Support saving to gists
- Add kicad_pcb visualization as well
- Get dropdown examples from a separate repo
- Expand the config dropdown with opensource stuff: corne, lily, ergodox, atreus...

### Patch

- Streamline (and document) an update pipeline
- Add puppeteer tests

## DOCS

- n00b tutorials
    - With a progression of increasingly complex steps
    - And lots of illustrations!
- Complete reference
    - Some known deficiencies:
        - Units separated to their own block at the front
        - Key-level `width` and `height` are supported during visualization
        - This key-level example should probably be added from discord: https://discord.com/channels/714176584269168732/759825860617437204/773104093546676244
        - Change outline fields to have their full anchor support documented
        - Mention the ability to opt out of gluing!
        - Key-level defaults are based around u's, not 19!
- Document contributor test commands (`npm test`, `npm run coverage`, `--what`, `--dump`)
- Changelog, Roadmap
- A public catalog of real-life ergogen configs
    - Probably could be the same as the separate examples repo for the dropdown
