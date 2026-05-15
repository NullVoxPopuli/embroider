/*
  This is the modern @embroider/webpack. It mirrors the architecture of
  @embroider/vite: the app keeps its real index.html / tests/index.html (with
  {{content-for}} placeholders and /@embroider/virtual/* references), the
  compat prebuild produces the .embroider working directory, and webpack
  bundles using @embroider/core's Resolver + virtual content.

  Just like the vite plugins mutate vite's config via the `config()` hook
  rather than owning the whole thing, `emberWebpack()` returns a webpack
  *plugin* that mutates `compiler.options`. Apps add it to an otherwise-normal
  webpack.config.js:

      const { emberWebpack } = require('@embroider/webpack');
      module.exports = {
        plugins: [emberWebpack()],
      };

  and wire `buildOnce` into their ember-cli-build.js via @embroider/compat's
  `compatBuild`.
*/

import { join } from 'path';
import { getPackagerCacheDir, type Variant } from '@embroider/core';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import type { Compiler, RuleSetRule } from 'webpack';
import { EmbroiderPlugin } from './webpack-resolver-plugin';
import { compatPrebuild, runCompatPrebuild } from './compat-prebuild';
import { discoverHtmlEntrypoints, HtmlOutputPlugin, type HtmlState } from './html-output-plugin';
import { AssetsPlugin } from './assets-plugin';
import type { Options } from './options';

// Matches vite's `extensions` export.
export const extensions = ['.mjs', '.gjs', '.js', '.mts', '.gts', '.ts', '.hbs', '.hbs.js', '.json'];

function emberEnv(mode: string | undefined): 'development' | 'test' | 'production' {
  let env = process.env.EMBER_ENV;
  if (env === 'production' || env === 'test' || env === 'development') {
    return env;
  }
  if (mode === 'production') {
    return 'production';
  }
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

// Mirrors vite's `shouldBuildTests`.
function shouldBuildTests(env: 'development' | 'test' | 'production'): boolean {
  let build = env !== 'production' || Boolean(process.env.FORCE_BUILD_TESTS);
  if (build) {
    process.env.EMBER_CLI_TEST_COMMAND = 'true';
  }
  return build;
}

export function emberWebpack(options: Options = {}): EmberWebpackPlugin {
  return new EmberWebpackPlugin(options);
}

class EmberWebpackPlugin {
  constructor(private options: Options) {}

  apply(compiler: Compiler) {
    const options = this.options;
    const opts = compiler.options;
    const appRoot = (opts.context as string) || process.cwd();
    const mode: 'production' | 'development' = opts.mode === 'production' ? 'production' : 'development';
    const env = emberEnv(opts.mode);
    const prebuildEnv = env === 'production' ? 'production' : 'development';
    const includeTests = shouldBuildTests(env);

    const publicAssetURL = options.publicAssetURL || '/';
    const outputPath = process.env.EMBROIDER_WEBPACK_OUTDIR
      ? join(appRoot, process.env.EMBROIDER_WEBPACK_OUTDIR)
      : opts.output?.path || join(appRoot, 'dist');

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appName: string = require(join(appRoot, 'package.json')).name;

    const variant: Variant = {
      name: mode,
      runtime: 'browser',
      optimizeForProduction: mode === 'production',
    };
    const babelLoaderOptions = {
      variant,
      appBabelConfigPath: join(appRoot, 'babel.config.cjs'),
      cacheDirectory: getPackagerCacheDir('webpack-babel-loader'),
      ...options.babelLoaderOptions,
    };
    const babelLoaderPrefix = `babel-loader-9?${JSON.stringify(babelLoaderOptions)}!`;

    const htmlState: HtmlState = { appRoot, publicAssetURL, records: [] };

    // ---- mutate the user's config (like vite's config() hook) ----

    opts.context = appRoot;
    if (opts.node === undefined) {
      opts.node = false;
    }
    if (opts.performance && typeof opts.performance === 'object') {
      opts.performance.hints ??= false;
    }

    // embroider owns entry. We set it to an async function (webpack supports
    // this) so the compat prebuild has produced resolver.json /
    // content-for.json before we discover the html entrypoints.
    opts.entry = (async () => {
      await runCompatPrebuild(prebuildEnv, extensions);
      return discoverHtmlEntrypoints(htmlState, includeTests);
    }) as unknown as typeof opts.entry;

    if (!opts.resolve.extensions || opts.resolve.extensions.length === 0) {
      opts.resolve.extensions = extensions;
    }

    let loaderAlias = {
      'babel-loader-9': require.resolve('@embroider/babel-loader-9'),
      'css-loader': require.resolve('css-loader'),
      'style-loader': require.resolve('style-loader'),
      'embroider-template-tag-loader': require.resolve('./template-tag-loader.js'),
      'embroider-hbs-loader': require.resolve('@embroider/hbs-loader'),
    };
    if (Array.isArray(opts.resolveLoader.alias)) {
      opts.resolveLoader.alias.push(...Object.entries(loaderAlias).map(([name, alias]) => ({ name, alias })));
    } else {
      opts.resolveLoader.alias = { ...loaderAlias, ...opts.resolveLoader.alias };
    }

    opts.optimization.splitChunks ??= { chunks: 'all' };

    opts.output.path = outputPath;
    opts.output.filename ??= 'assets/chunk.[contenthash].js';
    opts.output.chunkFilename ??= 'assets/chunk.[contenthash].js';
    opts.output.publicPath ??= publicAssetURL;
    opts.output.clean ??= true;

    // fastboot-only modules use top-level await import()
    (opts.experiments as { topLevelAwait?: boolean }).topLevelAwait ??= true;

    const cssLoader = {
      loader: 'css-loader',
      options: {
        url: true,
        import: true,
        modules: 'global',
        ...options.cssLoaderOptions,
      },
    };
    const rules: RuleSetRule[] = [
      {
        test: /\.hbs$/,
        use: [
          { loader: 'babel-loader-9', options: babelLoaderOptions },
          {
            loader: 'embroider-hbs-loader',
            options: {
              compatModuleNaming: {
                rootDir: appRoot,
                modulePrefix: appName,
              },
            },
          },
        ],
      },
      {
        test: /\.g[jt]s$/,
        use: [{ loader: 'babel-loader-9', options: babelLoaderOptions }, { loader: 'embroider-template-tag-loader' }],
      },
      {
        test: /\.m?[jt]s$/,
        exclude: /\.g[jt]s$/,
        use: [{ loader: 'babel-loader-9', options: babelLoaderOptions }],
      },
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, cssLoader],
      },
    ];
    opts.module.rules.push(...rules);

    // ---- apply the embroider sub-plugins ----

    compatPrebuild(prebuildEnv, extensions).apply(compiler);
    new EmbroiderPlugin(appRoot, babelLoaderPrefix).apply(compiler);
    new MiniCssExtractPlugin({
      filename: 'assets/chunk.[contenthash].css',
      chunkFilename: 'assets/chunk.[contenthash].css',
      ignoreOrder: true,
      ...options.cssPluginOptions,
    }).apply(compiler);
    new HtmlOutputPlugin(htmlState).apply(compiler);
    new AssetsPlugin(appRoot).apply(compiler);
  }
}
