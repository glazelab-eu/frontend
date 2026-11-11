declare module 'virtual:vision-assets' {
  /** `base`: where the files are served (ends with a slash); `files`: each downloaded file's size in bytes. */
  const assets: { base: string; files: Record<'model.onnx' | 'labels.json' | 'ort-wasm-simd-threaded.wasm', number> };
  export default assets;
}
