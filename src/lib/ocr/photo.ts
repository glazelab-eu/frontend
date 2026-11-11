export class PhotoError extends Error {
  constructor(public problem: 'fileType' | 'fileSize' | 'pixels' | 'image') {
    super(problem);
  }
}
export function validatePhoto(file: Pick<File, 'type' | 'size'>) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new PhotoError('fileType');
  if (file.size === 0 || file.size > 12 * 1024 * 1024) throw new PhotoError('fileSize');
}
export function photoSize(width: number, height: number) {
  if (!(Number.isFinite(width) && Number.isFinite(height)) || width <= 0 || height <= 0 || width * height > 24_000_000) throw new PhotoError('pixels');
  const scale = Math.min(3, 1600 / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
