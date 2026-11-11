/**
 * The CLIP preprocessing of the photo suggestions (33-1), as pure functions: the largest centred square of the
 * photo is resized to the model's input size (the canvas does the resizing, see `image.ts`) and each pixel
 * becomes `(value / 255 - mean) / std` per channel, laid out channel first (the model's `pixel_values`).
 */
export interface Crop {
  /** Top-left corner and side of the square taken from the photo, in photo pixels. */
  x: number;
  y: number;
  size: number;
}

/** The largest square in the middle of a `width` x `height` photo (the same as resizing the short side, then cropping the middle). */
export function centerCrop(width: number, height: number): Crop {
  const size = Math.min(width, height);
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}

/**
 * RGBA pixels of a `size` x `size` image (as `ImageData` gives them; alpha is ignored, the caller paints a white
 * background first) as a channel-first float tensor, normalized per channel.
 */
export function toTensor(rgba: ArrayLike<number>, size: number, mean: readonly number[], std: readonly number[]): Float32Array {
  const pixels = size * size;
  if (rgba.length !== pixels * 4) throw new RangeError(`expected ${pixels * 4} values for ${size}x${size} RGBA pixels, got ${rgba.length}`);
  const tensor = new Float32Array(pixels * 3);
  for (let channel = 0; channel < 3; channel++) {
    const offset = channel * pixels;
    for (let pixel = 0; pixel < pixels; pixel++) tensor[offset + pixel] = (rgba[pixel * 4 + channel] / 255 - mean[channel]) / std[channel];
  }
  return tensor;
}
