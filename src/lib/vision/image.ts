import { centerCrop, toTensor } from './preprocess';

/** What a photo needs to become the model's input (`VisionLabels.model`). */
export interface InputSpec {
  input: number;
  mean: readonly number[];
  std: readonly number[];
}

/**
 * The model input of a photo chosen on this device: decoded with its orientation (a phone photo is rotated by the
 * decoder), the centred square drawn at the model's size on white (a transparent PNG), normalized. Nothing is kept or
 * sent: the bitmap and the canvas are released before this returns. Throws when the file cannot be decoded.
 */
export async function photoTensor(file: Blob, spec: InputSpec, signal?: AbortSignal): Promise<Float32Array> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    signal?.throwIfAborted();
    const crop = centerCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = spec.input;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no canvas');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, spec.input, spec.input);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, spec.input, spec.input);
    const tensor = toTensor(context.getImageData(0, 0, spec.input, spec.input).data, spec.input, spec.mean, spec.std);
    canvas.width = canvas.height = 0;
    return tensor;
  } finally {
    bitmap.close();
  }
}
