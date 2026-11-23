import pkg from './package.json' with { type: 'json' }
import json from '@rollup/plugin-json'
import commonjs from '@rollup/plugin-commonjs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'

// the svg helpers are resolved from this file, so .svg files can live anywhere
const require = createRequire(import.meta.url)
const svg_lib = require('./src/svg.js')
const svg_path = fileURLToPath(new URL('./src/svg.js', import.meta.url))

// turns .svg imports into ESM outline factories, with the same path extraction as bundle loading
export const svg_outline_plugin = () => {
  return {
    name: 'svg-outline-plugin',
    transform(code, id) {
      if (!id.endsWith('.svg')) return null
      const paths = svg_lib.extract(code, path.basename(id, '.svg'))
      return {
        code: [
          `import svg_lib from ${JSON.stringify(svg_path)}`,
          `const paths = ${JSON.stringify(paths)}`,
          'export default svg_lib.outline(paths)',
        ].join('\n'),
        map: {mappings: ''}
      }
    }
  }
}

// the browser bundle expects these libraries as globals, which the web UI supplies
const globals = {
  'makerjs': 'makerjs',
  'js-yaml': 'jsyaml',
  'mathjs': 'math',
  'kle-serial': 'kle',
  'hull': 'hull'
}

export default {
  input: 'src/ergogen.js',
  external: Object.keys(globals),
  // a warning means a broken bundle (e.g., an unlisted dependency or a circular require)
  onwarn: warning => {
    throw new Error(warning.message)
  },
  output: {
    name: 'ergogen',
    file: 'dist/ergogen.js',
    format: 'umd',
    banner: `/*!\n * Ergogen v${pkg.version}\n * https://ergogen.xyz\n */\n`,
    globals
  },
  plugins: [
    svg_outline_plugin(),
    json(),
    commonjs()
  ]
}