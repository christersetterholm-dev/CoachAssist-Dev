
import React, { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import { getApiUrl } from '../lib/firebase';
import { getCachedImage, cacheImage } from '../lib/imageCache';

// Global memory cache to share across instances (crucial for export view)
const memoryCache: Record<string, string> = {};

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

export const CachedImage: React.FC<CachedImageProps> = ({ src, className, alt, crossOrigin = 'anonymous', ...props }) => {
  // Initialize from memory cache synchronously if possible
  const validSrc = typeof src === 'string' && src.trim() ? src : '';
  const [displaySrc, setDisplaySrc] = useState<string | null>(validSrc ? (memoryCache[validSrc] || null) : null);
  const [useCors, setUseCors] = useState(crossOrigin === 'anonymous');

  useEffect(() => {
    let isMounted = true;

    if (!validSrc) {
      setDisplaySrc(null);
      return;
    }

    const loadImage = async () => {
      // Don't try to cache data URLs or already blob URLs
      if (validSrc.startsWith('data:') || validSrc.startsWith('blob:')) {
        setDisplaySrc(validSrc);
        return;
      }

      // 1. Check Memory Cache First (Fastest)
      if (memoryCache[validSrc]) {
        if (isMounted) {
          setDisplaySrc(memoryCache[validSrc]);
          setUseCors(true);
        }
        return;
      }

      // 2. Check IndexedDB Cache
      try {
        const cachedBlob = await getCachedImage(validSrc);
        if (cachedBlob && isMounted) {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (isMounted && typeof reader.result === 'string') {
              if (reader.result.length > 500) {
                memoryCache[validSrc] = reader.result;
                setDisplaySrc(reader.result);
                setUseCors(true);
              } else {
                setDisplaySrc(validSrc);
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
          response = await fetch(getApiUrl(validSrc), { 
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
            response = await fetch(getApiUrl(`/api/proxy?url=${encodeURIComponent(validSrc)}`), { 
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
                memoryCache[validSrc] = reader.result;
                setDisplaySrc(reader.result);
                setUseCors(true);
                cacheImage(validSrc, blob).catch(() => {});
              } else {
                setDisplaySrc(validSrc);
                setUseCors(false);
              }
            }
          };
          reader.readAsDataURL(blob);
        }
      } catch (err) {
        console.error(`[CachedImage] All load methods failed for ${validSrc}:`, err);
        if (isMounted) {
          setDisplaySrc(validSrc);
          setUseCors(false);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
    };
  }, [validSrc, crossOrigin]);

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
