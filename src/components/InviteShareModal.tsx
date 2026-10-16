import { useState } from 'react';
import { X, Copy, Check, Share2, Loader2, AlertTriangle } from 'lucide-react';

// Visar en skapad inbjudningslänk som tränaren kan kopiera eller dela.
export default function InviteShareModal({ name, link, expiresAt, error, loading, onClose }: {
  name: string; link?: string; expiresAt?: number; error?: string; loading?: boolean; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const message = link ? `Hej ${name.split(' ')[0]}! Här är din inbjudan till lagets app: ${link}` : '';

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(message); } catch {
      const ta = document.createElement('textarea'); ta.value = message; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const share = async () => {
    if (link && (navigator as any).share) {
      try { await (navigator as any).share({ title: 'Inbjudan', text: message }); } catch {}
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-zinc-900 dark:text-white">Bjud in {name}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"><X size={18} /></button>
        </div>
        {loading && <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={16} className="animate-spin" /> Skapar länk…</div>}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-sm">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}
        {link && (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Skicka länken till {name.split(' ')[0]} via sms, WhatsApp eller mejl. Den är personlig och gäller i
              {expiresAt ? ` ${Math.round((expiresAt - Date.now()) / 86400000)} dagar` : ' 30 dagar'}. En ny länk ersätter den gamla.
            </p>
            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs break-all text-zinc-700 dark:text-zinc-300 select-all">{link}</div>
            <div className="flex gap-2">
              <button onClick={copy} className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm inline-flex items-center justify-center gap-2">
                {copied ? <><Check size={16} /> Kopierat</> : <><Copy size={16} /> Kopiera meddelande</>}
              </button>
              {typeof navigator !== 'undefined' && (navigator as any).share && (
                <button onClick={share} className="px-4 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-bold text-sm inline-flex items-center gap-2">
                  <Share2 size={16} /> Dela
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
