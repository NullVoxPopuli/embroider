import { join } from 'path';
import 'jest';
import { transform as transform6, TransformOptions as Options6 } from 'babel-core';
import { transform as transform7, TransformOptions as Options7 } from '@babel/core';
import escapeRegExp from 'lodash/escapeRegExp';
import { createContext, Script } from 'vm';

interface RunDefaultOptions {
  dependencies?: { [name: string]: any };
}

export function toJS(code: string): string {
  return transform7(code, {
    plugins: ['@babel/plugin-transform-typescript'],
  })!.code!;
}

export function toCJS(code: string): string {
  return transform7(code, {
    plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-typescript'],
  })!.code!;
}

export function runDefault(code: string, opts: RunDefaultOptions = {}): any {
  let cjsCode = toCJS(code);

  function myRequire(name: string): any {
    if (opts.dependencies && opts.dependencies[name]) {
      return opts.dependencies[name];
    }
    return require(name);
  }

  let context = createContext({
    exports: {},
    require: myRequire,
  });
  let script = new Script(cjsCode);
  script.runInContext(context);
  return context.exports.default();
}

function presetsFor(major: 6 | 7) {
  return [
    [
      require.resolve(major === 6 ? 'babel-preset-env' : '@babel/preset-env'),
      {
        modules: false,
        targets: {
          ie: '11.0.0',
        },
      },
    ],
  ];
}

export interface Transform {
  (code: string, opts?: { filename?: string }): string;
  babelMajorVersion: 6 | 7;
  usingPresets: boolean;
}

export function allBabelVersions(params: {
  babelConfig(major: 6): Options6;
  babelConfig(major: 7): Options7;
  createTests(transform: Transform): void;
  includePresetsTests?: boolean;
}) {
  function versions(usePresets: boolean) {
    describe('babel6', function() {
      function transform(code: string, opts?: { filename?: string }) {
        let options6: Options6 = params.babelConfig(6);
        if (!options6.filename) {
          options6.filename = 'sample.js';
        }
        if (usePresets) {
          options6.presets = presetsFor(6);
        }
        if (opts && opts.filename) {
          options6.filename = opts.filename;
        }
        return transform6(code, options6).code!;
      }
      transform.babelMajorVersion = 6 as 6;
      transform.usingPresets = usePresets;
      params.createTests(transform);
    });

    describe('babel7', function() {
      function transform(code: string, opts?: { filename?: string }) {
        let options7: Options7 = params.babelConfig(7);
        if (!options7.filename) {
          options7.filename = 'sample.js';
        }
        if (usePresets) {
          options7.presets = presetsFor(7);
        }
        if (opts && opts.filename) {
          options7.filename = opts.filename;
        }

        return transform7(code, options7)!.code!;
      }
      transform.babelMajorVersion = 7 as 7;
      transform.usingPresets = usePresets;
      params.createTests(transform);
    });
  }

  if (params.includePresetsTests) {
    describe('with presets', function() {
      versions(true);
    });
    describe('without presets', function() {
      versions(false);
    });
  } else {
    versions(false);
  }
}

export function emberTemplateCompilerPath() {
  return join(__dirname, 'vendor', 'ember-template-compiler.js');
}

export function definesPattern(runtimeName: string, buildTimeName: string): RegExp {
  runtimeName = escapeRegExp(runtimeName);
  buildTimeName = escapeRegExp(buildTimeName);
  return new RegExp(
    `d\\(['"]${runtimeName}['"], *function *\\(\\) *\\{[\\s\\n]*return require\\(['"]${buildTimeName}['"]\\);?[\\s\\n]*\\}\\)`
  );
}

export { Project } from './project';
export { default as BuildResult } from './build';
export { expectFilesAt, ExpectFile } from './file-assertions';
