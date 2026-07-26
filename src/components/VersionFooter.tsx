import React, { useState } from 'react';
import { APP_VERSION, APP_BUILD_DATE, APP_NAME } from '../version';
import { CheckCircle2, RefreshCw, X, ShieldCheck, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface VersionFooterProps {
  className?: string;
  variant?: 'badge' | 'footer';
}

export default function VersionFooter({ className = '', variant = 'footer' }: VersionFooterProps) {
  const [showModal, setShowModal] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [checkStatus, setCheckStatus] = useState<'latest' | 'reloading' | null>(null);

  const handleCheckUpdates = () => {
    setIsChecking(true);
    setCheckStatus(null);
    setTimeout(() => {
      setIsChecking(false);
      setCheckStatus('latest');
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
          for (const registration of registrations) {
            registration.update();
          }
        });
      }
    }, 800);
  };

  return (
    <>
      {variant === 'badge' ? (
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 transition-all cursor-pointer border border-indigo-200/60 dark:border-indigo-800/60 active:scale-95 shrink-0 ${className}`}
          title="Klicka för versionsinformation & uppdateringsstatus"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span>v{APP_VERSION}</span>
        </button>
      ) : (
        <footer className={`py-1 px-4 text-center select-none ${className}`}>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100/80 hover:bg-zinc-200/80 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all cursor-pointer border border-zinc-200/60 dark:border-zinc-700/50 shadow-xs active:scale-95"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="font-bold text-zinc-700 dark:text-zinc-300">{APP_NAME} v{APP_VERSION}</span>
            <span className="text-zinc-300 dark:text-zinc-600">•</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">Senaste versionen</span>
          </button>
        </footer>
      )}

      {/* Version Details Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-zinc-150 dark:border-zinc-800 relative space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X size={18} />
              </button>

              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black">
                  <ShieldCheck size={26} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight">
                    {APP_NAME} Version
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                    Programvara & Systemstatus
                  </p>
                </div>
              </div>

              <div className="bg-zinc-50 dark:bg-zinc-950 rounded-2xl p-4 border border-zinc-100 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 dark:text-zinc-400 font-medium">Installerad version</span>
                  <span className="font-mono font-bold text-zinc-900 dark:text-white bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 px-2.5 py-0.5 rounded-md border border-indigo-200/50 dark:border-indigo-800/50">
                    v{APP_VERSION}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 dark:text-zinc-400 font-medium">Senast uppdaterad</span>
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                    {APP_BUILD_DATE}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 dark:text-zinc-400 font-medium">Status</span>
                  <span className="inline-flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={14} />
                    Senaste versionen
                  </span>
                </div>
              </div>

              {/* Versioning Logic Explanation */}
              <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-900/40 text-[11px] text-zinc-600 dark:text-zinc-300 space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-indigo-600 dark:text-indigo-400">
                  <Info size={14} />
                  <span>Hur fungerar versionsnumreringen?</span>
                </div>
                <ul className="space-y-1 text-[10.5px] leading-relaxed text-zinc-500 dark:text-zinc-400 pl-4 list-disc">
                  <li><strong className="text-zinc-700 dark:text-zinc-200">Major (vX.0.0):</strong> Större design- &amp; systemomgörningar.</li>
                  <li><strong className="text-zinc-700 dark:text-zinc-200">Minor (v1.X.0):</strong> Nya funktioner, verktyg eller moduler.</li>
                  <li><strong className="text-zinc-700 dark:text-zinc-200">Patch (v1.0.X):</strong> Buggfixar, prestanda &amp; mindre justeringar.</li>
                </ul>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={handleCheckUpdates}
                  disabled={isChecking}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-100 dark:shadow-none cursor-pointer"
                >
                  <RefreshCw size={14} className={isChecking ? 'animate-spin' : ''} />
                  <span>{isChecking ? 'Söker efter uppdateringar...' : 'Sök efter ny version'}</span>
                </button>

                {checkStatus === 'latest' && (
                  <p className="text-center text-[11px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center justify-center gap-1">
                    <CheckCircle2 size={13} />
                    Du kör redan den absolut senaste versionen av CoachAssist!
                  </p>
                )}

                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 text-center leading-relaxed">
                  Appen uppdateras automatiskt i bakgrunden vid varje ny releasemoment.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
