/**
 * Visas för den som inte är inloggad (och inte öppnat en delad poängliga).
 */
import { LogIn, Calendar, Trophy, Shirt, Users } from 'lucide-react';
import { Button } from './ui';

export default function WelcomeScreen({ onLogin, clubName }: { onLogin: () => void; clubName?: string }) {
  const features = [
    { icon: <Calendar size={20} />, title: 'Kalender & kallelser', text: 'Se kommande träningar och matcher och svara direkt.' },
    { icon: <Trophy size={20} />, title: 'Tävlingsmoment', text: 'Poäng under träningen samlas i lagets poängliga.' },
    { icon: <Shirt size={20} />, title: 'Uppställning & taktik', text: 'Laguppställningar och taktiktavla – även på storskärm.' },
    { icon: <Users size={20} />, title: 'Truppen', text: 'Spelare, ledare och närvaro på ett ställe.' },
  ];
  return (
    <div className="fixed inset-0 overflow-y-auto bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="min-h-full max-w-md mx-auto px-6 py-12 pt-safe pb-safe flex flex-col justify-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xl font-extrabold tracking-tight shadow-lg">
          CA
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">CoachAssist</h1>
        <p className="mt-2 text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {clubName ? `${clubName} – ` : ''}lagets app för träningar, matcher och tävlingar.
        </p>

        <Button size="lg" block className="mt-8" icon={<LogIn size={20} />} onClick={onLogin}>
          Logga in
        </Button>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 text-center">
          Ny spelare? Be din tränare om en inbjudningslänk.
        </p>

        <ul className="mt-10 space-y-4">
          {features.map(f => (
            <li key={f.title} className="flex gap-3">
              <span className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0">{f.icon}</span>
              <div>
                <div className="font-semibold text-sm">{f.title}</div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">{f.text}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
