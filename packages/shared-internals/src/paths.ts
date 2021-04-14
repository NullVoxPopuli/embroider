import { relative, isAbsolute, dirname, join, basename } from 'path';

// by "explicit", I mean that we want "./local/thing" instead of "local/thing"
// because
//     import "./local/thing"
// has a different meaning than
//     import "local/thing"
//
export function explicitRelative(fromDir: string, toFile: string) {
  let result = join(relative(fromDir, dirname(toFile)), basename(toFile));
  if (!isAbsolute(result) && !result.startsWith('.')) {
    result = './' + result;
  }
  if (isAbsolute(toFile) && result.endsWith(toFile)) {
    // this prevents silly "relative" paths like
    // "../../../../../Users/you/projects/your/stuff" when we could have just
    // said "/Users/you/projects/your/stuff". The silly path isn't incorrect,
    // but it's unnecessarily verbose.
    return toFile;
  }

  // windows supports both "./" and ".\", but webpack 5 insists on "./"
  if (result.startsWith('.\\')) {
    return './' + result.slice(2);
  }

  // windows supports both "../" and "..\", but webpack 5 insists on "../"
  if (result.startsWith('..\\')) {
    return '../' + result.slice(3);
  }

  return result;
}

// given a list like ['.js', '.ts'], return a regular expression for files ending
// in those extensions.
export function extensionsPattern(extensions: string[]): RegExp {
  return new RegExp(`(${extensions.map(e => `${e.replace('.', '\\.')}`).join('|')})$`, 'i');
}
