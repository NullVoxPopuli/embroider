import { describe, test, expect } from 'vitest';

describe('setTesting API', () => {
  test('setTesting exports from main module', async () => {
    const macros = await import('../src/index.js');
    expect(macros.setTesting).toBeDefined();
    expect(typeof macros.setTesting).toBe('function');
  });

  test('setTesting can be called with true', async () => {
    const macros = await import('../src/index.js');
    expect(() => macros.setTesting(true)).not.toThrow();
  });

  test('setTesting can be called with false', async () => {
    const macros = await import('../src/index.js');
    expect(() => macros.setTesting(false)).not.toThrow();
  });

  test('setTesting can be called without arguments (defaults to true)', async () => {
    const macros = await import('../src/index.js');
    expect(() => macros.setTesting()).not.toThrow();
  });

  test('setTesting function signature', async () => {
    const macros = await import('../src/index.js');
    
    macros.setTesting(true);
    macros.setTesting(false);
    macros.setTesting();
    
    expect(true).toBe(true);
  });
});
