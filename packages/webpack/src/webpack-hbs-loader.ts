import { loader } from 'webpack';
import { getOptions } from 'loader-utils';

export default function hbsLoader(this: loader.LoaderContext, templateContent: string) {
  let { templateCompilerFile } = getOptions(this);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let templateCompiler = require(templateCompilerFile).compile;

  try {
    return templateCompiler(this.resourcePath, templateContent);
  } catch (error) {
    error.type = 'Template Compiler Error';
    error.file = this.resourcePath;
    throw error;
  }
}
