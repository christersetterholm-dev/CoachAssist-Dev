import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { X, Check, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import { motion } from 'motion/react';

interface ImageCropperProps {
  image: string;
  onCropComplete: (croppedImage: Blob) => void;
  onCancel: () => void;
  aspect?: number;
}

export default function ImageCropper({ image, onCropComplete, onCancel, aspect = 1 }: ImageCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  const onCropChange = (crop: { x: number, y: number }) => {
    setCrop(crop);
  };

  const onZoomChange = (zoom: number) => {
    setZoom(zoom);
  };

  const onCropCompleteInternal = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const createImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener('load', () => resolve(image));
      image.addEventListener('error', (error) => reject(error));
      image.setAttribute('crossOrigin', 'anonymous');
      image.src = url;
    });

  const getCroppedImg = async (
    imageSrc: string,
    pixelCrop: any,
    rotation = 0
  ): Promise<Blob> => {
    const image = await createImage(imageSrc);
    
    // Create an off-screen canvas to hold the rotated/unrotated image
    const sourceCanvas = document.createElement('canvas');
    const sourceCtx = sourceCanvas.getContext('2d');
    if (!sourceCtx) {
      throw new Error('No 2d context for sourceCanvas');
    }

    const rotRad = (rotation * Math.PI) / 180;
    const { width: bBoxWidth, height: bBoxHeight } = rotateSize(
      image.width,
      image.height,
      rotation
    );

    sourceCanvas.width = bBoxWidth;
    sourceCanvas.height = bBoxHeight;

    // Use high rendering options
    sourceCtx.imageSmoothingEnabled = true;
    sourceCtx.imageSmoothingQuality = 'high';

    sourceCtx.translate(bBoxWidth / 2, bBoxHeight / 2);
    sourceCtx.rotate(rotRad);
    sourceCtx.translate(-image.width / 2, -image.height / 2);
    sourceCtx.drawImage(image, 0, 0);

    // Create target canvas to draw the cropped sub-region
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('No 2d context for target canvas');
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Round values to prevent floating-point sub-pixel aliasing (creates thin gray lines)
    const cropX = Math.round(pixelCrop.x);
    const cropY = Math.round(pixelCrop.y);
    const cropWidth = Math.round(pixelCrop.width);
    const cropHeight = Math.round(pixelCrop.height);

    const maxSize = 512; // Enforce high quality resolution for team logos & profile pictures
    let targetWidth = cropWidth;
    let targetHeight = cropHeight;

    if (targetWidth > maxSize || targetHeight > maxSize) {
      if (targetWidth > targetHeight) {
        targetHeight = Math.round((maxSize / targetWidth) * targetHeight);
        targetWidth = maxSize;
      } else {
        targetWidth = Math.round((maxSize / targetHeight) * targetWidth);
        targetHeight = maxSize;
      }
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const scaleX = targetWidth / Math.max(1, cropWidth);
    const scaleY = targetHeight / Math.max(1, cropHeight);

    ctx.scale(scaleX, scaleY);
    // Draw the rotated source canvas at the rounded negative coordinate offsets
    ctx.drawImage(sourceCanvas, -cropX, -cropY);

    return new Promise((resolve) => {
      // Prefer lossless PNG to support transparent backgrounds (essential for logo overlays)
      const isPng = imageSrc.startsWith('data:image/png') || imageSrc.toLowerCase().includes('.png') || imageSrc.toLowerCase().includes('.svg') || !imageSrc.startsWith('data:');
      const mimeType = isPng ? 'image/png' : 'image/jpeg';
      const quality = 0.95;

      canvas.toBlob((file) => {
        if (file) resolve(file);
      }, mimeType, quality);
    });
  };

  const rotateSize = (width: number, height: number, rotation: number) => {
    const rotRad = (rotation * Math.PI) / 180;
    return {
      width:
        Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
      height:
        Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
    };
  };

  const handleConfirm = async () => {
    try {
      const croppedBlob = await getCroppedImg(image, croppedAreaPixels, rotation);
      onCropComplete(croppedBlob);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/90 z-[200] flex flex-col items-center justify-center p-4 sm:p-8"
    >
      <div className="w-full max-w-2xl h-[60vh] sm:h-[70vh] relative rounded-3xl overflow-hidden bg-zinc-900 border border-zinc-800 shadow-2xl">
        <Cropper
          image={image}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={aspect}
          minZoom={0.2}
          restrictPosition={false}
          onCropChange={onCropChange}
          onCropComplete={onCropCompleteInternal}
          onZoomChange={onZoomChange}
        />
      </div>

      <div className="w-full max-w-2xl mt-6 space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4 text-white">
            <ZoomOut size={20} className="text-zinc-500" onClick={() => setZoom(Math.max(0.2, zoom - 0.1))} />
            <input
              type="range"
              value={zoom}
              min={0.2}
              max={3}
              step={0.05}
              aria-labelledby="Zoom"
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <ZoomIn size={20} className="text-zinc-500" onClick={() => setZoom(Math.min(3, zoom + 0.1))} />
          </div>

          <div className="flex items-center gap-4 text-white">
            <RotateCw size={20} className="text-zinc-500" />
            <input
              type="range"
              value={rotation}
              min={0}
              max={360}
              step={1}
              aria-labelledby="Rotation"
              onChange={(e) => setRotation(Number(e.target.value))}
              className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <span className="text-xs font-mono text-zinc-500 w-8">{rotation}°</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 pt-4 border-t border-zinc-800">
          <button
            onClick={onCancel}
            className="flex items-center gap-2 px-6 py-3 bg-zinc-800 text-zinc-300 rounded-2xl font-bold hover:bg-zinc-700 transition-colors"
          >
            <X size={20} />
            <span>Avbryt</span>
          </button>
          
          <button
            onClick={handleConfirm}
            className="flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            <Check size={20} />
            <span>Beskär & Spara</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
