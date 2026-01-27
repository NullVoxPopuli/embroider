import { describe, test, expect } from 'vitest';

describe('setTesting API', () => {
  test('setTesting exports from test-support', async () => {
    // Use dynamic import to ensure we get the compiled JS version
    const testSupport = await import('../src/test-support.js');
    expect(testSupport.setTesting).toBeDefined();
    expect(typeof testSupport.setTesting).toBe('function');
  });

  test('setTesting can be called with true', async () => {
    const testSupport = await import('../src/test-support.js');
    expect(() => testSupport.setTesting(true)).not.toThrow();
  });

  test('setTesting can be called with false', async () => {
    const testSupport = await import('../src/test-support.js');
    expect(() => testSupport.setTesting(false)).not.toThrow();
  });

  test('setTesting can be called without arguments (defaults to true)', async () => {
    const testSupport = await import('../src/test-support.js');
    expect(() => testSupport.setTesting()).not.toThrow();
  });

  test('setTesting function signature', async () => {
    // Verify that setTesting accepts boolean or undefined
    const testSupport = await import('../src/test-support.js');
    
    // Should accept true
    testSupport.setTesting(true);
    
    // Should accept false  
    testSupport.setTesting(false);
    
    // Should accept no arguments (defaults to true)
    testSupport.setTesting();
    
    expect(true).toBe(true); // Test passes if no errors thrown
  });
});
