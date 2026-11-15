import commonWGSL from './shaders/common.wgsl';

/**
 * The one place compute shader source is assembled. WGSL has no imports, so
 * the shared definitions are prepended to each shader body.
 */
export function computeShaderSource(body: string): string {
  return commonWGSL + '\n' + body;
}
