/**
 * Gemensamma byggklossar för hela appen. Använd dessa i stället för att skriva egna
 * knapp-/kortklasser i varje vy, så att appen ser likadan ut överallt.
 */
import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/* ---------- Knappar ---------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 shadow-sm',
  secondary: 'bg-white text-zinc-800 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-750',
  ghost: 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-xl',
  md: 'h-11 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2 rounded-2xl',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  block?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', icon, block, className, children, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex items-center justify-center font-semibold transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60',
        buttonVariants[variant],
        buttonSizes[size],
        block && 'w-full',
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
);
Button.displayName = 'Button';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string; // visas som verktygstips och läses upp av skärmläsare
  active?: boolean;
  badge?: number | boolean;
  tone?: 'default' | 'primary';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, active, badge, tone = 'default', className, children, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      className={cx(
        'relative w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-xl transition-all active:scale-95 cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60',
        active || tone === 'primary'
          ? 'bg-indigo-600 text-white dark:bg-indigo-500'
          : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
        className
      )}
      {...rest}
    >
      {children}
      {badge ? (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[18px] text-center ring-2 ring-white dark:ring-zinc-900">
          {typeof badge === 'number' ? (badge > 9 ? '9+' : badge) : ''}
        </span>
      ) : null}
    </button>
  )
);
IconButton.displayName = 'IconButton';

/* ---------- Kort och sektioner ---------- */

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement> & { padded?: boolean; interactive?: boolean }> = ({
  padded = true,
  interactive,
  className,
  children,
  ...rest
}) => (
  <div
    className={cx(
      'bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
      padded && 'p-4 sm:p-5',
      interactive && 'transition-all hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md cursor-pointer active:scale-[0.995]',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);

export const SectionHeader: React.FC<{ title: string; icon?: React.ReactNode; action?: React.ReactNode; className?: string }> = ({
  title,
  icon,
  action,
  className,
}) => (
  <div className={cx('flex items-center justify-between gap-3 mb-3', className)}>
    <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-500 dark:text-zinc-400">
      {icon}
      {title}
    </h2>
    {action}
  </div>
);

/* ---------- Flikar (segmenterad kontroll) ---------- */

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  size = 'md',
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg'; // lg = tryckyta 40 px
}) {
  return (
    <div
      role="tablist"
      className={cx(
        'flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-2xl overflow-x-auto no-scrollbar',
        className
      )}
    >
      {tabs.map(tab => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cx(
              'flex-1 min-w-fit inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold whitespace-nowrap transition-all cursor-pointer',
              size === 'sm' ? 'h-8 px-3 text-xs' : size === 'lg' ? 'h-10 px-4 text-sm' : 'h-9 px-3.5 text-sm',
              selected
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span
                className={cx(
                  'min-w-[20px] h-5 px-1.5 rounded-full text-[11px] leading-5 font-bold',
                  selected ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Märken ---------- */

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  brand: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  danger: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
};

export const Badge: React.FC<{ tone?: BadgeTone; icon?: React.ReactNode; className?: string; children: React.ReactNode }> = ({
  tone = 'neutral',
  icon,
  className,
  children,
}) => (
  <span className={cx('inline-flex items-center gap-1 h-6 px-2 rounded-lg text-xs font-semibold whitespace-nowrap', badgeTones[tone], className)}>
    {icon}
    {children}
  </span>
);

/* ---------- Tomt läge ---------- */

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  text?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ icon, title, text, action, className }) => (
  <div className={cx('flex flex-col items-center justify-center text-center px-6 py-10', className)}>
    {icon && (
      <div className="w-14 h-14 mb-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
        {icon}
      </div>
    )}
    <h3 className="text-base font-bold text-zinc-900 dark:text-white">{title}</h3>
    {text && <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm leading-relaxed">{text}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

/* ---------- Avatar ---------- */

export const Avatar: React.FC<{ name?: string; photoUrl?: string | null; size?: number; className?: string }> = ({
  name,
  photoUrl,
  size = 36,
  className,
}) => {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s.charAt(0).toUpperCase())
    .join('');
  return (
    <span
      className={cx('inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
    >
      {photoUrl ? <img src={photoUrl} alt={name || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : initials}
    </span>
  );
};

/* ---------- Ark (bottenark på mobil, dialog på större skärm) ---------- */

export const Sheet: React.FC<{
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: 'bottom' | 'right';
}> = ({ open, onClose, title, children, footer, side = 'bottom' }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const panelClass =
    side === 'right'
      ? 'fixed z-[70] top-0 right-0 bottom-0 w-full max-w-sm bg-white dark:bg-zinc-900 shadow-2xl flex flex-col pt-safe'
      : 'fixed z-[70] left-0 right-0 bottom-0 sm:left-1/2 sm:right-auto sm:bottom-auto sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[440px] max-h-[88vh] bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col pb-safe';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="sheet-backdrop"
            className="fixed inset-0 z-[69] bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            key="sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={panelClass}
            initial={side === 'right' ? { x: '100%' } : { y: 40, opacity: 0 }}
            animate={side === 'right' ? { x: 0 } : { y: 0, opacity: 1 }}
            exit={side === 'right' ? { x: '100%' } : { y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            {side === 'bottom' && <div className="sm:hidden mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />}
            {title && (
              <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{title}</h2>
                <IconButton label="Stäng" onClick={onClose}>
                  <X size={20} />
                </IconButton>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-3 pb-3">{children}</div>
            {footer && <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800">{footer}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/* ---------- Menyrad (för listor i ark och menyer) ---------- */

export const MenuItem: React.FC<{
  icon?: React.ReactNode;
  label: string;
  description?: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  tone?: 'default' | 'danger';
  active?: boolean;
}> = ({ icon, label, description, onClick, trailing, tone = 'default', active }) => (
  <button
    type="button"
    onClick={onClick}
    className={cx(
      'w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors cursor-pointer',
      active ? 'bg-indigo-50 dark:bg-indigo-950/50' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
      tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-zinc-800 dark:text-zinc-100'
    )}
  >
    {icon && (
      <span
        className={cx(
          'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
          tone === 'danger' ? 'bg-red-50 dark:bg-red-950/40' : active ? 'bg-indigo-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
        )}
      >
        {icon}
      </span>
    )}
    <span className="flex-1 min-w-0">
      <span className="block text-sm font-semibold truncate">{label}</span>
      {description && <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">{description}</span>}
    </span>
    {trailing}
  </button>
);

/* ---------- Textrutor som tål diktering (se TextField.tsx) ---------- */

export { TextInput, TextArea } from './TextField';
export type { TextInputProps, TextAreaProps } from './TextField';
