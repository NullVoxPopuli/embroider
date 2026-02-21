/*
  This is the node-specific runtime implementation for @embroider/macros.

  When running in Node.js (as opposed to the browser), we actually answer
  the questions each macro is meant to answer rather than throwing errors.
  This is used for things like running tests in Node, server-side rendering,
  or any other non-browser context.
*/

import { satisfies } from 'semver';
import resolve from 'resolve';
import { join } from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const nodeRequire = createRequire(__filename);

export function dependencySatisfies(packageName: string, semverRange: string): boolean {
  try {
    let packageJsonPath = resolve.sync(join(packageName, 'package.json'), { basedir: process.cwd() });
    let pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };
    return satisfies(pkg.version, semverRange, { includePrerelease: true });
  } catch (err: any) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return false;
    }
    throw err;
  }
}

export function appEmberSatisfies(semverRange: string): boolean {
  return dependencySatisfies('ember-source', semverRange);
}

export function macroCondition(predicate: boolean): boolean {
  return predicate;
}

export function each<T>(array: T[]): T[] {
  if (!Array.isArray(array)) {
    throw new Error(`the argument to the each() macro must be an array`);
  }
  return array;
}

export function importSync(specifier: string): unknown {
  return nodeRequire(specifier);
}

export function getConfig<T>(_packageName: string): T | undefined {
  return undefined;
}

export function getOwnConfig<T>(): T | undefined {
  return undefined;
}

export function getGlobalConfig<T>(): T {
  return {} as T;
}

export function isDevelopingApp(): boolean {
  return process.env['EMBER_ENV'] !== 'production';
}

export function isTesting(): boolean {
  return process.env['EMBER_ENV'] === 'test';
}

export function failBuild(message: string, ...params: unknown[]): never {
  let index = 0;
  throw new Error(message.replace(/%s/g, () => String(params[index++])));
}

export function moduleExists(packageName: string): boolean {
  try {
    resolve.sync(packageName, { basedir: process.cwd() });
    return true;
  } catch (err: any) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return false;
    }
    throw err;
  }
}
