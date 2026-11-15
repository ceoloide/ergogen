# Compatibility notes for 4.3.0

These changes can make a config or setup that worked with 4.2.x fail or behave differently.

## Node.js

The CLI needs Node.js `^20.19.0 || ^22.12.0 || >=23`, as declared in `engines` in `package.json`.
The range comes from `yargs` 18, an ES module that the CommonJS CLI loads with `require()`.
No other locked dependency needs a newer runtime.

- On older versions, such as 20.18 or 22.11, the CLI exits with `ERR_REQUIRE_ESM` before it reads the config.
- On Node 22.12.0, the CLI works but prints this warning on stderr:

  ```
  ExperimentalWarning: CommonJS module .../src/cli.js is loading ES Module .../node_modules/yargs/index.mjs using require().
  Support for loading ES Module in require() is an experimental feature and might change at any time
  ```

  Node 20.19.0 and 24.0.0 print no warning.
- Node 20 reached end of life upstream in April 2026. 20.19.0 is still within the declared range and is tested in CI.

## YAML input

Configs are now parsed with `js-yaml` 4 instead of 3.
The differences below were observed with `js-yaml` 3.14.1 and 4.2.0, the locked version.

### Empty items in flow sequences

Empty items in a flow sequence are now a parse error. For example:

```yaml
left.key.bind: [,10,,]
```

The CLI reports `Input is not valid YAML, JSON, or JS Code!`.
The underlying `js-yaml` diagnostic is `expected the node content, but found ','`.

`js-yaml` 3 read each empty item as `null` and dropped the trailing one, so `[,10,,]` became `[null, 10, null]`.
Write omitted items explicitly as `null` or `~`: `[null, 10, null]` or `[~, 10, ~]` preserves that parsed array.
When Ergogen merges arrays, `null` keeps the inherited value at that index; it does not set it to zero.
For example, overriding an inherited `bind: [3, 3, 3, 3]` with `[~, 10, ~]` gives `[3, 10, 3, 3]`.
Use `[0, 10, 0, 0]` only when those other sides should be zero; it matches the sparse form only when their inherited values are zero.
A sparse array without enough inherited values can still fail bind validation, which requires four numeric values.
A single trailing comma, as in `[1, 2,]`, is still accepted.

### Scalars

These are examples of observed differences, not an exhaustive list.
The table describes the underlying loader results; rejected input reaches the CLI as the generic error above.

| Input | js-yaml 3 | js-yaml 4 |
| --- | --- | --- |
| `010` | `8` (octal) | `10` |
| `0o10` | `"0o10"` | `8` |
| `1:30` | `90` (base 60) | `"1:30"` |
| `1_000` | `1000` | `"1_000"` |
| `!!js/function`, `!!js/regexp`, `!!js/undefined` | JavaScript values | `unknown tag` error |

These parse the same in both versions:

- `yes`, `no`, `on`, `off` and `y` are strings, and `true`, `True` and `false` are booleans.
- Hexadecimal (`0x10`), binary (`0b101`), exponents (`1e3`), `.inf`, `.nan`, `~` and dates.
- `<<` merge keys and empty values in flow mappings (`{x: , y: 2}`).
- Unit expressions such as `u - 1`, which stay strings for Ergogen to evaluate.

## Reserved key-level fields

Key-level declarations now reject fields that only make sense elsewhere, instead of ignoring them.
Key-level declarations are `points.key`, `points.zones.<zone>.key`, `points.zones.<zone>.columns.<column>.key`, `points.zones.<zone>.rows.<row>` and `points.zones.<zone>.columns.<column>.rows.<row>`.

| Field | Error message ends with |
| --- | --- |
| `key` | `this block is already a key-level config; move its fields up one level!` |
| `zones` | `zones can only be declared directly within "points"!` |
| `columns` | `columns can only be declared directly within a zone!` |
| `rows` | `rows can only be declared directly within a zone or a column!` |
| `zone`, `col`, `row` | `it is reserved for engine-managed point metadata!` |

The most common case is a `key` block nested inside a row:

```yaml
rows:
  bottom:
    key:
      width: 30
```

```
Reserved key "key" within field "points.zones.matrix.rows.bottom": this block is already a key-level config; move its fields up one level!
```

In 4.2.x this `width` was silently ignored and the key kept its default width.
Move the fields up one level (`rows.bottom.width: 30`).
`zone`, `col` and `row` were overwritten by the engine, so a custom value never reached the point.

An object-valued `mirror` override directly inside a key-level declaration rejects only `key`, `zones`, `columns` and `rows`, so it can still relabel the mirrored point with `mirror.row`, `mirror.col.name` and `mirror.zone.name`.
`col` and `zone` must remain objects; scalar `mirror.col` or `mirror.zone` overrides are rejected.
The check is shallow: nested metadata such as `custom.key` is still allowed.

## Hull outlines

`hull` is pinned to commit `5847b0a` (1.0.12), the version 4.2.x used and the one the web UI loads.
The final upstream release, 1.0.13 (`ffcf93d`), replaced its convex hull and segment intersection helpers.
That changes concave hull results: in the `test/outlines/hull.yaml` cases, three outlines grow by 92 to 188 mm² and two others change vertex order.
Review the hull references before updating this dependency.
