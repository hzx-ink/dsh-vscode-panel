import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
}

if (watch) {
  const context = await esbuild.context(options)
  await context.watch()
  console.log('watching…')
} else {
  await esbuild.build(options)
}
