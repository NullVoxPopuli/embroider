# @embroider/addon-dev

Utilities for working on v2 addons.

For a guide on porting a V1 addon to V2, see https://github.com/embroider-build/embroider/blob/main/docs/porting-addons-to-v2.md

## Rollup Utilities

`@embroider/addon-dev/rollup` exports utilities for building addons with rollup. To use them:

1. Add the following `devDependencies` to your addon:

   - @embroider/addon-dev
   - rollup
   - @babel/core
   - @rollup/plugin-babel

2. Copy the `./sample-rollup.config.js` in this repo to your own `rollup.config.js`.
3. Copy the `./sample-babel.config.json` in this repo to your own `babel.config.json`.

### addon.publicAssets(path <required>, options)

A rollup plugin to expose a folder of assets. `path` is a required to define which folder to expose. `options.include` is a glob pattern passed to `walkSync.include` to pick files. `options.exlude` is a glob pattern passed to `walkSync.ignore` to exclude files. `options.namespace` is the namespace to expose files, defaults to the package name + the path that you provided e.g. if you call `addon.publicAssets('public')` in a v2 addon named `super-addon` then your namespace will default to `super-addon/public`.

### addon.keepAssets(patterns: string[], exports?: 'default' | '*')

A rollup plugin to preserve imports of non-Javascript assets unchanged in your published package. For example, the v2-addon-blueprint uses:

```js
addon.keepAssets(['**/*.css'])
```

so that the line `import "./my.css"` in your addon will be preserved and the corresponding CSS file will get included at the right path. 

`keepAssets` is intended to compose correctly with other plugins that synthesize CSS imports, like `glimmer-scoped-css`. It will capture their output and produce real CSS files in your published package.

The `exports` option defaults to `undefined` which means the assets are used for side-effect only and don't export any values. This is the supported way to use CSS in v2 addons. But you can also preserve assets that present themselves as having default exports with the value `"default"` or arbitrary named exports with the value `"*"`. For example:

```js
addon.keepAssets(["**/*.png"], "default")
```

lets you say `import imageURL from './my-image.png'`. Not that this pattern is **not** automatically supported in V2 addons and you would need to tell apps that consume your addon to handle it in a custom way.

## tsdown Utilities

`@embroider/addon-dev/tsdown` exports an `Addon` class for building addons with [tsdown](https://tsdown.dev) (the [rolldown](https://rolldown.rs)-powered library bundler). It mirrors `@embroider/addon-dev/rollup`'s `Addon` — the same plugins, used in a normal tsdown [`defineConfig`](https://tsdown.dev/guide/getting-started) — but produces declarations via tsdown's built-in `dts` (oxc isolated declarations) instead of a separate glint/ember-tsc step.

To use it:

1. Add the following `devDependencies` to your addon:

   - @embroider/addon-dev
   - tsdown
   - content-tag

2. Copy the `./sample-tsdown.config.js` in this repo to your own `tsdown.config.js`.

```js
import { defineConfig } from 'tsdown';
import { Addon } from '@embroider/addon-dev/tsdown';

const addon = new Addon({ srcDir: 'src', destDir: 'dist' });

export default defineConfig({
  ...addon.output(),
  entry: addon.publicEntrypoints(['components/**/*.js', 'index.js']),
  plugins: [
    addon.appReexports(['components/welcome-page.js']),
    addon.dependencies(),
    addon.hbs(),
    addon.gjs(),
    addon.keepAssets(['**/*.css']),
    addon.clean(),
  ],
});
```

Unlike the rollup setup, **babel is not required** for `.gjs`/`.gts`/`.ts` addons: rolldown/oxc strips TypeScript, and `addon.gjs()` (content-tag) compiles `<template>`. You only need babel — `@babel/core`, `@rollup/plugin-babel`, a `babel.config.json`, and the relevant babel plugins — when your addon uses **co-located `.hbs`** components (`@embroider/addon-dev/template-colocation-plugin`) or custom template transforms (`babel-plugin-ember-template-compilation`). In that case add a babel plugin to the `plugins` array, e.g.:

```js
import { babel } from '@rollup/plugin-babel';
// ...plugins: [ ..., babel({ babelHelpers: 'bundled', extensions: ['.js', '.ts', '.gjs', '.gts', '.hbs'] }) ]
```

The `Addon` exposes:

- `output(options?)` — the config-level tsdown options to spread into `defineConfig` (ES output, declarations, and the loader/hook tweaks for v2-addon asset handling). Options: `declarations?: boolean` (emit `.d.ts`, default `true`) and `loader?: Record<string, string>` (module-type overrides for custom asset extensions handled by your own plugins, e.g. `{ '.xyz': 'js' }`).
- `publicEntrypoints(patterns, { exclude? })` — returns the tsdown `entry` map for the given globs.
- `appReexports`, `dependencies`, `hbs`, `gjs`, `keepAssets`, `publicAssets`, `clean` — the same plugins as the rollup `Addon`, working under rolldown.

### Watch mode

`tsdown --watch` rebuilds your addon as you edit source files. The set of public
entrypoints is discovered once, when the config is evaluated, so *adding or
removing* a public-entrypoint file is not picked up until you restart the
watcher. Editing existing files works as expected.

### Declarations

Declarations are generated by oxc's [isolated declarations](https://www.typescriptlang.org/tsconfig/#isolatedDeclarations). The `<template>` in `.gts`/`.gjs` files is stripped (via `content-tag`) before declarations are emitted, so the exported class and signature types are preserved, but glint's template-aware type checking is **not** performed as part of the build. Because isolated declarations cannot infer types, every exported value must have an explicit type annotation (e.g. an explicit return type on exported functions and getters). Run glint separately (e.g. in CI / your editor) for full template type checking.

## addon-dev command

The `addon-dev` command helps with common tasks in v2 addons.

- linking up a test application that is embedded within your addon's repo
- synchronizing `devDependencies` from an embedded test application out into
  your addon's actual package.json

(You can avoid the need for both of these if you keep your addon and its test app as separate packages in a monorepo instead.)

## Contributing

See the top-level CONTRIBUTING.md in this monorepo.

## License

This project is licensed under the MIT License.
