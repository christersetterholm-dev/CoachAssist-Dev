
import React, { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import { getCachedImage, cacheImage } from '../lib/imageCache';

// Global memory cache to share across instances (crucial for export view)
const memoryCache: Record<string, string> = {};

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

export const CachedImage: React.FC<CachedImageProps> = ({ src, className, alt, crossOrigin = 'anonymous', ...props }) => {
  // Initialize from memory cache synchronously if possible
  const [displaySrc, setDisplaySrc] = useState<string | null>(memoryCache[src] || null);
  const [useCors, setUseCors] = useState(crossOrigin === 'anonymous');

  useEffect(() => {
    let isMounted = true;

    const loadImage = async () => {
      // Don't try to cache data URLs or already blob URLs
      if (src.startsWith('data:') || src.startsWith('blob:')) {
        setDisplaySrc(src);
        return;
      }

      // 1. Check Memory Cache First (Fastest)
      if (memoryCache[src]) {
        if (isMounted) {
          setDisplaySrc(memoryCache[src]);
          setUseCors(true);
        }
        return;
      }

      // 2. Check IndexedDB Cache
      try {
        const cachedBlob = await getCachedImage(src);
        if (cachedBlob && isMounted) {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (isMounted && typeof reader.result === 'string') {
              if (reader.result.length > 500) {
                memoryCache[src] = reader.result;
                setDisplaySrc(reader.result);
                setUseCors(true);
              } else {
                setDisplaySrc(src);
                setUseCors(false);
              }
            }
          };
          reader.readAsDataURL(cachedBlob);
          return;
        }
      } catch (e) {
        console.warn('Cache lookup failed', e);
      }

      // 3. If not in cache, fetch and cache
      try {
        let response: Response | null = null;
        
        try {
          response = await fetch(src, { 
            cache: 'default',
            mode: 'cors',
            credentials: 'omit',
            referrerPolicy: 'no-referrer'
          });
        } catch (fetchErr) {
          // Silent proceed to proxy
        }
        
        if (!response || !response.ok) {
          try {
            response = await fetch(`/api/proxy?url=${encodeURIComponent(src)}`, { 
              cache: 'default'
            });
          } catch (proxyErr) {
            // Proxy failed, will fall back in the outer catch
          }
        }
        
        if (!response.ok) throw new Error(`Fetch failed`);
        
        const blob = await response.blob();
        
        if (isMounted) {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (isMounted && typeof reader.result === 'string') {
              if (reader.result.length > 500) {
                memoryCache[src] = reader.result;
                setDisplaySrc(reader.result);
                setUseCors(true);
                cacheImage(src, blob).catch(() => {});
              } else {
                setDisplaySrc(src);
                setUseCors(false);
              }
            }
          };
          reader.readAsDataURL(blob);
        }
      } catch (err) {
        console.error(`[CachedImage] All load methods failed for ${src}:`, err);
        if (isMounted) {
          setDisplaySrc(src);
          setUseCors(false);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
    };
  }, [src, crossOrigin]);

  const [loadError, setLoadError] = useState(false);
  const { crossOrigin: _excluded, ...cleanProps } = props;
  const finalCrossOrigin = useCors ? 'anonymous' : undefined;

  // IMPORTANT: For Data URLs, crossOrigin should be omitted
  const isLocal = displaySrc?.startsWith('data:');

  if (!displaySrc || loadError) {
    if (loadError) console.warn(`[CachedImage] Reached load error state for ${src}`);
    return <div className={`${className} bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400`}><User size={20} /></div>;
  }

  return (
    <img 
      src={displaySrc} 
      className={className} 
      alt={alt} 
      crossOrigin={isLocal ? undefined : finalCrossOrigin} 
      referrerPolicy="no-referrer"
      {...cleanProps} 
      onError={() => {
        console.error(`[CachedImage] img.onError triggered for ${displaySrc.substring(0, 100)}...`);
        setLoadError(true);
      }}
    />
  );
}
