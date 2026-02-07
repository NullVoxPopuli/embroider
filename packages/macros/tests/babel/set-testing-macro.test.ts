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

      buildTimeTest('setTesting: uses runtime implementation in build-time mode', () => {
        let code = transform(`
          import { setTesting } from '@embroider/macros';
          export default function() {
            setTesting(false);
          }
        `);
        expect(code).toMatch(/from ['"].*runtime['"]/);
      });

      buildTimeTest('setTesting: uses runtime implementation even when value does not match global config', () => {
        let code = transform(`
          import { setTesting } from '@embroider/macros';
          export default function() {
            setTesting(true);
          }
        `);
        expect(code).toMatch(/from ['"].*runtime['"]/);
      });

      buildTimeTest('setTesting: uses runtime implementation when called without arguments', () => {
        let code = transform(`
          import { setTesting } from '@embroider/macros';
          export default function() {
            setTesting();
          }
        `);
        expect(code).toMatch(/from ['"].*runtime['"]/);
      });

      buildTimeTest('setTesting: uses runtime implementation when argument is not statically analyzable', () => {
        let code = transform(`
          import { setTesting } from '@embroider/macros';
          const myValue = true;
          export default function() {
            setTesting(myValue);
          }
        `);
        expect(code).toMatch(/from ['"].*runtime['"]/);
      });

      buildTimeTest('setTesting: uses runtime implementation when global config is already true', () => {
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
        expect(code).toMatch(/from ['"].*runtime['"]/);
      });
    }),
  });
});
