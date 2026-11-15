# Config schema and verification

`schema.json` is a JSON schema (draft-07) for the structure of an Ergogen config: the parts the engine handles itself, like points, anchors, filters, outline and case parts, and the PCB and footprint fields.
Shapes, footprints and templates are registries that bundles can extend or override, so their names, their own fields and their params are left to the engine.

The schema describes the canonical config, after dotted keys are unnested, `$extends` is resolved, `$params` is applied and `$concat(...)` strings are joined.
That's the config the engine works with, and debug output writes it to `canonical.yaml`.

## `ergogen.verify(raw)`

Checks a config without generating anything, and reports every problem it finds instead of throwing at the first one.
It runs synchronously.

```js
const ergogen = require('ergogen')

const result = ergogen.verify(yaml_text) // or a config object
if (!result.valid) {
    for (const diagnostic of result.diagnostics) console.log(diagnostic.message)
}
```

It takes YAML or JSON text, or a config object holding the kind of data YAML describes:

- plain objects and arrays
- strings, numbers, booleans, `null` or `undefined`
- dates, which preprocessing turns into empty objects, just like when processing

Anything else is reported instead of being converted, like cyclic data, functions, `BigInt`s, `Map`s, buffers or class instances.
So are keys and `$extends` paths that the engine's dotted paths would follow into the object prototype, like `__proto__.x` or `constructor.prototype.x`.
A plain `constructor` or `prototype` key is still fine.

JS code and KLE layouts can only be used with `ergogen.process`, as verifying them would mean running or converting them.
Bundles aren't supported either.
The input is never modified.

Config problems never throw.
`verify` only throws when it can't run at all: when Ajv is missing, or when a content security policy keeps it from compiling the schema.

### Result

| Field | Meaning |
| --- | --- |
| `valid` | Whether every check passed |
| `scope` | Always `structure`: a valid config is well-formed, but can still fail while generating |
| `checks` | The checks that ran, in order: `parse`, `preprocess` and `structure`, stopping after the first one that fails |
| `diagnostics` | One entry per problem, in a stable order |
| `canonical` | The preprocessed config, once preprocessing succeeded |

Each diagnostic has a stable `code`, the `phase` it comes from, and a human readable `message`.
Depending on the problem, it also has:

- `line` and `column` (1-based) for syntax errors
- `stage` (`unnest`, `inherit`, `parameterize` or `concat`) for preprocessing errors
- `path` (key segments) and `pointer` (a JSON pointer) to the field itself, even when it's missing or unexpected.
  These point into the parsed input for the `parse` phase, and into the canonical config for the `structure` phase.
- `expected` and `actual` values, where they help

| Code | Phase | Problem |
| --- | --- | --- |
| `syntax_error` | `parse` | The text isn't valid YAML or JSON |
| `empty_config` | `parse` | There's no config at all |
| `invalid_root` | `parse` | The config isn't an object (`actual` holds its type) |
| `cyclic_value` | `parse` | A value contains itself |
| `unsupported_value` | `parse` | A value isn't plain YAML or JSON data (`actual` holds its type) |
| `unsafe_key` | `parse` | A key would reach the object prototype |
| `unsafe_reference` | `parse` | An `$extends` path would reach the object prototype |
| `preprocess_error` | `preprocess` | `$extends`, `$params` or `$concat` failed |
| `missing_field` | `structure` | A required field is missing |
| `unexpected_field` | `structure` | A field isn't allowed there |
| `reserved_field` | `structure` | A key-level field uses a reserved name |
| `conflicting_fields` | `structure` | Fields that can't be combined, like `ref` and `aggregate` |
| `invalid_type` | `structure` | A value has the wrong type |
| `invalid_value` | `structure` | A value isn't one of the allowed ones |
| `invalid_length` | `structure` | An array or string is too short or too long |
| `invalid_format` | `structure` | A string doesn't match the expected format |
| `invalid_config` | `structure` | Any other structural problem |

### Example

```yaml
points.zones.matrix:
  stagger: 5
pcbs.main.footprints:
  - where: true
```

```json
{
    "valid": false,
    "scope": "structure",
    "checks": ["parse", "preprocess", "structure"],
    "diagnostics": [
        {
            "code": "unexpected_field",
            "phase": "structure",
            "path": ["points", "zones", "matrix", "stagger"],
            "pointer": "/points/zones/matrix/stagger",
            "message": "Unexpected key \"stagger\" within field \"points.zones.matrix\"!",
            "actual": 5
        },
        {
            "code": "missing_field",
            "phase": "structure",
            "path": ["pcbs", "main", "footprints", "0", "what"],
            "pointer": "/pcbs/main/footprints/0/what",
            "message": "Field \"pcbs.main.footprints.0.what\" is missing!"
        }
    ],
    "canonical": {"points": {"zones": {"matrix": {"stagger": 5}}}, "pcbs": {"main": {"footprints": [{"where": true}]}}}
}
```

A syntax error stops right away, with its position in the text:

```json
{
    "code": "syntax_error",
    "phase": "parse",
    "line": 5,
    "column": 1,
    "message": "Input is not valid YAML or JSON at line 5, column 1: unexpected end of the stream within a flow collection!"
}
```

### Limitations

- Only the structure is checked. Point references, shape, footprint and template names and their own fields and params, required nets, math expressions, geometry and `meta.engine` compatibility are checked while processing.
- Structural paths point into the canonical config, not into the source text. Mapping them back to lines would need a source map, which is future work.
- Preprocessing errors carry the engine's message and the failing stage, but no path.
- A value that fits none of the forms of a field gets a single diagnostic listing them all. A list mixing filter conditions and anchors can still get one diagnostic per form.

### Dependencies

Ajv is only loaded and compiled the first time a config reaches the structural check, so `ergogen.process` never needs it.

In Node, the `ajv` dependency (^8.20.0) is used.
The UMD bundle in `dist/` takes Ajv from the global `ajv7` in browsers, or the `ajv` module with AMD.
`dist/ajv7.min.js` from the `ajv-dist` package provides that global, and its latest release (8.17.1) has the same API.

Ajv compiles the schema into code, so `verify` needs a content security policy that allows it, like `'unsafe-eval'` in `script-src`.
`ergogen.process` works either way.
