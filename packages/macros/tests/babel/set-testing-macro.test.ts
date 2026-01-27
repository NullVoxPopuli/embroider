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
    createTests: allModes(function (transform, { applyMode, runTimeTest }) {
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

      runTimeTest('setTesting: can be called with false', () => {
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

      test('setTesting: only works in runtime mode', () => {
        // setTesting should only work in runtime mode, in build-time mode it should throw
        // Note: This test will only actually throw in build-time mode. In runtime mode,
        // the transform succeeds but the check doesn't run.
        try {
          let code = transform(`
            import { setTesting } from '@embroider/macros';
            export default function() {
              setTesting(true);
            }
          `);
          // If we get here without an error, we're in runtime mode
          // and the transform should have converted to a runtime import
          expect(code).toMatch(/from ['"].*runtime['"]/);
        } catch (error: any) {
          // If we get an error, it should be about runtime mode
          expect(error.message).toMatch(/setTesting can only be used in runtime mode/);
        }
      });
    }),
  });
});
