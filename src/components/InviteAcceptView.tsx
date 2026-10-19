import React, { useEffect, useState } from 'react';
import { Users, Loader2, AlertTriangle, CheckCircle2, LogIn } from 'lucide-react';
import { getInviteInfo, acceptInvite, signInWithGoogle } from '../lib/firebase';

// Sidan som visas när någon öppnar en inbjudningslänk (?invite=...).
export default function InviteAcceptView({ token }: { token: string }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getInviteInfo>> | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const loggedInEmail = (() => {
    try { return localStorage.getItem('token') ? JSON.parse(localStorage.getItem('cached_auth_user') || '{}').email || '' : ''; } catch { return ''; }
  })();

  useEffect(() => {
    getInviteInfo(token).then((i) => {
      setInfo(i);
      if (i.email && !i.email.endsWith('@member.coachassist.app')) setEmail(i.email);
    }).catch(() => setInfo({ valid: false, reason: 'not_found' }));
  }, [token]);

  const finish = () => {
    setDone(true);
    setTimeout(() => { window.location.href = '/'; }, 1200);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Lösenordet måste vara minst 8 tecken.');
    if (password !== password2) return setError('Lösenorden matchar inte.');
    setBusy(true);
    try {
      await acceptInvite(token, { email, password });
      finish();
    } catch (err: any) {
      setError(err.message);
      if (err.code === 'account_exists') setNeedsLogin(true);
    } finally {
      setBusy(false);
    }
  };

  const handleUseLoggedIn = async () => {
    setError('');
    setBusy(true);
    try {
      await acceptInvite(token);
      finish();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleLoginFirst = async () => {
    setError('');
    try {
      await signInWithGoogle();
      await handleUseLoggedIn();
    } catch (err: any) {
      if (err?.message) setError(err.message);
    }
  };

  const reasonText: Record<string, string> = {
    used: 'Den här inbjudan har redan använts. Logga in med ditt konto i stället.',
    expired: 'Inbjudan har gått ut. Be din tränare om en ny länk.',
    not_found: 'Inbjudan hittades inte. Kontrollera att du kopierat hela länken.',
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl p-6 sm:p-8 flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 dark:bg-zinc-800 rounded-xl text-indigo-600 dark:text-indigo-400"><Users size={20} /></div>
          <h1 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-wide">Truppio</h1>
        </div>

        {!info && (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={16} className="animate-spin" /> Hämtar inbjudan…</div>
        )}

        {info && !info.valid && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-sm">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <span>{reasonText[info.reason || 'not_found'] || reasonText.not_found}</span>
            </div>
            <a href="/" className="block text-center w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold">Till appen</a>
          </div>
        )}

        {info && info.valid && done && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-sm font-bold">
            <CheckCircle2 size={18} /> Klart! Du kopplas nu in i laget…
          </div>
        )}

        {info && info.valid && !done && (
          <>
            <div className="space-y-1">
              <h2 className="text-xl font-black text-zinc-900 dark:text-white">Välkommen, {info.fullName}!</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Du är inbjuden till <strong>{info.clubName}</strong>
                {info.teamNames && info.teamNames.length > 0 ? <> – {info.teamNames.join(', ')}</> : null}.
                Skapa ett konto för att se lagets aktiviteter och svara på kallelser.
              </p>
            </div>

            {loggedInEmail && !needsLogin ? (
              <div className="space-y-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Du är inloggad som <strong>{loggedInEmail}</strong>.</p>
                <button onClick={handleUseLoggedIn} disabled={busy} className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold">
                  {busy ? 'Kopplar…' : `Koppla till ${loggedInEmail}`}
                </button>
              </div>
            ) : needsLogin ? (
              <div className="space-y-3">
                <button onClick={handleLoginFirst} className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold inline-flex items-center justify-center gap-2">
                  <LogIn size={18} /> Logga in och gå med
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-3">
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500">E-post</span>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-white" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500">Välj lösenord (minst 8 tecken)</span>
                  <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-white" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500">Upprepa lösenord</span>
                  <input type="password" required value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password"
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-white" />
                </label>
                <button type="submit" disabled={busy} className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold">
                  {busy ? 'Skapar konto…' : 'Skapa konto och gå med'}
                </button>
                <button type="button" onClick={() => setNeedsLogin(true)} className="w-full text-xs text-indigo-600 dark:text-indigo-400 underline">
                  Har du redan ett konto? Logga in i stället
                </button>
              </form>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
