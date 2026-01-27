/**
 * Test support utilities for @embroider/macros
 * 
 * This module provides public APIs for configuring macros in test environments.
 */

import { setTesting as setTestingRuntime } from './addon/runtime';

/**
 * Sets the testing mode flag for the isTesting() macro.
 * This should be called early in your test setup to enable test-only code paths.
 * 
 * @param value - true to enable testing mode, false to disable it
 * 
 * @example
 * ```js
 * import { setTesting } from '@embroider/macros/test-support';
 * 
 * // In your test setup file:
 * setTesting(true);
 * ```
 */
export function setTesting(value: boolean = true): void {
  setTestingRuntime(value);
}
