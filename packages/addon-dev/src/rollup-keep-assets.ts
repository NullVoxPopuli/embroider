import type { Plugin, SourceMap } from 'rollup';
import minimatch from 'minimatch';
import { basename, dirname, extname, isAbsolute, relative } from 'path';
import { readFileSync } from 'fs';
import MagicString from 'magic-string';

// randomly chosen, we're just looking to have high-entropy identifiers that
// won't collide with anyting else in the source
let counter = 11559;

// a `sourceMappingURL` annotation is a comment, so we can only append one to
// file types whose comment syntax we know. All other kept assets are emitted
// byte-for-byte.
const annotationFormats: { [ext: string]: (url: string) => string } = {
  '.css': (url) => `\n/*# sourceMappingURL=${url} */\n`,
};

function annotationFor(fileName: string) {
  return annotationFormats[extname(fileName).toLowerCase()];
}

export default function keepAssets({
  from,
  include,
  exports,
}: {
  from: string;
  include: string[];
  exports?: undefined | 'default' | '*';
}): Plugin {
  const marker = `__keep_assets_marker_${counter++}__`;

  return {
    name: 'keep-assets',

    // we implement a load hook for the assets we're keeping so that we can
    // capture their true binary representations. If we fell through to the
    // default rollup load hook we would get utf8 interpretations of them.
    //
    // Our plugin should be placed after any other plugins that have their own
    // load hooks, in which case this will not run but our transform hook will
    // still over from there.
    load(id: string) {
      if (include.some((pattern) => minimatch(id, pattern))) {
        return {
          code: readFileSync(id).toString('binary'),
          meta: {
            'keep-assets': {
              binaryLoaded: true,
            },
          },
        };
      }
    },

    transform(code: string, id: string) {
      if (!include.some((pattern) => minimatch(id, pattern))) {
        return;
      }

      let ourMeta = this.getModuleInfo(id)?.meta?.['keep-assets'];
      let assetFileName = relative(from, id);

      let output: Buffer | string = code;

      // the asset's content is leaving the JS module graph here, so by
      // default we return an empty map: rollup's convention for "this
      // transform deliberately produced code with no mapping to the source".
      let map: { mappings: '' } | undefined = { mappings: '' };
      let preservedMap: Record<string, unknown> | undefined;

      if (ourMeta?.binaryLoaded) {
        // when the code was produced by our own load hook it is binary-encoded
        // string and we can emit the true bytes.
        output = Buffer.from(code, 'binary');
      } else {
        let upstreamMap = realCombinedSourcemap(
          this.getCombinedSourcemap(),
          id,
          code
        );
        if (upstreamMap) {
          if (annotationFor(assetFileName)) {
            // an earlier plugin (e.g. one that rewrites CSS) produced a real
            // map for this asset. Stash both in the module meta.
            // renderStart emits them for each output,
            // because the bytes depend on that output's `sourcemap` setting.
            preservedMap = rebaseSources(upstreamMap, id, assetFileName);
          } else {
            // we have no comment syntax for this file type, so the upstream
            // map is genuinely dropped. Return no map at all so rollup's
            // SOURCEMAP_BROKEN warning reports the drop instead of us
            // silently eating it.
            map = undefined;
          }
        }
      }

      if (!preservedMap) {
        this.emitFile({
          type: 'asset',
          fileName: assetFileName,
          source: output,
        });
      }

      let call = `${marker}(${JSON.stringify(assetFileName)})`;
      let replacement: string;
      if (exports === '*') {
        replacement = `export * from ${call}`;
      } else if (exports === 'default') {
        replacement = `export default ${call}`;
      } else {
        // side-effect only
        replacement = call;
      }

      return {
        code: replacement,
        map,
        meta: preservedMap
          ? {
              'keep-assets': {
                ...ourMeta,
                source: code,
                sourceMap: preservedMap,
                assetFileName,
              },
            }
          : undefined,
      };
    },

    // an asset's bytes must be final when it is emitted: rollup and rolldown
    // do not support edits to the bundle in generateBundle.
    renderStart(options) {
      for (let id of this.getModuleIds()) {
        let meta = this.getModuleInfo(id)?.meta?.['keep-assets'];
        if (!meta?.sourceMap) {
          continue;
        }
        let fileName: string = meta.assetFileName;
        let source: string = meta.source;
        let annotate = annotationFor(fileName)!;
        let json = JSON.stringify(meta.sourceMap);
        if (options.sourcemap === 'inline') {
          source += annotate(
            `data:application/json;charset=utf-8;base64,${Buffer.from(
              json
            ).toString('base64')}`
          );
        } else if (options.sourcemap) {
          this.emitFile({
            type: 'asset',
            fileName: `${fileName}.map`,
            source: json,
          });
          if (options.sourcemap !== 'hidden') {
            source += annotate(`${basename(fileName)}.map`);
          }
        }
        this.emitFile({ type: 'asset', fileName, source });
      }
    },

    renderChunk(code, chunk) {
      if (!code.includes(marker)) {
        return null;
      }

      const { getName, imports } = nameTracker(code, exports);
      const magic = new MagicString(code);

      magic.replaceAll(
        new RegExp(`${marker}\\(("(?:[^"\\\\]|\\\\.)*")\\)`, 'g'),
        (_match: string, quotedFileName: string) => {
          let assetFileName: string = JSON.parse(quotedFileName);
          let relativeName =
            './' + relative(dirname(chunk.fileName), assetFileName);
          return getName(relativeName) ?? '';
        }
      );

      magic.prepend(imports());

      // returning a map keeps the chunk's source map intact across the import
      // injection and marker replacement above
      return {
        code: magic.toString(),
        map: magic.generateMap({ hires: 'boundary' }),
      };
    },
  };
}

// `getCombinedSourcemap` never returns nothing, so we must recognize its two
// not-actually-a-map shapes. When no plugin supplied a map it synthesizes an
// identity map via `generateMap({ source: id, includeContent: true })`, which
// is always exactly `{ sources: [id], sourcesContent: [code] }`. When an
// earlier transform broke the chain, the collapsed map has no sources.
function realCombinedSourcemap(map: SourceMap, id: string, code: string) {
  if (!map.mappings || map.sources.length === 0) {
    return undefined;
  }
  if (
    map.sources.length === 1 &&
    map.sources[0] === id &&
    map.sourcesContent?.[0] === code
  ) {
    return undefined;
  }
  return map;
}

// combined maps often carry absolute module ids in `sources`. The emitted
// `.map` sits next to the emitted asset, so make them relative to it rather
// than leaking build-machine paths.
//
// exported for testing
export function rebaseSources(
  map: Pick<SourceMap, 'toString'>,
  id: string,
  assetFileName: string
) {
  let parsed = JSON.parse(map.toString());
  parsed.file = basename(assetFileName);
  // `sources` entries may be null per the source map spec
  parsed.sources = parsed.sources.map((source: string | null) =>
    typeof source === 'string' && isAbsolute(source)
      ? relative(dirname(id), source)
      : source
  );
  return parsed;
}

function nameTracker(code: string, exports: undefined | 'default' | '*') {
  let counter = 0;
  let assets = new Map<string, string | undefined>();

  function getName(assetName: string): string | undefined {
    if (assets.has(assetName)) {
      return assets.get(assetName)!;
    }
    if (!exports) {
      assets.set(assetName, undefined);
      return undefined;
    }
    while (true) {
      let candidate = `_asset_${counter++}_`;
      if (!code.includes(candidate)) {
        assets.set(assetName, candidate);
        return candidate;
      }
    }
  }

  function imports() {
    return (
      [...assets]
        .map(([assetName, importedName]) => {
          if (importedName) {
            return `import ${importedName} from "${assetName}"`;
          } else {
            return `import "${assetName}"`;
          }
        })
        .join('\n') + '\n'
    );
  }

  return { getName, imports };
}
