import { babel } from '@rollup/plugin-babel';
import { defineConfig } from 'tsdown';
import { Addon } from '@embroider/addon-dev/tsdown';

const addon = new Addon({
  srcDir: 'src',
  destDir: 'dist',
});

export default defineConfig({
  // Config-level options: ES output in `destDir`, declarations via tsdown's
  // `dts` (oxc isolated declarations, replacing the glint/ember-tsc step), and
  // the loader/hook tweaks needed for v2-addon asset handling.
  ...addon.output(),

  // The modules users should be able to import from your addon. Anything not
  // listed here may get optimized away.
  entry: addon.publicEntrypoints(['components/**/*.js', 'index.js']),

  plugins: [
    // These are the modules that should get reexported into the traditional
    // "app" tree. Things in here should also be in publicEntrypoints above.
    addon.appReexports(['components/welcome-page.js']),

    // Follow the v2 addon rules about dependencies.
    addon.dependencies(),

    // Integrate standalone .hbs files as Javascript.
    addon.hbs(),

    // Compile .gjs/.gts (and emit their declarations).
    addon.gjs(),

    // Keep .css imports as real files in the published output.
    addon.keepAssets(['**/*.css']),

    // Remove leftover build artifacts when starting a new build.
    addon.clean(),

    // This babel config should *not* apply presets or compile away ES modules.
    // It exists only for development niceties like template colocation. By
    // default it loads babel.config.json.
    babel({
      babelHelpers: 'bundled',
      extensions: ['.js', '.ts', '.gjs', '.gts', '.hbs'],
    }),
  ],
});
