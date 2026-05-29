import path from 'path';
import type { UserConfig } from 'tsdown';
import type { Plugin } from 'rolldown';
import { Addon as RollupAddon } from './rollup';
import { discoverEntrypoints } from './entrypoints';
import { emberGtsResolve, fixDtsExtensions } from './tsdown-gts-resolve';

// rolldown assigns `.css` (and friends) the `css` module type and refuses to
// bundle them. v2 addons preserve CSS as-is (via `keepAssets`), so we treat
// those extensions as `js` and let keepAssets' load/transform capture the
// source and replace it with a marker before it is parsed.
const CSS_LIKE = ['.css', '.less', '.sass', '.scss', '.styl', '.stylus'];

// The rollup `keepAssets` plugin's `load`/`transform` rely on rollup's
// fall-through hook ordering. Under rolldown, tsdown registers internal plugins
// whose normal-order `load` would otherwise read the asset (as UTF-8) before
// keepAssets can claim it, so we re-register keepAssets' hooks at `order: 'pre'`.
function asPreLoad(plugin: unknown): unknown {
  const wrapped: Record<string, unknown> = { ...(plugin as object) };
  for (const hook of ['load', 'transform'] as const) {
    const fn = (plugin as Record<string, unknown>)[hook];
    if (typeof fn === 'function') {
      wrapped[hook] = { order: 'pre', handler: fn };
    }
  }
  return wrapped;
}

export interface OutputOptions {
  // Whether to emit `.d.ts` declarations via tsdown. Defaults to `true`.
  declarations?: boolean;
  // Additional module-type (loader) overrides, for custom asset extensions
  // handled by your own plugins (e.g. `{ '.xyz': 'js' }`).
  loader?: Record<string, string>;
}

// The tsdown counterpart of `@embroider/addon-dev/rollup`'s `Addon`. It exposes
// the same plugins (which work under rolldown) plus tsdown-specific helpers:
// `output()` for the config-level options and `publicEntrypoints()` for the
// `entry` map. Declarations are emitted by tsdown's `dts` (oxc isolated
// declarations) instead of a separate glint/ember-tsc step.
export class Addon {
  #rollup: RollupAddon;
  #srcDir: string;
  #destDir: string;

  constructor(params: { srcDir?: string; destDir?: string } = {}) {
    this.#rollup = new RollupAddon(params);
    this.#srcDir = this.#rollup.srcDir;
    this.#destDir = this.#rollup.destDir;
  }

  // The config-level tsdown options. Spread this into your `defineConfig`:
  //
  //   export default defineConfig({
  //     ...addon.output(),
  //     entry: addon.publicEntrypoints(['components/**/*.js']),
  //     plugins: [ ... ],
  //   });
  output(options: OutputOptions = {}): UserConfig {
    const loader: Record<string, string> = {};
    for (const ext of CSS_LIKE) {
      loader[ext] = 'js';
    }
    Object.assign(loader, options.loader);

    return {
      // Multi-entry code-splitting (NOT `unbundle`/`preserveModules`), matching
      // rollup: each public entrypoint is its own chunk and single-use private
      // modules (compiled colocated templates, babel helpers) inline into their
      // consumer. `preserveEntrySignatures: 'allow-extension'` keeps each
      // entrypoint importable while letting one entrypoint import another
      // directly, without rolldown's default facade + hashed shared chunk.
      inputOptions: {
        preserveEntrySignatures: 'allow-extension',
      },
      format: 'es',
      sourcemap: true,
      outDir: this.#destDir,
      // `clean()` owns incremental dist diffing; don't let tsdown wipe outDir.
      clean: false,
      // `oxc: true` forces oxc-powered isolated declarations, which operate on
      // the (content-tag compiled) source the gjs plugin's `load` hook returns
      // rather than reading `.gts`/`.gjs` from disk via the TypeScript compiler.
      dts: options.declarations === false ? false : { oxc: true },
      outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
      loader: loader as UserConfig['loader'],
      // The addon owns asset handling (incl. CSS), so remove tsdown's built-in
      // CSS guard, which would otherwise throw on any `.css` module before
      // keepAssets can preserve it.
      hooks: {
        'build:before'(ctx: { buildOptions: { plugins?: unknown } }) {
          const opts = ctx.buildOptions;
          if (Array.isArray(opts.plugins)) {
            opts.plugins = opts.plugins.filter(
              (p) =>
                !(
                  p &&
                  typeof p === 'object' &&
                  (p as { name?: string }).name === 'tsdown:css-guard'
                )
            );
          }
        },
      },
    } as UserConfig;
  }

  // Returns the tsdown `entry` map for the given public-entrypoint globs (the
  // same patterns you would pass to the rollup `addon.publicEntrypoints`).
  publicEntrypoints(
    patterns: string[],
    opts: { exclude?: string[] } = {}
  ): Record<string, string> {
    const entry: Record<string, string> = {};
    for (const { idName, fileName } of discoverEntrypoints({
      srcDir: this.#srcDir,
      include: patterns,
      exclude: opts.exclude,
    })) {
      entry[fileName.replace(/\.js$/, '')] = path.resolve(this.#srcDir, idName);
    }
    return entry;
  }

  // Reexports into the traditional "app" tree (reused rollup plugin).
  appReexports(...args: Parameters<RollupAddon['appReexports']>): Plugin {
    return this.#rollup.appReexports(...args) as unknown as Plugin;
  }

  // Standalone `.hbs` handling (reused rollup plugin).
  hbs(options?: Parameters<RollupAddon['hbs']>[0]): Plugin {
    return this.#rollup.hbs(options) as unknown as Plugin;
  }

  // Handles `.gjs`/`.gts`: compiles `<template>` (content-tag) and presents the
  // files to rolldown as TS/JS so declarations can be emitted, plus strips
  // `.gts` extensions from the emitted `.d.ts`.
  gjs(): Plugin[] {
    return [emberGtsResolve(), fixDtsExtensions(this.#destDir)];
  }

  // Preserve non-JS assets in the published output (reused rollup plugin, run
  // at `order: 'pre'` so it claims assets before tsdown's internal loaders).
  keepAssets(...args: Parameters<RollupAddon['keepAssets']>): Plugin {
    return asPreLoad(this.#rollup.keepAssets(...args)) as Plugin;
  }

  // Follow the v2 addon dependency rules (reused rollup plugin).
  dependencies(): Plugin {
    return this.#rollup.dependencies() as unknown as Plugin;
  }

  // Incremental dist diffing / cleanup (reused rollup plugin).
  clean(): Plugin {
    return this.#rollup.clean() as unknown as Plugin;
  }

  // Expose a folder of public assets (reused rollup plugin).
  publicAssets(...args: Parameters<RollupAddon['publicAssets']>): Plugin {
    return this.#rollup.publicAssets(...args) as unknown as Plugin;
  }
}
