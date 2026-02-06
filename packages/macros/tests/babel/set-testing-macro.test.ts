import { allBabelVersions } from '@embroider/test-support';
import { makeBabelConfig, allModes, makeRunner } from './helpers';
import { MacrosConfig } from '../../src/node';
import { resolve } from 'path';

describe(`setTesting macro`, function () {
  let macrosConfig: MacrosConfig;

  allBabelVersions({
    babelConfig(version: number) {
      return makeBabelConfig(version, macrosConfig);
    },
    includePresetsTests: true,
    createTests: allModes(function (transform, { applyMode, runTimeTest, buildTimeTest }) {
      let run: ReturnType<typeof makeRunner>;

      beforeEach(function () {
        macrosConfig = MacrosConfig.for({}, resolve(__dirname, '..', '..'));
        applyMode(macrosConfig);
        macrosConfig.finalize();
        run = makeRunner(transform);
      });

      runTimeTest('setTesting: can be called in runtime mode', () => {
        let code = transform(`
          import { setTesting } from '@embroider/macros';
          export default function() {
            setTesting(true);
            return true;
          }
        `);
        // Should transform to runtime import
        expect(code).toMatch(/from ['"].*runtime['"]/);
        expect(run(code)).toBe(true);
      });

      runTimeTest('setTesting: can be called with false in runtime mode', () => {
        let code = transform(`
          import { setTesting } from '@embroider/macros';
          export default function() {
            setTesting(false);
            return true;
          }
        `);
        expect(code).toMatch(/from ['"].*runtime['"]/);
        expect(run(code)).toBe(true);
      });

      buildTimeTest('setTesting: removed in build-time mode when value matches global config', () => {
        // Default global config has isTesting = false
        let code = transform(`
          import { setTesting } from '@embroider/macros';
          export default function() {
            setTesting(false);
          }
        `);
        // In build-time mode, setTesting call should be removed if value matches
        expect(code).not.toMatch(/setTesting/);
      });

      buildTimeTest('setTesting: throws error when value does not match global config', () => {
        // Default global config has isTesting = false, trying to set to true should fail
        expect(() => {
          transform(`
            import { setTesting } from '@embroider/macros';
            export default function() {
              setTesting(true);
            }
          `);
        }).toThrow(/cannot change the testing state in compile-time mode/);
      });

      buildTimeTest('setTesting: throws error when called without arguments', () => {
        expect(() => {
          transform(`
            import { setTesting } from '@embroider/macros';
            export default function() {
              setTesting();
            }
          `);
        }).toThrow(/requires a boolean argument/);
      });

      buildTimeTest('setTesting: throws error when argument is not statically analyzable', () => {
        expect(() => {
          transform(`
            import { setTesting } from '@embroider/macros';
            const myValue = true;
            export default function() {
              setTesting(myValue);
            }
          `);
        }).toThrow(/can only be called with a statically analyzable value/);
      });

      buildTimeTest('setTesting: allows setting to true when global config is already true', () => {
        // Create a new config with isTesting = true
        macrosConfig = MacrosConfig.for({}, resolve(__dirname, '..', '..'));
        applyMode(macrosConfig);
        macrosConfig.setGlobalConfig(__filename, '@embroider/macros', { isTesting: true });
        macrosConfig.finalize();

        let code = transform(`
          import { setTesting } from '@embroider/macros';
          export default function() {
            setTesting(true);
          }
        `);
        // Should be removed without error
        expect(code).not.toMatch(/setTesting/);
      });
    }),
  });
});
