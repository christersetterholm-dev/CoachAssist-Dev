/**
 * DICTATION: Textrutor som tål dikteringsverktyg (t.ex. tal-till-text på Macen).
 *
 * Sådana verktyg klistrar ibland in text i rutan utan att webbläsaren skickar någon
 * input-händelse. En vanlig React-styrd ruta (value + onChange) vet då inte om texten och
 * skriver över den med sitt gamla värde vid nästa omritning – texten "försvinner".
 *
 * TextInput och TextArea används precis som vanliga <input>/<textarea> med value + onChange,
 * men React skriver aldrig över det man har i rutan:
 * - rutan styrs inte av React (bara startvärdet sätts); värdet skrivs in i rutan bara när
 *   `value` ändras utifrån (t.ex. när formuläret töms eller fylls med en annan post),
 * - medan rutan har fokus kollas den några gånger i sekunden, och när man lämnar den
 *   (t.ex. trycker på Spara) eller den försvinner, så att text som kom utan händelse ändå
 *   når onChange.
 *
 * Utan `value` fungerar de som helt ostyrda rutor (defaultValue + ref, läs värdet vid sparning).
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

type FieldEl = HTMLInputElement | HTMLTextAreaElement;

// Hur ofta en fokuserad ruta kollas efter text som kom in utan händelse.
const POLL_MS = 250;

function useDictationSafe<E extends FieldEl>(
  forwardedRef: React.ForwardedRef<E>,
  value: string | number | readonly string[] | undefined,
  onChange: React.ChangeEventHandler<E> | undefined,
  onFocus: React.FocusEventHandler<E> | undefined,
  onBlur: React.FocusEventHandler<E> | undefined,
) {
  const elRef = useRef<E | null>(null);
  const controlled = value !== undefined;
  const propValue = value === undefined || value === null ? '' : String(value);
  // Det värde som appen (föräldern) senast känner till.
  const known = useRef(propValue);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const controlledRef = useRef(controlled);
  controlledRef.current = controlled;
  const timer = useRef<number | null>(null);

  const setRef = useCallback((el: E | null) => {
    // Den senaste rutan behålls även när den tas bort, så att texten kan läsas en sista gång.
    if (el) elRef.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  }, [forwardedRef]);

  // Nytt värde utifrån: skriv in det i rutan. Samma värde som förut: rör inte rutan.
  useLayoutEffect(() => {
    if (!controlled) return;
    const el = elRef.current;
    if (propValue !== known.current) {
      known.current = propValue;
      if (el && el.value !== propValue) el.value = propValue;
    }
  }, [controlled, propValue]);

  // Text som finns i rutan men som appen inte vet om skickas vidare som en vanlig ändring.
  const sync = useCallback(() => {
    const el = elRef.current;
    // Ostyrda rutor (utan value) läses av appen själv vid sparning.
    if (!el || !controlledRef.current || el.value === known.current) return;
    known.current = el.value;
    onChangeRef.current?.({ target: el, currentTarget: el, type: 'change' } as unknown as React.ChangeEvent<E>);
  }, []);

  const stopPoll = () => { if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; } };
  // Rutan försvinner (t.ex. Enter stänger rutan): skicka med text som kom utan händelse.
  useEffect(() => () => { stopPoll(); sync(); }, [sync]);

  return {
    ref: setRef,
    ...(controlled ? { defaultValue: propValue } : {}),
    onChange: (e: React.ChangeEvent<E>) => {
      known.current = e.target.value;
      onChange?.(e);
    },
    onFocus: (e: React.FocusEvent<E>) => {
      stopPoll();
      timer.current = window.setInterval(sync, POLL_MS);
      onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent<E>) => {
      stopPoll();
      sync();
      onBlur?.(e);
    },
  };
}

export type TextInputProps = React.InputHTMLAttributes<HTMLInputElement>;
export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  ({ value, onChange, onFocus, onBlur, ...rest }, ref) => (
    <input {...rest} {...useDictationSafe(ref, value, onChange, onFocus, onBlur)} />
  ),
);
TextInput.displayName = 'TextInput';

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ value, onChange, onFocus, onBlur, ...rest }, ref) => (
    <textarea {...rest} {...useDictationSafe(ref, value, onChange, onFocus, onBlur)} />
  ),
);
TextArea.displayName = 'TextArea';
