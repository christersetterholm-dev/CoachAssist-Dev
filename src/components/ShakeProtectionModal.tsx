import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  VibrateOff, 
  RotateCcw, 
  CheckCircle2, 
  X, 
  Smartphone,
  ShieldAlert
} from 'lucide-react';

interface ShakeProtectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSafeReload: () => void;
  hasTypedInSession: boolean;
}

export const ShakeProtectionModal: React.FC<ShakeProtectionModalProps> = ({
  isOpen,
  onClose,
  onSafeReload,
  hasTypedInSession
}) => {
  const [isReloading, setIsReloading] = useState(false);

  if (!isOpen) return null;

  const handleReloadClick = () => {
    setIsReloading(true);
    setTimeout(() => {
      onSafeReload();
    }, 150);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-lg bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="px-6 pt-6 pb-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <VibrateOff size={22} />
              </div>
              <div>
                <h3 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight">
                  Skakskydd för iPhone & iPad
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    Undvik Apples "Ångra skriven text" på planen
                  </p>
                  {hasTypedInSession ? (
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/60">
                      Text skriven
                    </span>
                  ) : (
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700/60">
                      Skaksäkert läge
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto space-y-5 text-sm">
            {/* Why this happens */}
            <div className="bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40 rounded-2xl p-4 flex gap-3 text-amber-900 dark:text-amber-200">
              <ShieldAlert className="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" size={18} />
              <div className="space-y-1 text-xs sm:text-[13px] leading-relaxed">
                <p className="font-bold">Varför visar iPhone den här rutan?</p>
                <p className="text-amber-800/90 dark:text-amber-300/80">
                  Rutan är <strong>inte</strong> skapad av appen, utan är en inbyggd iOS-funktion från Apple (<span className="italic">"Shake to Undo"</span>). När du springer eller rör dig känner telefonens rörelsesensor av vibrationer och frågar om du vill ångra text som skrivits i webbläsaren.
                </p>
              </div>
            </div>

            {/* Permanent Solution: Recommended */}
            <div className="bg-indigo-50/50 dark:bg-indigo-950/20 border-2 border-indigo-200/80 dark:border-indigo-800/60 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-indigo-600 text-white font-black text-[10px] uppercase tracking-wider">
                    Rekommenderas
                  </span>
                  <h4 className="font-black text-indigo-950 dark:text-indigo-200 text-sm">
                    Permanent lösning i iOS (10 sekunder)
                  </h4>
                </div>
                <Smartphone size={18} className="text-indigo-600 dark:text-indigo-400" />
              </div>

              <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                Alla fotbollstränare och löpare slår av denna funktion i iPhone så att rutan aldrig dyker upp under träningar:
              </p>

              <ol className="space-y-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-indigo-200 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-300 flex items-center justify-center text-[11px] font-black shrink-0">1</span>
                  <span>Öppna iPhones app <strong>Inställningar</strong></span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-indigo-200 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-300 flex items-center justify-center text-[11px] font-black shrink-0">2</span>
                  <span>Tryck på <strong>Hjälpmedel</strong> och sedan <strong>Tryck</strong></span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-indigo-200 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-300 flex items-center justify-center text-[11px] font-black shrink-0">3</span>
                  <span>Slå av reglaget för <strong>Skaka för att ångra</strong></span>
                </li>
              </ol>
            </div>

            {/* Quick in-app reset */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/60 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-zinc-900 dark:text-white text-sm">
                  Nollställ webbläsarens skrivminne nu
                </h4>
                <RotateCcw size={16} className="text-zinc-500" />
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Om du inte vill ändra iOS-inställningen kan du nollställa webbläsarens interna skrivhistorik här. All pågående data och poäng sparas först, och sidan uppdateras på 0,5 sekunder.
              </p>
              
              <button
                type="button"
                onClick={handleReloadClick}
                disabled={isReloading}
                className="w-full py-3 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.98] cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={14} className={isReloading ? "animate-spin" : ""} />
                <span>{isReloading ? "Sparar & Nollställer..." : "Spara & Nollställ skrivminne"}</span>
              </button>
            </div>

            {/* Built-in Safety note */}
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 rounded-xl px-3.5 py-2.5">
              <CheckCircle2 size={16} className="shrink-0" />
              <span>Inbyggt skydd aktivt: Om du råkar trycka "Ångra" i Apples ruta skyddas alla dina resultat, timers och lag.</span>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-800/30 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm active:scale-95"
            >
              Jag förstår
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

interface QuickShakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const QuickShakeModal: React.FC<QuickShakeModalProps> = ({
  isOpen,
  onClose,
  onConfirm
}) => {
  const [isClearing, setIsClearing] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = () => {
    setIsClearing(true);
    setTimeout(() => {
      onConfirm();
    }, 150);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15 }}
          className="relative w-full max-w-sm bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-6 flex flex-col gap-4 text-center"
        >
          <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <VibrateOff size={24} />
          </div>

          <div>
            <h3 className="text-base font-black text-zinc-900 dark:text-white tracking-tight">
              Rensa skakminnet?
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
              All data sparas och skrivminnet nollställs direkt så att du slipper Apples "Ångra"-ruta på planen.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 mt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isClearing}
              className="w-full py-2.5 px-4 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
            >
              Avbryt
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isClearing}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {isClearing ? (
                <>
                  <RotateCcw size={13} className="animate-spin" />
                  <span>Rensar...</span>
                </>
              ) : (
                <span>Rensa nu</span>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

