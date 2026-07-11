import React, { useState } from 'react';
import { Globe, RefreshCcw, Home, Settings, ExternalLink, ShieldCheck, Trophy, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TeamPageProps {
  initialUrl?: string;
  onUpdateUrl: (url: string) => void;
  initialAdminUrl?: string;
  onUpdateAdminUrl: (url: string) => void;
  initialSeriesUrl?: string;
  onUpdateSeriesUrl: (url: string) => void;
}

export default function TeamPage({ 
  initialUrl = '', 
  onUpdateUrl,
  initialAdminUrl = '',
  onUpdateAdminUrl,
  initialSeriesUrl = '',
  onUpdateSeriesUrl
}: TeamPageProps) {
  const [url, setUrl] = useState(initialUrl);
  const [isEditing, setIsEditing] = useState(!initialUrl);
  const [tempUrl, setTempUrl] = useState(initialUrl);
  const [tempAdminUrl, setTempAdminUrl] = useState(initialAdminUrl);
  const [tempSeriesUrl, setTempSeriesUrl] = useState(initialSeriesUrl);
  const [iframeKey, setIframeKey] = useState(0);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    
    const formatUrl = (u: string) => {
      let formatted = u.trim();
      if (formatted && !/^https?:\/\//i.test(formatted)) {
        formatted = 'https://' + formatted;
      }
      return formatted;
    };

    const formattedTeamUrl = formatUrl(tempUrl);
    const formattedAdminUrl = formatUrl(tempAdminUrl);
    const formattedSeriesUrl = formatUrl(tempSeriesUrl);

    setUrl(formattedTeamUrl);
    onUpdateUrl(formattedTeamUrl);
    onUpdateAdminUrl(formattedAdminUrl);
    onUpdateSeriesUrl(formattedSeriesUrl);
    
    setIsEditing(false);
    setIframeKey(prev => prev + 1);
  };

  const handleReset = () => {
    setIframeKey(prev => prev + 1);
  };

  const handleGoHome = () => {
    setUrl(initialUrl);
    setTempUrl(initialUrl);
    setIframeKey(prev => prev + 1);
  };

  if (isEditing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-950 overflow-y-auto">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-[32px] p-8 shadow-2xl border border-zinc-100 dark:border-zinc-800"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">Inställningar</h2>
            {initialUrl && (
              <button 
                onClick={() => setIsEditing(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                <X size={24} />
              </button>
            )}
          </div>
          
          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 ml-1">Lagsida (Visas här)</label>
              <div className="relative group">
                <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                <input
                  type="text"
                  value={tempUrl}
                  onChange={(e) => setTempUrl(e.target.value)}
                  placeholder="https://laget.se/..."
                  className="w-full pl-12 pr-5 py-4 bg-zinc-50 dark:bg-zinc-950 border-2 border-zinc-100 dark:border-zinc-800 rounded-2xl text-base font-bold outline-none focus:border-indigo-600 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 ml-1">Adminsida (Extern länk)</label>
              <div className="relative group">
                <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                <input
                  type="text"
                  value={tempAdminUrl}
                  onChange={(e) => setTempAdminUrl(e.target.value)}
                  placeholder="Länk till adminverktyg..."
                  className="w-full pl-12 pr-5 py-4 bg-zinc-50 dark:bg-zinc-950 border-2 border-zinc-100 dark:border-zinc-800 rounded-2xl text-base font-bold outline-none focus:border-indigo-600 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 ml-1">Serien/Tabellen (Extern länk)</label>
              <div className="relative group">
                <Trophy className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                <input
                  type="text"
                  value={tempSeriesUrl}
                  onChange={(e) => setTempSeriesUrl(e.target.value)}
                  placeholder="Länk till fotbollsförbundet..."
                  className="w-full pl-12 pr-5 py-4 bg-zinc-50 dark:bg-zinc-950 border-2 border-zinc-100 dark:border-zinc-800 rounded-2xl text-base font-bold outline-none focus:border-indigo-600 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black active:scale-95 shadow-lg shadow-indigo-100 dark:shadow-none transition-all"
            >
              Spara inställningar
            </button>
          </form>
          
          <p className="mt-6 text-[10px] text-zinc-400 text-center leading-relaxed">
            Obs: Lagsidan bäddas in i appen. Admin och Serien öppnas i en ny flik för bäst kompatibilitet.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-zinc-100 dark:bg-zinc-900">
      {/* Browser-like Toolbar */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 shrink-0 shadow-sm z-10 w-full">
        <div className="flex items-center justify-between px-4 py-2 max-w-4xl mx-auto w-full">
          <div className="flex items-center gap-1 sm:gap-2">
            <button 
              onClick={handleGoHome}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-zinc-500 transition-colors"
              title="Hem"
            >
              <Home size={18} />
            </button>
            <button 
              onClick={handleReset}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-zinc-500 transition-colors"
              title="Uppdatera"
            >
              <RefreshCcw size={18} />
            </button>
          </div>

          <div className="hidden sm:flex flex-1 max-w-lg mx-4">
            <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-100 dark:bg-zinc-950 rounded-full border border-zinc-200 dark:border-zinc-800 overflow-hidden w-full">
              <Globe size={12} className="text-zinc-400 shrink-0" />
              <span className="text-[10px] font-bold text-zinc-500 truncate select-all">{url}</span>
            </div>
          </div>

          {/* Mobile address indicator (just the icon) */}
          {!isEditing && (
            <div className="flex sm:hidden flex-1 justify-center">
              <div className="flex items-center gap-2 px-3 py-1 bg-zinc-50 dark:bg-zinc-950 rounded-full border border-zinc-100 dark:border-zinc-800">
                <Globe size={10} className="text-zinc-400" />
                <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-tighter truncate max-w-[80px]">
                  {(() => {
                    try {
                      return (new URL(url).hostname).replace('www.', '');
                    } catch (e) {
                      return 'Webbsida';
                    }
                  })()}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1 sm:gap-2">
            {initialAdminUrl && (
              <a 
                href={initialAdminUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-zinc-500 hover:text-indigo-600 transition-colors"
                title="Öppna Adminsida"
              >
                <ShieldCheck size={18} />
              </a>
            )}
            {initialSeriesUrl && (
              <a 
                href={initialSeriesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-zinc-500 hover:text-indigo-600 transition-colors"
                title="Öppna Serien/Tabellen"
              >
                <Trophy size={18} />
              </a>
            )}
            <button 
              onClick={() => setIsEditing(true)}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-zinc-500 transition-colors"
              title="Inställningar"
            >
              <Settings size={18} />
            </button>
            <a 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-indigo-600 transition-colors"
              title="Öppna i ny flik"
            >
              <ExternalLink size={18} />
            </a>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 relative min-h-0">
        <iframe
          key={iframeKey}
          src={url}
          className="w-full h-full border-none bg-white"
          title="Lagsida"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
        
        {/* Help Tip Overlay (briefly shown) */}
        <AnimatePresence>
          {!initialUrl && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-zinc-900/80 backdrop-blur-md text-white text-[10px] font-bold rounded-full pointer-events-none"
            >
              Använd hemikonen för att återgå till startsidan
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
