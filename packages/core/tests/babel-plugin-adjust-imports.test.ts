import main, { isDefineExpression, Options as AdjustImportsOptions } from '../src/babel-plugin-adjust-imports';
import { transformSync } from '@babel/core';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

describe('babel-plugin-adjust-imports', function() {
  function getFirstCallExpresssionPath(source: string) {
    const ast: any = parse(source, { sourceType: 'module' });
    let path: any;

    traverse(ast, {
      CallExpression(_path: any) {
        if (path) {
          return;
        }
        path = _path;
      },
    });

    return path;
  }

  function isDefineExpressionFromSource(source: string) {
    return isDefineExpression(getFirstCallExpresssionPath(source));
  }

  test('isDefineExpression works', function() {
    expect(isDefineExpressionFromSource(`apple()`)).toBe(false);
    expect(isDefineExpressionFromSource(`(apple())`)).toBe(false);
    expect(isDefineExpressionFromSource(`(define('module', [], function() { }))`)).toBe(true);
    expect(isDefineExpressionFromSource(`define('module', [], function() {});`)).toBe(true);
    expect(isDefineExpressionFromSource(`define('foo', ['apple'], function() {});`)).toBe(true);
    expect(isDefineExpressionFromSource(`define;define('module', [], function() {});`)).toBe(true);
    expect(isDefineExpressionFromSource(`define;define('module', function() {});`)).toBe(false);
    expect(isDefineExpressionFromSource(`define;define('module');`)).toBe(false);
    expect(isDefineExpressionFromSource(`define;define(1, [], function() { });`)).toBe(false);
    expect(isDefineExpressionFromSource(`define;define('b/a/c', ['a', 'b', 'c'], function() { });`)).toBe(true);
    expect(isDefineExpressionFromSource(`import foo from 'foo'; define('apple')`)).toBe(false);
    expect(isDefineExpressionFromSource(`define('apple'); import foo from 'foo'`)).toBe(false);
  });

  test('main', function() {
    const options: AdjustImportsOptions = {
      activeAddons: {},
      renameModules: { a: 'c' },
      renamePackages: { module: 'other-module', apple: 'banana' },
      extraImports: [],
      relocatedFiles: {},
      externalsDir: 'test',
      resolvableExtensions: ['.js', '.hbs'],
    };

    {
      const { code } = transformSync(`define('module', ['a', 'b', 'c'], function() {})`, {
        plugins: [[main, options]],
        filename: 'some-file.js',
      }) as any;

      expect(code).toBe(`define("other-module", ["c", 'b', 'c'], function () {});`);
    }

    {
      const { code } = transformSync(`define('module', ['module/a', 'module/b', 'module/c'], function() {})`, {
        plugins: [[main, options]],
        filename: 'some-file.js',
      }) as any;

      expect(code).toBe(
        `define("other-module", ["other-module/a", "other-module/b", "other-module/c"], function () {});`
      );
    }

    {
      const { code } = transformSync(`import apple from 'apple'`, {
        plugins: [[main, options]],
        filename: 'some-file.js',
      }) as any;

      expect(code).toBe(`import apple from "banana";`);
    }
  });
});
