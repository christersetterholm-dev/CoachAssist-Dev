import React, { useState, useRef, useEffect } from 'react';
import { Download, Upload, RefreshCw, Smartphone, Layers, Check, Copy, Sparkles, CheckCircle2, AlertCircle, UploadCloud } from 'lucide-react';
import JSZip from 'jszip';
import { getApiUrl } from '../lib/firebase';

interface PwaIconGeneratorProps {
  initialLogoUrl?: string;
  clubName?: string;
}

interface IconSpec {
  size: number;
  fileName: string;
  label: string;
  purpose?: string;
}

const ICON_SPECS: IconSpec[] = [
  { size: 16, fileName: 'favicon-16x16.png', label: 'Favicon 16x16' },
  { size: 32, fileName: 'favicon-32x32.png', label: 'Favicon 32x32' },
  { size: 48, fileName: 'favicon-48x48.png', label: 'Favicon 48x48 (Standard)' },
  { size: 72, fileName: 'icon-72x72.png', label: 'Android Low Density 72x72' },
  { size: 96, fileName: 'icon-96x96.png', label: 'Android Medium Density 96x96' },
  { size: 128, fileName: 'icon-128x128.png', label: 'Chrome Web Store 128x128' },
  { size: 144, fileName: 'icon-144x144.png', label: 'Android High Density 144x144' },
  { size: 152, fileName: 'apple-touch-icon-152x152.png', label: 'iPad Home Screen 152x152' },
  { size: 180, fileName: 'apple-touch-icon.png', label: 'iPhone Home Screen 180x180' },
  { size: 192, fileName: 'icon-192x192.png', label: 'PWA Standard 192x192' },
  { size: 384, fileName: 'icon-384x384.png', label: 'PWA High Res 384x384' },
  { size: 512, fileName: 'icon-512x512.png', label: 'PWA Standard 512x512' },
  { size: 512, fileName: 'icon-maskable-512x512.png', label: 'Android Maskable 512x512', purpose: 'maskable' },
];

const PRESET_COLORS = [
  { name: 'Indigo (CoachAssist)', hex: '#4f46e5' },
  { name: 'Mörk Zink', hex: '#18181b' },
  { name: 'Svart', hex: '#000000' },
  { name: 'Vit', hex: '#ffffff' },
  { name: 'Smaragdgrön', hex: '#10b981' },
  { name: 'Kungsblå', hex: '#2563eb' },
  { name: 'Röd', hex: '#dc2626' },
  { name: 'Bärnsten', hex: '#f59e0b' },
  { name: 'Lila', hex: '#9333ea' },
];

export default function PwaIconGenerator({ initialLogoUrl, clubName = 'CoachAssist' }: PwaIconGeneratorProps) {
  const [logoImage, setLogoImage] = useState<HTMLImageElement | null>(null);
  const [logoSrc, setLogoSrc] = useState<string>(initialLogoUrl || '/icon.svg');
  const [bgColor, setBgColor] = useState<string>('#4f46e5');
  const [useTransparentBg, setUseTransparentBg] = useState<boolean>(false);
  const [paddingPercent, setPaddingPercent] = useState<number>(18);
  const [borderRadiusPercent, setBorderRadiusPercent] = useState<number>(22);
  const [showMaskableZone, setShowMaskableZone] = useState<boolean>(true);
  const [appName, setAppName] = useState<string>(clubName);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isApplyingToApp, setIsApplyingToApp] = useState<boolean>(false);
  const [applyStatus, setApplyStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState<'manifest' | 'html' | null>(null);
  const [previewDataUrls, setPreviewDataUrls] = useState<{ [key: string]: string }>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch existing saved PWA metadata on mount
  useEffect(() => {
    fetch(getApiUrl('/api/pwa-icons'))
      .then(res => res.json())
      .then(data => {
        if (data) {
          if (data.appName) {
            setAppName(data.appName);
          }
          if (data.themeColor) {
            setBgColor(data.themeColor);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Sync if clubName changes from props
  useEffect(() => {
    if (clubName && clubName !== 'CoachAssist') {
      setAppName(clubName);
    }
  }, [clubName]);

  // Load image when logoSrc changes
  useEffect(() => {
    if (!logoSrc) return;
    const img = new Image();
    // Only set crossOrigin for remote http/https URLs to avoid issues with data: or blob: URLs
    if (logoSrc.startsWith('http://') || logoSrc.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      setLogoImage(img);
    };
    img.onerror = () => {
      console.warn('Could not load logo image from source:', logoSrc);
    };
    img.src = logoSrc;
  }, [logoSrc]);

  // Generate previews when inputs change
  useEffect(() => {
    if (!logoImage) return;

    const previews: { [key: string]: string } = {};
    ICON_SPECS.forEach(spec => {
      previews[spec.fileName] = renderIconCanvas(spec.size, spec.purpose === 'maskable');
    });
    setPreviewDataUrls(previews);
  }, [logoImage, bgColor, useTransparentBg, paddingPercent, borderRadiusPercent]);

  // Helper to draw icon on canvas
  const renderIconCanvas = (size: number, isMaskable: boolean = false): string => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.clearRect(0, 0, size, size);

    const isValidHex = (hex: string) => /^#[0-9a-fA-F]{6}$/i.test(hex);

    // Background
    if (!useTransparentBg) {
      const cleanHex = /^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor.toLowerCase() : '#4f46e5';
      ctx.fillStyle = cleanHex;
      if (isMaskable) {
        // Maskable fills full canvas without rounded corners
        ctx.fillRect(0, 0, size, size);
      } else if (borderRadiusPercent > 0) {
        const radius = (size * borderRadiusPercent) / 100;
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(size - radius, 0);
        ctx.quadraticCurveTo(size, 0, size, radius);
        ctx.lineTo(size, size - radius);
        ctx.quadraticCurveTo(size, size, size - radius, size);
        ctx.lineTo(radius, size);
        ctx.quadraticCurveTo(0, size, 0, size - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(0, 0, size, size);
      }
    }

    // Logo image drawing with padding
    if (logoImage) {
      // For maskable icons, safe zone is inner 80% (10% padding on each side)
      const effectivePadding = isMaskable ? Math.max(paddingPercent, 18) : paddingPercent;
      const padPx = (size * effectivePadding) / 100;
      const drawSize = Math.max(1, size - padPx * 2);

      // Safe aspect ratio calculation (especially for SVG images which may return 0 for naturalWidth/naturalHeight)
      const rawW = logoImage.naturalWidth || logoImage.width || 0;
      const rawH = logoImage.naturalHeight || logoImage.height || 0;
      
      let imgAspect = 1;
      if (rawW > 0 && rawH > 0) {
        imgAspect = rawW / rawH;
      }

      let drawW = drawSize;
      let drawH = drawSize;

      if (imgAspect > 1) {
        drawH = drawSize / imgAspect;
      } else if (imgAspect < 1) {
        drawW = drawSize * imgAspect;
      }

      // Ensure finite numbers
      if (!isFinite(drawW) || drawW <= 0) drawW = drawSize;
      if (!isFinite(drawH) || drawH <= 0) drawH = drawSize;

      const offsetX = (size - drawW) / 2;
      const offsetY = (size - drawH) / 2;

      if (isFinite(offsetX) && isFinite(offsetY) && drawW > 0 && drawH > 0) {
        try {
          ctx.drawImage(logoImage, offsetX, offsetY, drawW, drawH);
        } catch (e) {
          console.warn('Could not draw image to canvas:', e);
        }
      }
    }

    try {
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.error('Error generating canvas data URL:', e);
      return '';
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setLogoSrc(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDownloadSingle = (spec: IconSpec) => {
    const dataUrl = renderIconCanvas(spec.size, spec.purpose === 'maskable');
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = spec.fileName;
    a.click();
  };

  const handleDownloadAllZip = async () => {
    if (!logoImage) return;
    setIsGenerating(true);
    try {
      const zip = new JSZip();
      const iconsFolder = zip.folder('pwa-icons');

      for (const spec of ICON_SPECS) {
        const dataUrl = renderIconCanvas(spec.size, spec.purpose === 'maskable');
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        if (iconsFolder) {
          iconsFolder.file(spec.fileName, base64Data, { base64: true });
        }
      }

      // Add manifest.webmanifest to zip
      const manifestObj = {
        name: appName,
        short_name: appName,
        description: `${appName} PWA App`,
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: bgColor,
        theme_color: bgColor,
        icons: [
          { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      };
      zip.file('manifest.webmanifest', JSON.stringify(manifestObj, null, 2));

      // Add HTML head tags guide
      const htmlInstructions = `<!-- Klistra in följande taggar i <head> på din index.html -->
<link rel="manifest" href="manifest.webmanifest" />
<link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png" />
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png" />
<link rel="icon" type="image/png" sizes="48x48" href="favicon-48x48.png" />
<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png" />
<meta name="theme-color" content="${bgColor}" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="${appName}" />
`;
      zip.file('index-head-tags.html', htmlInstructions);

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      const cleanAppName = appName.replace(/[^a-zA-Z0-9åäöÅÄÖ _\-]/g, '').trim() || 'CoachAssist';
      const zipFileName = `pwa-icons-${cleanAppName.toLowerCase().replace(/\s+/g, '-')}.zip`;
      a.download = zipFileName;
      a.click();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }, 1000);
    } catch (err: any) {
      console.error('Failed to create zip package:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyToApp = async () => {
    if (!logoImage) return;
    setIsApplyingToApp(true);
    setApplyStatus(null);

    try {
      const iconsPayload: { fileName: string; dataUrl: string }[] = [];

      for (const spec of ICON_SPECS) {
        const dataUrl = renderIconCanvas(spec.size, spec.purpose === 'maskable');
        if (dataUrl) {
          iconsPayload.push({
            fileName: spec.fileName,
            dataUrl
          });
        }
      }

      const endpoint = getApiUrl('/api/pwa-icons');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          appName: (appName || 'CoachAssist').trim(),
          themeColor: /^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor.toLowerCase() : '#4f46e5',
          icons: iconsPayload
        })
      });

      let data: any = {};
      try {
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = { error: 'Servern returnerade ett okänt svar.' };
        }
      } catch {
        data = {};
      }

      if (response.ok && data.success) {
        const cleanName = (appName || 'CoachAssist').trim();
        const cleanColor = /^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor.toLowerCase() : '#4f46e5';

        // Update DOM meta tags immediately
        document.title = cleanName;

        let appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]') as HTMLMetaElement;
        if (!appleTitle) {
          appleTitle = document.createElement('meta');
          appleTitle.name = 'apple-mobile-web-app-title';
          document.head.appendChild(appleTitle);
        }
        appleTitle.content = cleanName;

        let appNameMeta = document.querySelector('meta[name="application-name"]') as HTMLMetaElement;
        if (!appNameMeta) {
          appNameMeta = document.createElement('meta');
          appNameMeta.name = 'application-name';
          document.head.appendChild(appNameMeta);
        }
        appNameMeta.content = cleanName;

        let themeMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;
        if (!themeMeta) {
          themeMeta = document.createElement('meta');
          themeMeta.name = 'theme-color';
          document.head.appendChild(themeMeta);
        }
        themeMeta.content = cleanColor;

        let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement;
        if (!manifestLink) {
          manifestLink = document.createElement('link');
          manifestLink.rel = 'manifest';
          document.head.appendChild(manifestLink);
        }
        manifestLink.href = `/manifest.webmanifest?v=${Date.now()}`;

        setApplyStatus({
          type: 'success',
          message: `Appnamnet '${cleanName}' och ikonerna har sparats! När du eller en ledare nu sparar appen på mobilens hemskärm kommer '${cleanName}' upp som namn.`
        });
      } else {
        throw new Error(data.error || 'Kunde inte uppdatera ikonerna i appen.');
      }
    } catch (err: any) {
      console.error('Failed to apply PWA icons to app:', err);
      const rawMsg = err?.message || String(err || '');
      // Translate any internal DOM/browser exception strings to clear Swedish feedback
      let userMsg = rawMsg;
      if (!rawMsg || rawMsg.includes('pattern') || rawMsg.includes('SyntaxError') || rawMsg.includes('TypeError')) {
        userMsg = 'Ett tillfälligt kommunikationsfel uppstod vid sparandet av ikonerna. Vänligen försök igen.';
      }
      setApplyStatus({
        type: 'error',
        message: userMsg
      });
    } finally {
      setIsApplyingToApp(false);
    }
  };

  const getManifestSnippet = () => {
    return JSON.stringify({
      name: appName,
      short_name: appName,
      start_url: '/',
      display: 'standalone',
      background_color: bgColor,
      theme_color: bgColor,
      icons: [
        { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    }, null, 2);
  };

  const getHtmlSnippet = () => {
    return `<link rel="manifest" href="manifest.webmanifest" />
<link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png" />
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png" />
<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png" />
<meta name="theme-color" content="${bgColor}" />`;
  };

  const handleCopy = (type: 'manifest' | 'html', text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(type);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const mainPreview512 = previewDataUrls['icon-512x512.png'] || '';
  const mainMaskable512 = previewDataUrls['icon-maskable-512x512.png'] || '';

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-xl p-6 sm:p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-100 dark:border-zinc-800/80 pb-6">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
            <Smartphone size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
              PWA-Ikonpaket & Generator
              <span className="text-[10px] bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                Admin
              </span>
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
              Skapa perfekta hemskärmsikoner (iOS/Android) och tillämpa dem direkt i appen.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleApplyToApp}
            disabled={!logoImage || isApplyingToApp}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold px-5 py-3 rounded-2xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-100 dark:shadow-none active:scale-95 cursor-pointer"
          >
            {isApplyingToApp ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                <span>Uppdaterar appen...</span>
              </>
            ) : (
              <>
                <UploadCloud size={16} />
                <span>Uppdatera appens PWA-ikoner direkt</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadAllZip}
            disabled={!logoImage || isGenerating}
            className="bg-zinc-800 hover:bg-zinc-900 dark:bg-zinc-800 dark:hover:bg-zinc-700 disabled:opacity-50 text-white font-extrabold px-4 py-3 rounded-2xl text-xs flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
          >
            {isGenerating ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                <span>Genererar...</span>
              </>
            ) : (
              <>
                <Download size={15} />
                <span>Ladda ner ZIP</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Apply Status Banner */}
      {applyStatus && (
        <div className={`p-4 rounded-2xl flex items-center justify-between gap-3 text-xs font-bold transition-all ${
          applyStatus.type === 'success' 
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80' 
            : 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/80'
        }`}>
          <div className="flex items-center gap-2.5">
            {applyStatus.type === 'success' ? (
              <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle size={18} className="text-red-600 dark:text-red-400 shrink-0" />
            )}
            <span>{applyStatus.message}</span>
          </div>
          <button 
            type="button"
            onClick={() => setApplyStatus(null)} 
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-lg leading-none p-1 cursor-pointer"
          >
            &times;
          </button>
        </div>
      )}

      {/* Editor Controls & Previews Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Controls Column */}
        <div className="lg:col-span-5 space-y-6">
          {/* Logo Upload Box */}
          <div className="space-y-2">
            <label className="block text-xs font-black uppercase text-zinc-500 dark:text-zinc-400 tracking-wider">
              1. Logotyp / Bildkälla
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 py-3 px-4 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Upload size={16} className="text-indigo-500" />
                <span>Ladda upp ny logotyp (PNG / SVG)</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                title="Återställ till standard-logga"
                onClick={() => setLogoSrc('/icon.svg')}
                className="p-3 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-2xl transition-all cursor-pointer"
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          {/* App Name */}
          <div className="space-y-2">
            <label className="block text-xs font-black uppercase text-zinc-500 dark:text-zinc-400 tracking-wider">
              2. Appnamn för Hemskärm (Föreningsnamn)
            </label>
            <input
              type="text"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="Ex. KSK-appen, Kungsgårdens SK eller CoachAssist"
              className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm font-bold text-zinc-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Detta namn visas direkt under ikonen på mobilens hemskärm (iPhone & Android) samt i webbläsarens titel. Varje förening (t.ex. Kungsgårdens SK eller KSK-appen) kan sätta sitt eget anpassade namnet här.
            </p>
          </div>

          {/* Background Color Customization */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-black uppercase text-zinc-500 dark:text-zinc-400 tracking-wider">
                2. Bakgrundsfärg
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useTransparentBg}
                  onChange={(e) => setUseTransparentBg(e.target.checked)}
                  className="rounded border-zinc-300 dark:border-zinc-700 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                />
                Genomskinlig (PNG)
              </label>
            </div>

            {!useTransparentBg && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor.toLowerCase() : '#4f46e5'}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="w-10 h-10 rounded-xl cursor-pointer border-0 bg-transparent"
                  />
                  <input
                    type="text"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="flex-1 px-4 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-mono font-bold text-zinc-800 dark:text-zinc-200"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setBgColor(c.hex)}
                      title={c.name}
                      style={{ backgroundColor: c.hex }}
                      className={`w-7 h-7 rounded-lg border border-black/10 transition-transform ${bgColor.toLowerCase() === c.hex.toLowerCase() ? 'scale-110 ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-zinc-900' : 'hover:scale-105'}`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Padding Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-black uppercase text-zinc-500 dark:text-zinc-400 tracking-wider">
              <span>3. Logotyp-marginal (Padding)</span>
              <span className="text-indigo-600 dark:text-indigo-400">{paddingPercent}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="40"
              value={paddingPercent}
              onChange={(e) => setPaddingPercent(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-600 cursor-pointer"
            />
            <p className="text-[11px] text-zinc-400">
              Ger din logotyp luft runt kanterna för att förhindra att den blir beskuren av operativsystemet.
            </p>
          </div>

          {/* Border Radius Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-black uppercase text-zinc-500 dark:text-zinc-400 tracking-wider">
              <span>Hörnrundning för Förhandsvisning</span>
              <span className="text-indigo-600 dark:text-indigo-400">{borderRadiusPercent}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="50"
              value={borderRadiusPercent}
              onChange={(e) => setBorderRadiusPercent(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-600 cursor-pointer"
            />
          </div>
        </div>

        {/* Live Mockups Column */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-800 rounded-2xl p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-200/60 dark:border-zinc-800 pb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
                <Sparkles size={16} className="text-indigo-500" />
                Live Förhandsvisning på Hemskärmen
              </h3>

              <label className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMaskableZone}
                  onChange={(e) => setShowMaskableZone(e.target.checked)}
                  className="rounded text-indigo-600 w-3.5 h-3.5"
                />
                Visa Android Safe-Zone
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
              {/* iPhone iOS Mockup */}
              <div className="flex flex-col items-center p-4 bg-zinc-900 rounded-2xl shadow-inner border border-zinc-800">
                <span className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-widest mb-3">
                  iOS / Apple Home Screen
                </span>
                <div className="relative group flex flex-col items-center">
                  <div className="w-20 h-20 rounded-[22%] overflow-hidden shadow-2xl border border-white/10 relative transition-transform group-hover:scale-105">
                    {mainPreview512 && <img src={mainPreview512} alt="iOS App Icon" className="w-full h-full object-cover" />}
                  </div>
                  <span className="text-xs font-semibold text-white/90 mt-2 tracking-tight truncate max-w-[90px]">
                    {appName}
                  </span>
                </div>
              </div>

              {/* Android Maskable Adaptive Mockup */}
              <div className="flex flex-col items-center p-4 bg-emerald-950/40 rounded-2xl shadow-inner border border-emerald-900/30">
                <span className="text-[10px] font-extrabold uppercase text-emerald-400 tracking-widest mb-3">
                  Android Adaptive (Maskable)
                </span>
                <div className="relative group flex flex-col items-center">
                  <div className="w-20 h-20 rounded-full overflow-hidden shadow-2xl border border-white/10 relative transition-transform group-hover:scale-105">
                    {mainMaskable512 && <img src={mainMaskable512} alt="Android Maskable Icon" className="w-full h-full object-cover" />}
                    {showMaskableZone && (
                      <div className="absolute inset-[10%] rounded-full border border-dashed border-amber-400/80 pointer-events-none" />
                    )}
                  </div>
                  <span className="text-xs font-semibold text-zinc-200 mt-2 tracking-tight truncate max-w-[90px]">
                    {appName}
                  </span>
                </div>
              </div>
            </div>

            {/* Browser Tab & Favicon Mockup */}
            <div className="p-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 border border-zinc-200/80 dark:border-zinc-700">
                <div className="w-4 h-4 rounded overflow-hidden">
                  {previewDataUrls['favicon-32x32.png'] && (
                    <img src={previewDataUrls['favicon-32x32.png']} alt="Favicon" className="w-full h-full" />
                  )}
                </div>
                <span className="font-semibold text-[11px] truncate max-w-[120px]">{appName} - Web</span>
                <span className="text-zinc-400 text-[10px]">×</span>
              </div>
              <p className="text-[11px] text-zinc-400 font-medium">
                Webbläsare & Bokmärkesikon (Favicon 16/32/48px)
              </p>
            </div>
          </div>

          {/* Generated File Grid */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Genererad Ikonuppsättning ({ICON_SPECS.length} filer)
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
              {ICON_SPECS.map(spec => (
                <div
                  key={spec.fileName}
                  className="p-2.5 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800/80 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex-shrink-0 overflow-hidden flex items-center justify-center p-0.5">
                      {previewDataUrls[spec.fileName] && (
                        <img src={previewDataUrls[spec.fileName]} alt={spec.label} className="w-full h-full object-contain" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 truncate">
                        {spec.fileName}
                      </p>
                      <p className="text-[9px] text-zinc-400 font-mono">
                        {spec.size}x{spec.size} {spec.purpose ? `(${spec.purpose})` : ''}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDownloadSingle(spec)}
                    title={`Ladda ner ${spec.fileName}`}
                    className="p-1.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer flex-shrink-0"
                  >
                    <Download size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Manifest & HTML Code Export Tabs */}
      <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-200 flex items-center gap-2">
            <Layers size={16} className="text-indigo-500" />
            Konfiguration & Kod för webmanifest
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Manifest JSON */}
          <div className="bg-zinc-900 rounded-2xl p-4 text-zinc-200 relative group font-mono text-[11px]">
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-zinc-800">
              <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">manifest.webmanifest</span>
              <button
                type="button"
                onClick={() => handleCopy('manifest', getManifestSnippet())}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
              >
                {copiedCode === 'manifest' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{copiedCode === 'manifest' ? 'Kopierat!' : 'Kopiera'}</span>
              </button>
            </div>
            <pre className="overflow-x-auto text-zinc-300 max-h-36">
              {getManifestSnippet()}
            </pre>
          </div>

          {/* HTML Head snippet */}
          <div className="bg-zinc-900 rounded-2xl p-4 text-zinc-200 relative group font-mono text-[11px]">
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-zinc-800">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">HTML &lt;head&gt; taggar</span>
              <button
                type="button"
                onClick={() => handleCopy('html', getHtmlSnippet())}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
              >
                {copiedCode === 'html' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{copiedCode === 'html' ? 'Kopierat!' : 'Kopiera'}</span>
              </button>
            </div>
            <pre className="overflow-x-auto text-zinc-300 max-h-36">
              {getHtmlSnippet()}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
