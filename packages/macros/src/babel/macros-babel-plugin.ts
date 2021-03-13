import { NodePath } from '@babel/traverse';
import {
  CallExpression,
  Identifier,
  memberExpression,
  identifier,
  IfStatement,
  ConditionalExpression,
  ForOfStatement,
  FunctionDeclaration,
  OptionalMemberExpression,
  importSpecifier,
  importDeclaration,
  Program,
  stringLiteral,
  importNamespaceSpecifier,
} from '@babel/types';
import { PackageCache } from '@embroider/core';
import State, { sourceFile, pathToRuntime } from './state';
import { inlineRuntimeConfig, insertConfig, Mode as GetConfigMode } from './get-config';
import macroCondition, { isMacroConditionPath } from './macro-condition';
import { isEachPath, insertEach } from './each';

import error from './error';
import failBuild from './fail-build';
import { Evaluator, buildLiterals } from './evaluate-json';

const packageCache = PackageCache.shared('embroider-stage3');

export default function main(context: unknown): unknown {
  let visitor = {
    Program: {
      enter(_: NodePath<Program>, state: State) {
        state.generatedRequires = new Set();
        state.jobs = [];
        state.removed = new Set();
        state.calledIdentifiers = new Set();
        state.neededRuntimeImports = new Map();
        state.neededEagerImports = new Map();
      },
      exit(path: NodePath<Program>, state: State) {
        pruneMacroImports(path);
        addRuntimeImports(path, state);
        addEagerImports(path, state);
        for (let handler of state.jobs) {
          handler();
        }
      },
    },
    'IfStatement|ConditionalExpression': {
      enter(path: NodePath<IfStatement | ConditionalExpression>, state: State) {
        if (isMacroConditionPath(path)) {
          state.calledIdentifiers.add(path.get('test').get('callee').node);
          macroCondition(path, state);
        }
      },
    },
    ForOfStatement: {
      enter(path: NodePath<ForOfStatement>, state: State) {
        if (isEachPath(path)) {
          state.calledIdentifiers.add(path.get('right').get('callee').node);
          insertEach(path, state);
        }
      },
    },
    FunctionDeclaration: {
      enter(path: NodePath<FunctionDeclaration>, state: State) {
        let id = path.get('id');
        if (id.isIdentifier() && id.node.name === 'initializeRuntimeMacrosConfig') {
          let pkg = packageCache.ownerOfFile(sourceFile(path, state));
          if (pkg && pkg.name === '@embroider/macros') {
            inlineRuntimeConfig(path, state);
          }
        }
      },
    },
    CallExpression: {
      enter(path: NodePath<CallExpression>, state: State) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }

        // failBuild is implemented for side-effect, not value, so it's not
        // handled by evaluateMacroCall.
        if (callee.referencesImport('@embroider/macros', 'failBuild')) {
          state.calledIdentifiers.add(callee.node);
          failBuild(path, state);
          return;
        }

        if (callee.referencesImport('@embroider/macros', 'importSync')) {
          if (state.opts.importSyncImplementation === 'eager') {
            let specifier = path.node.arguments[0];
            if (specifier?.type !== 'StringLiteral') {
              throw new Error(`importSync eager mode doesn't implement non string literal arguments yet`);
            }
            let replacePaths = state.neededEagerImports.get(specifier.value);
            if (!replacePaths) {
              replacePaths = [];
              state.neededEagerImports.set(specifier.value, replacePaths);
            }
            replacePaths.push(path);
            state.calledIdentifiers.add(callee.node);
          } else {
            let r = identifier('require');
            state.generatedRequires.add(r);
            callee.replaceWith(r);
          }
          return;
        }

        // getOwnConfig/getGlobalConfig/getConfig needs special handling, so
        // even though it also emits values via evaluateMacroCall when they're
        // needed recursively by other macros, it has its own insertion-handling
        // code that we invoke here.
        //
        // The things that are special include:
        //  - automatic collapsing of chained properties, etc
        //  - these macros have runtime implementations sometimes, which changes
        //    how we rewrite them
        let mode: GetConfigMode | false = callee.referencesImport('@embroider/macros', 'getOwnConfig')
          ? 'own'
          : callee.referencesImport('@embroider/macros', 'getGlobalConfig')
          ? 'getGlobalConfig'
          : callee.referencesImport('@embroider/macros', 'getConfig')
          ? 'package'
          : false;
        if (mode) {
          state.calledIdentifiers.add(callee.node);
          insertConfig(path, state, mode);
          return;
        }

        // isTesting can have a runtime implementation. At compile time it
        // instead falls through to evaluateMacroCall.
        if (callee.referencesImport('@embroider/macros', 'isTesting') && state.opts.mode === 'run-time') {
          state.calledIdentifiers.add(callee.node);
          state.neededRuntimeImports.set(callee.node.name, 'isTesting');
          return;
        }

        let result = new Evaluator({ state }).evaluateMacroCall(path);
        if (result.confident) {
          state.calledIdentifiers.add(callee.node);
          path.replaceWith(buildLiterals(result.value));
        }
      },
      exit(path: NodePath<CallExpression>, state: State) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        // importSync doesn't evaluate to a static value, so it's implemented
        // directly here, not in evaluateMacroCall.
        // We intentionally do this on exit here, to allow other transforms to handle importSync before we do
        // For example ember-auto-import needs to do some custom transforms to enable use of dynamic template strings,
        // so its babel plugin needs to see and handle the importSync call first!
        if (callee.referencesImport('@embroider/macros', 'importSync')) {
          let r = identifier('require');
          state.generatedRequires.add(r);
          callee.replaceWith(r);
          return;
        }
      },
    },
    ReferencedIdentifier(path: NodePath<Identifier>, state: State) {
      for (let candidate of [
        'dependencySatisfies',
        'moduleExists',
        'getConfig',
        'getOwnConfig',
        'failBuild',
        // we cannot check importSync, as the babel transform runs on exit, so *after* this check
        // 'importSync',
        'isDevelopingApp',
        'isDevelopingThisPackage',
        'isTesting',
      ]) {
        if (path.referencesImport('@embroider/macros', candidate) && !state.calledIdentifiers.has(path.node)) {
          throw error(path, `You can only use ${candidate} as a function call`);
        }
      }

      if (path.referencesImport('@embroider/macros', 'macroCondition') && !state.calledIdentifiers.has(path.node)) {
        throw error(path, `macroCondition can only be used as the predicate of an if statement or ternary expression`);
      }

      if (path.referencesImport('@embroider/macros', 'each') && !state.calledIdentifiers.has(path.node)) {
        throw error(
          path,
          `the each() macro can only be used within a for ... of statement, like: for (let x of each(thing)){}`
        );
      }

      if (state.opts.owningPackageRoot) {
        // there is only an owningPackageRoot when we are running inside a
        // classic ember-cli build. In the embroider stage3 build, there is no
        // owning package root because we're compiling *all* packages
        // simultaneously.
        //
        // given that we're inside classic ember-cli, stop here without trying
        // to rewrite bare `require`. It's not needed, because both our
        // `importSync` and any user-written bare `require` can both mean the
        // same thing: runtime AMD `require`.
        return;
      }

      if (
        path.node.name === 'require' &&
        !state.generatedRequires.has(path.node) &&
        !path.scope.hasBinding('require') &&
        ownedByEmberPackage(path, state)
      ) {
        // Our importSync macro has been compiled to `require`. But we want to
        // distinguish that from any pre-existing, user-written `require` in an
        // Ember addon, which should retain its *runtime* meaning.
        path.replaceWith(memberExpression(identifier('window'), path.node));
      }
    },
  };

  if ((context as any).types.OptionalMemberExpression) {
    // our getConfig and getOwnConfig macros are supposed to be able to absorb
    // optional chaining. To make that work we need to see the optional chaining
    // before preset-env compiles them away.
    (visitor as any).OptionalMemberExpression = {
      enter(path: NodePath<OptionalMemberExpression>, state: State) {
        if (state.opts.mode === 'compile-time') {
          let result = new Evaluator({ state }).evaluate(path);
          if (result.confident) {
            path.replaceWith(buildLiterals(result.value));
          }
        }
      },
    };
  }

  return { visitor };
}

// This removes imports from "@embroider/macros" itself, because we have no
// runtime behavior at all.
function pruneMacroImports(path: NodePath) {
  if (!path.isProgram()) {
    return;
  }
  for (let topLevelPath of path.get('body')) {
    if (topLevelPath.isImportDeclaration() && topLevelPath.get('source').node.value === '@embroider/macros') {
      topLevelPath.remove();
    }
  }
}

function addRuntimeImports(path: NodePath<Program>, state: State) {
  if (state.neededRuntimeImports.size > 0) {
    path.node.body.push(
      importDeclaration(
        [...state.neededRuntimeImports].map(([local, imported]) =>
          importSpecifier(identifier(local), identifier(imported))
        ),
        stringLiteral(pathToRuntime(path, state))
      )
    );
  }
}

function addEagerImports(path: NodePath<Program>, state: State) {
  let createdNames = new Set<string>();
  for (let [specifier, replacePaths] of state.neededEagerImports.entries()) {
    let local = unusedNameLike('a', replacePaths, createdNames);
    createdNames.add(local);
    path.node.body.push(importDeclaration([importNamespaceSpecifier(identifier(local))], stringLiteral(specifier)));
    for (let nodePath of replacePaths) {
      nodePath.replaceWith(identifier(local));
    }
  }
}

function ownedByEmberPackage(path: NodePath, state: State) {
  let filename = sourceFile(path, state);
  let pkg = packageCache.ownerOfFile(filename);
  return pkg && pkg.isEmberPackage();
}

function unusedNameLike(name: string, paths: NodePath<unknown>[], banned: Set<string>) {
  let candidate = name;
  let counter = 0;
  while (banned.has(candidate) || paths.some(path => path.scope.getBinding(candidate))) {
    candidate = `${name}${counter++}`;
  }
  return candidate;
}
