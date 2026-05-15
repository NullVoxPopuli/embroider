/*
  This is the modern @embroider/webpack. It mirrors the architecture of
  @embroider/vite: the app keeps its real index.html / tests/index.html (with
  {{content-for}} placeholders and /@embroider/virtual/* references), the
  compat prebuild produces the .embroider working directory, and this config
  drives webpack using @embroider/core's Resolver + virtual content.

  Apps consume this from a webpack.config.js:

      const { emberWebpack } = require('@embroider/webpack');
      module.exports = emberWebpack();

  and wire `buildOnce` into their ember-cli-build.js via @embroider/compat's
  `compatBuild`.
*/

import { join } from 'path';
import { getPackagerCacheDir, type Variant } from '@embroider/core';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import type { Configuration } from 'webpack';
import { EmbroiderPlugin } from './webpack-resolver-plugin';
import { compatPrebuild, runCompatPrebuild } from './compat-prebuild';
import { discoverHtmlEntrypoints, HtmlOutputPlugin, type HtmlState } from './html-output-plugin';
import { AssetsPlugin } from './assets-plugin';
import type { Options } from './options';

// Matches vite's `extensions` export.
export const extensions = ['.mjs', '.gjs', '.js', '.mts', '.gts', '.ts', '.hbs', '.hbs.js', '.json'];

function emberEnv(argvMode: string | undefined): 'development' | 'test' | 'production' {
  let env = process.env.EMBER_ENV;
  if (env === 'production' || env === 'test' || env === 'development') {
    return env;
  }
  if (argvMode === 'production') {
    return 'production';
  }
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

// Mirrors vite's `shouldBuildTests`.
function shouldBuildTests(mode: string): boolean {
  let build = mode !== 'production' || Boolean(process.env.FORCE_BUILD_TESTS);
  if (build) {
    process.env.EMBER_CLI_TEST_COMMAND = 'true';
  }
  return build;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge user webpackConfig over our defaults, concatenating arrays (so
// extra rules/plugins are appended rather than replacing ours).
function mergeConfig<T>(base: T, override: unknown): T {
  if (Array.isArray(base) && Array.isArray(override)) {
    return base.concat(override) as unknown as T;
  }
  if (isPlainObject(base) && isPlainObject(override)) {
    let out: Record<string, unknown> = { ...base };
    for (let key of Object.keys(override)) {
      out[key] = key in base ? mergeConfig((base as Record<string, unknown>)[key], override[key]) : override[key];
    }
    return out as unknown as T;
  }
  return (override === undefined ? base : override) as T;
}

export function emberWebpack(options: Options = {}): (env: unknown, argv: { mode?: string }) => Configuration {
  return (_env: unknown, argv: { mode?: string } = {}) => buildConfig(options, argv.mode);
}

function buildConfig(options: Options, argvMode: string | undefined): Configuration {
  const appRoot = process.cwd();
  const env = emberEnv(argvMode);
  const mode: 'production' | 'development' = env === 'production' ? 'production' : 'development';
  const includeTests = shouldBuildTests(env === 'test' ? 'development' : env === 'production' ? 'production' : env);

  const outputPath = process.env.EMBROIDER_WEBPACK_OUTDIR
    ? join(appRoot, process.env.EMBROIDER_WEBPACK_OUTDIR)
    : join(appRoot, 'dist');

  const publicAssetURL = options.publicAssetURL || '/';

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const appName: string = require(join(appRoot, 'package.json')).name;

  const variant: Variant = {
    name: mode === 'production' ? 'production' : 'development',
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

  const cssLoader = {
    loader: 'css-loader',
    options: {
      url: true,
      import: true,
      modules: 'global',
      ...options.cssLoaderOptions,
    },
  };

  const defaults: Configuration = {
    mode,
    context: appRoot,
    // Entry is computed after the compat prebuild has run (so resolver.json /
    // content-for.json exist). Webpack supports an async entry function.
    entry: async () => {
      await runCompatPrebuild(env === 'production' ? 'production' : 'development', extensions);
      return discoverHtmlEntrypoints(htmlState, includeTests);
    },
    performance: { hints: false },
    node: false,
    output: {
      path: outputPath,
      filename: 'assets/chunk.[contenthash].js',
      chunkFilename: 'assets/chunk.[contenthash].js',
      publicPath: publicAssetURL,
      clean: true,
    },
    optimization: {
      splitChunks: {
        chunks: 'all',
      },
    },
    resolve: {
      extensions,
    },
    resolveLoader: {
      alias: {
        'babel-loader-9': require.resolve('@embroider/babel-loader-9'),
        'css-loader': require.resolve('css-loader'),
        'style-loader': require.resolve('style-loader'),
        'embroider-template-tag-loader': require.resolve('./template-tag-loader.js'),
        'embroider-hbs-loader': require.resolve('@embroider/hbs-loader'),
      },
    },
    module: {
      rules: [
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
      ],
    },
    plugins: [
      compatPrebuild(env === 'production' ? 'production' : 'development', extensions),
      new EmbroiderPlugin(appRoot, babelLoaderPrefix),
      new MiniCssExtractPlugin({
        filename: 'assets/chunk.[contenthash].css',
        chunkFilename: 'assets/chunk.[contenthash].css',
        ignoreOrder: true,
        ...options.cssPluginOptions,
      }),
      new HtmlOutputPlugin(htmlState),
      new AssetsPlugin(appRoot),
    ],
    experiments: {
      // fastboot-only modules use top-level await import()
      topLevelAwait: true,
    },
  };

  if (options.webpackConfig) {
    return mergeConfig(defaults, options.webpackConfig);
  }
  return defaults;
}
