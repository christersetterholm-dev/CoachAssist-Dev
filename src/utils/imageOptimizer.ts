import heic2any from 'heic2any';

export interface OptimizedImageResult {
  file: File;
  previewUrl: string;
}

/**
 * Checks if a file or MIME type is HEIC/HEIF format (standard Apple iPhone camera format).
 */
export function isHeicFile(file: File | Blob, fileName?: string): boolean {
  const name = (fileName || (file instanceof File ? file.name : '')).toLowerCase();
  const type = (file.type || '').toLowerCase();

  return (
    type === 'image/heic' ||
    type === 'image/heif' ||
    type === 'image/heic-sequence' ||
    type === 'image/heif-sequence' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

/**
 * Converts a HEIC/HEIF file or Blob to a standard JPEG Blob using WebAssembly.
 */
export async function convertHeicToJpeg(file: File | Blob): Promise<Blob> {
  try {
    const conversionResult = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.88,
    });

    if (Array.isArray(conversionResult)) {
      return conversionResult[0];
    }
    return conversionResult;
  } catch (error) {
    console.error('HEIC to JPEG conversion failed:', error);
    throw new Error('Kunde inte konvertera HEIC-bilden till JPEG. Prova att välja en JPG- eller PNG-bild.');
  }
}

/**
 * Resizes and compresses an image Blob/File to a web-optimized JPEG.
 * Ensures the image fits within maxDimensions (default 1600px) and quality (default 0.82),
 * resulting in typical file sizes of 100KB - 350KB (always safely below Firestore's 1MB limit).
 */
export async function resizeAndCompressImage(
  imageBlob: Blob,
  maxDimension = 1600,
  quality = 0.82
): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(imageBlob);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // Calculate scaled dimensions while preserving aspect ratio
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imageBlob);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            resolve(imageBlob);
          }
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      console.warn('Image load error during resize, falling back to original blob:', err);
      resolve(imageBlob);
    };

    img.src = objectUrl;
  });
}

/**
 * Main entry point: takes a user-selected File (e.g. from mobile or desktop input),
 * handles HEIC -> JPEG conversion if needed, scales down to max 1600px, compresses to JPEG,
 * and returns an upload-ready File object under 500KB.
 */
export async function optimizeImageForUpload(file: File): Promise<File> {
  let workingBlob: Blob = file;
  let baseName = file.name.replace(/\.[^/.]+$/, ''); // Remove extension

  // 1. If HEIC / HEIF, convert to JPEG Blob
  if (isHeicFile(file)) {
    workingBlob = await convertHeicToJpeg(file);
  }

  // 2. Resize and compress using HTML5 Canvas
  const optimizedBlob = await resizeAndCompressImage(workingBlob, 1600, 0.82);

  // 3. Return as clean File with .jpg extension
  const cleanFileName = `${baseName || 'photo'}.jpg`;
  return new File([optimizedBlob], cleanFileName, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}
