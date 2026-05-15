import { ResolverLoader, virtualContent, type VirtualResponse } from '@embroider/core';
import type { LoaderContext } from 'webpack';

// VirtualResponse is almost-JSON. The only non-JSON value that appears in the
// union is the `Set` used by the `fastboot-switch` response, so we teach our
// (de)serializer about Sets and otherwise rely on plain JSON.
const SET_TAG = '__embroiderSet__';

export function serializeVirtualResponse(virtual: VirtualResponse): string {
  let json = JSON.stringify(virtual, (_key, value) => {
    if (value instanceof Set) {
      return { [SET_TAG]: [...value] };
    }
    return value;
  });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function deserializeVirtualResponse(encoded: string): VirtualResponse {
  let json = Buffer.from(encoded, 'base64url').toString('utf8');
  return JSON.parse(json, (_key, value) => {
    if (value && typeof value === 'object' && Array.isArray(value[SET_TAG])) {
      return new Set(value[SET_TAG]);
    }
    return value;
  });
}

let resolverLoader: ResolverLoader | undefined;

function setup(appRoot: string): ResolverLoader {
  if (resolverLoader?.appRoot !== appRoot) {
    resolverLoader = new ResolverLoader(appRoot);
  }
  return resolverLoader;
}

// This loader is the webpack equivalent of vite's `load` hook in the embroider
// resolver plugin. Whenever the resolver decides that a request resolves to
// virtual content, it rewrites the request so it flows through this loader,
// passing the (serialized) VirtualResponse and the app root in the query.
export default function virtualLoader(this: LoaderContext<unknown>): string | undefined {
  if (typeof this.query === 'string' && this.query[0] === '?') {
    let params = new URLSearchParams(this.query);
    let encodedVirtual = params.get('v');
    let appRoot = params.get('a');
    if (!encodedVirtual || !appRoot) {
      throw new Error(`bug in @embroider/webpack virtual loader, cannot locate params in ${this.query}`);
    }
    let virtual = deserializeVirtualResponse(encodedVirtual);
    let { resolver } = setup(appRoot);
    this.resourcePath = virtual.specifier;
    let { src, watches } = virtualContent(virtual, resolver);
    for (let watch of watches) {
      this.addDependency(watch);
    }
    return src;
  }
  throw new Error(`@embroider/webpack/src/virtual-loader received unexpected request: ${this.query}`);
}
