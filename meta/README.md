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

Anything else is reported instead of being converted, like cyclic data, functions, `BigInt`s, `Map`s, buffers or class instances, and so is nesting deeper than 1000 levels.

The engine follows dotted keys and `$extends` paths through anything a value has, including what it inherits.
So `verify` only lets them into data the config owns:
- A level that resolves to an inherited value is reported instead, like `toString`, `constructor`, `__proto__`, or array, string or number methods (`list.push.x`).
- So is setting `__proto__`.
- A field the config owns can have any other name, like `constructor` or `toString`, and a dotted key can extend it once it's defined.

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
  These point into the parsed input for input and dotted key problems, into the unnested config for inheritance targets, and into the canonical config for structural problems.
- `expected` and `actual` values, where they help

| Code | Phase | Problem |
| --- | --- | --- |
| `syntax_error` | `parse` | The text isn't valid YAML or JSON |
| `empty_config` | `parse` | There's no config at all |
| `invalid_root` | `parse` | The config isn't an object (`actual` holds its type) |
| `cyclic_value` | `parse` | A value contains itself |
| `unsupported_value` | `parse` | A value isn't plain YAML or JSON data (`actual` holds its type) |
| `too_deep` | `parse` | A value is nested deeper than 1000 levels, counting dotted keys |
| `unsafe_key` | `preprocess` | A dotted key would reach something the config doesn't own |
| `unsafe_reference` | `preprocess` | An `$extends` path would reach something the config doesn't own |
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
- Some engine leniency isn't mirrored, as the schema keeps the intended types: `meta: null` or `references: null` are rejected, for example.
- `ergogen.process` itself still follows dotted keys and `$extends` paths wherever they lead. Only `verify` refuses those that leave the config.
- A value that fits none of the forms of a field gets a single diagnostic listing them all. A list mixing filter conditions and anchors can still get one diagnostic per form.

### Dependencies

Ajv is only compiled the first time a config reaches the structural check.
How it's loaded depends on the build:

- **Node (`src/`):** the `ajv` dependency (^8.20.0) is required at that point too, so `ergogen.process` never loads it.
- **The UMD bundle in `dist/`, with a browser global:** it reads `ajv7` when loading, but only uses it in `verify`. Without it, `process` still works, and `verify` throws.
- **The UMD bundle in CommonJS or AMD:** these resolve the `ajv` module eagerly, as a regular dependency of the bundle.

`dist/ajv7.min.js` from the `ajv-dist` package provides that global, and its latest release (8.17.1) has the same API as the Node version.

Ajv compiles the schema into code, so `verify` needs a content security policy that allows it, like `'unsafe-eval'` in `script-src`.
`ergogen.process` works either way.
