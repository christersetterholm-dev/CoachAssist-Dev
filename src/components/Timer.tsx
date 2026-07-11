import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Bell, BellOff, Plus, Minus, Check, X, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TimerProps {
  defaultMinutes?: number;
  defaultSeconds?: number;
  onSaveDefault?: (minutes: number, seconds: number) => void;
}

export default function Timer({ defaultMinutes = 4, defaultSeconds = 0, onSaveDefault }: TimerProps) {
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [presetMinutes, setPresetMinutes] = useState(defaultMinutes);
  const [presetSeconds, setPresetSeconds] = useState(defaultSeconds);
  const [isActive, setIsActive] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  
  // Ref to track the absolute end time
  const endTimeRef = useRef<number | null>(null);
  // Ref to track the total duration when paused/stopped
  const remainingSecondsRef = useRef<number>(defaultMinutes * 60 + defaultSeconds);
  // Ref for the main timer loop
  const timerIntervalRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const keepAliveOscRef = useRef<OscillatorNode | null>(null);

  // Check notification permission on mount
  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    }
  };

  // Request wake lock to keep screen on
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err) {
        console.warn('Wake Lock request failed:', err);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release()
        .then(() => {
          wakeLockRef.current = null;
        });
    }
  };

  // Update timer when default props change (e.g. switching games)
  useEffect(() => {
    if (!isStarted) {
      setMinutes(defaultMinutes);
      setSeconds(defaultSeconds);
      setPresetMinutes(defaultMinutes);
      setPresetSeconds(defaultSeconds);
      remainingSecondsRef.current = defaultMinutes * 60 + defaultSeconds;
    }
  }, [defaultMinutes, defaultSeconds, isStarted]);

  const totalSeconds = minutes * 60 + seconds;

  const audioContextRef = useRef<AudioContext | null>(null);
  const alarmIntervalRef = useRef<number | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (alarmIntervalRef.current) {
        window.clearInterval(alarmIntervalRef.current);
      }
      if (timerIntervalRef.current) {
        window.clearInterval(timerIntervalRef.current);
      }
      stopKeepAlive();
      releaseWakeLock();
    };
  }, []);

  const syncTimer = () => {
    if (!isActive || !endTimeRef.current) return;

    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((endTimeRef.current - now) / 1000));
    
    if (remaining !== remainingSecondsRef.current) {
      remainingSecondsRef.current = remaining;
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      setMinutes(m);
      setSeconds(s);

      if (remaining === 0) {
        setIsActive(false);
        setIsStarted(false);
        setIsFinished(true);
        if (!isMuted) {
          playAlarm();
        }
        if (timerIntervalRef.current) {
          window.clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }
    }
  };

  useEffect(() => {
    if (isActive) {
      // Use a more frequent interval to catch the precise second change
      timerIntervalRef.current = window.setInterval(syncTimer, 200);
    } else {
      if (timerIntervalRef.current) {
        window.clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        window.clearInterval(timerIntervalRef.current);
      }
    };
  }, [isActive, isMuted]);

  // Sync when coming back to the tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isActive) {
        syncTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isActive]);

  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    
    // Start a silent oscillator to keep the audio process alive on mobile
    if (!keepAliveOscRef.current && audioContextRef.current) {
      const g = audioContextRef.current.createGain();
      g.gain.setValueAtTime(0.0001, audioContextRef.current.currentTime);
      const osc = audioContextRef.current.createOscillator();
      osc.connect(g);
      g.connect(audioContextRef.current.destination);
      osc.start();
      keepAliveOscRef.current = osc;
    }
  };

  const stopKeepAlive = () => {
    if (keepAliveOscRef.current) {
      try {
        keepAliveOscRef.current.stop();
        keepAliveOscRef.current.disconnect();
      } catch (e) {
        // Ignore if already stopped
      }
      keepAliveOscRef.current = null;
    }
  };

  const playAlarm = () => {
    initAudio();
    if (!audioContextRef.current) return;
    
    if (notificationPermission === 'granted' && document.visibilityState !== 'visible') {
      try {
        new Notification('Tiden är ute!', {
          body: 'Tävlingsmomentet har räknat ner till noll.',
          icon: '/favicon.ico',
          tag: 'timer-alarm',
          silent: false
        });
      } catch (e) {
        console.warn('Could not show notification:', e);
      }
    }

    // Safety check: clear any existing interval before starting a new one
    if (alarmIntervalRef.current) {
      window.clearInterval(alarmIntervalRef.current);
    }

    const context = audioContextRef.current;
    
    const triggerAlarm = () => {
      try {
        if (context.state === 'suspended') {
          context.resume();
        }
        
        const now = context.currentTime;
        const beepLength = 0.25;
        
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(880, now);
        
        oscillator.connect(gain);
        gain.connect(context.destination);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
        gain.gain.setValueAtTime(0.2, now + beepLength - 0.02);
        gain.gain.linearRampToValueAtTime(0, now + beepLength);
        
        oscillator.start(now);
        oscillator.stop(now + beepLength);

        if ('vibrate' in navigator) {
          navigator.vibrate(200);
        }
      } catch (e) {
        console.error("Audio trigger failed:", e);
      }
    };

    triggerAlarm();
    alarmIntervalRef.current = window.setInterval(triggerAlarm, 1000);
  };

  const stopAlarm = () => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    setIsFinished(false);
    resetToPreset();
    releaseWakeLock();
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    
    // If the alarm is currently sounding and we mute, stop it
    if (newMuted && alarmIntervalRef.current) {
      window.clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    } 
    // If we unmute and it's finished, start it back up
    else if (!newMuted && isFinished) {
      playAlarm();
    }
  };

  const toggleTimer = () => {
    initAudio();
    if (isFinished) {
      stopAlarm();
      return;
    }
    
    if (!isStarted && totalSeconds > 0) {
      setIsStarted(true);
      setPresetMinutes(minutes);
      setPresetSeconds(seconds);
      remainingSecondsRef.current = totalSeconds;
    }

    const newActiveState = !isActive;
    if (newActiveState) {
      // Request permission on start if not already asked
      requestNotificationPermission();
      
      // Calculate end time based on CURRENT remaining seconds
      endTimeRef.current = Date.now() + (remainingSecondsRef.current * 1000);
      requestWakeLock();
      initAudio(); // Ensure audio context is ready
    } else {
      // Store exact remaining time when pausing
      if (endTimeRef.current) {
        const now = Date.now();
        remainingSecondsRef.current = Math.max(0, Math.ceil((endTimeRef.current - now) / 1000));
        endTimeRef.current = null;
      }
      releaseWakeLock();
      stopKeepAlive();
    }
    
    setIsActive(newActiveState);
  };

  const resetToPreset = () => {
    setIsActive(false);
    setIsStarted(false);
    setIsFinished(false);
    setMinutes(presetMinutes);
    setSeconds(presetSeconds);
    remainingSecondsRef.current = presetMinutes * 60 + presetSeconds;
    endTimeRef.current = null;
    releaseWakeLock();
    stopKeepAlive();
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  };

  const resetToDefault = () => {
    setIsActive(false);
    setIsStarted(false);
    setIsFinished(false);
    setMinutes(defaultMinutes);
    setSeconds(defaultSeconds);
    setPresetMinutes(defaultMinutes);
    setPresetSeconds(defaultSeconds);
    remainingSecondsRef.current = defaultMinutes * 60 + defaultSeconds;
    endTimeRef.current = null;
    releaseWakeLock();
    stopKeepAlive();
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  };

  const handleSave = () => {
    if (onSaveDefault) {
      onSaveDefault(minutes, seconds);
      setShowSavedFeedback(true);
      setTimeout(() => setShowSavedFeedback(false), 1500);
    }
  };

  const adjustTime = (type: 'min' | 'sec', amount: number) => {
    if (isStarted) return;
    
    if (type === 'min') {
      const next = Math.max(0, Math.min(99, minutes + amount));
      setMinutes(next);
      setPresetMinutes(next);
    } else {
      let nextSec = seconds + amount;
      let nextMin = minutes;
      
      if (nextSec >= 60) {
        nextMin = Math.min(99, nextMin + 1);
        nextSec = 0;
      } else if (nextSec < 0) {
        if (nextMin > 0) {
          nextMin -= 1;
          nextSec = 50;
        } else {
          nextSec = 0;
        }
      }
      
      setMinutes(nextMin);
      setSeconds(nextSec);
      setPresetMinutes(nextMin);
      setPresetSeconds(nextSec);
    }
    remainingSecondsRef.current = (type === 'min' ? Math.max(0, minutes + amount) : minutes) * 60 + (type === 'sec' ? seconds + amount : seconds);
    // Boundary check for remainingSecondsRef
    if (remainingSecondsRef.current < 0) remainingSecondsRef.current = 0;
  };

  const quickAdd = (mins: number) => {
    if (isStarted) return;
    const next = Math.min(99, minutes + mins);
    setMinutes(next);
    setPresetMinutes(next);
    remainingSecondsRef.current = next * 60 + seconds;
  };

  const formatTime = (m: number, s: number) => {
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className={`bg-white dark:bg-zinc-900 rounded-3xl p-3 sm:p-4 border-2 transition-all duration-300 shadow-xl ${
      isFinished ? 'border-red-500 animate-pulse' : 'border-zinc-100 dark:border-zinc-800'
    }`}>
      <div className="flex flex-col gap-3">
        {/* Main Display & Top Controls */}
        {notificationPermission === 'denied' && !isStarted && (
          <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded-xl border border-amber-100 dark:border-amber-800 text-center">
            Aviseringar blockerade - tillåt dem för alarm vid låst skärm
          </div>
        )}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className={`font-black text-zinc-900 dark:text-white tabular-nums leading-none transition-all duration-300 ${
              isStarted ? 'text-6xl sm:text-7xl' : 'text-4xl sm:text-5xl'
            }`}>
              {formatTime(minutes, seconds)}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button 
              onClick={toggleMute}
              className={`p-2.5 rounded-xl transition-all ${
                isMuted ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400' : 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600'
              }`}
            >
              {isMuted ? <BellOff size={18} /> : <Bell size={18} />}
            </button>
            
            {isStarted && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={toggleTimer}
                  className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-90 ${
                    isActive 
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' 
                      : 'bg-indigo-600 text-white'
                  }`}
                >
                  {isActive ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
                </button>
                <button
                  onClick={resetToPreset}
                  className="w-11 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-500 flex items-center justify-center active:scale-90 transition-all"
                  title="Avbryt"
                >
                  <X size={22} strokeWidth={3} />
                </button>
              </div>
            )}

            {!isStarted && !isFinished && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleSave}
                  className={`p-2.5 rounded-xl transition-all active:scale-90 flex items-center justify-center ${
                    showSavedFeedback 
                      ? 'bg-green-500 text-white' 
                      : 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 hover:bg-indigo-100'
                  }`}
                  title="Spara som standard"
                >
                  <AnimatePresence mode="wait">
                    {showSavedFeedback ? (
                      <motion.div
                        key="check"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                      >
                        <Check size={18} strokeWidth={3} />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="save"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                      >
                        <Save size={18} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </button>
                <button
                  onClick={resetToDefault}
                  className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 transition-all active:rotate-[-90deg]"
                  title="Återställ till standard"
                >
                  <RotateCcw size={18} />
                </button>
              </div>
            )}
          </div>
        </div>

        {!isStarted && !isFinished && (
          <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider -mt-1">
            Standard: {formatTime(defaultMinutes, defaultSeconds)} • Spara för att ändra
          </div>
        )}

        {/* Setup Controls Area */}
        <AnimatePresence mode="wait">
          {isFinished ? (
            <motion.button
              key="finished"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={stopAlarm}
              className="w-full py-4 bg-red-500 text-white rounded-2xl font-black text-xl flex items-center justify-center gap-3 shadow-lg shadow-red-200 dark:shadow-none active:scale-95 transition-all"
            >
              <Check size={24} strokeWidth={3} />
              KLAR! ÅTERSTÄLL
            </motion.button>
          ) : !isStarted && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-3 overflow-hidden"
            >
              {/* Time Adjustment Grid */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-2 rounded-xl border border-zinc-100 dark:border-zinc-700 flex flex-col items-center gap-1">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase">Minuter</span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => adjustTime('min', -1)} className="p-1.5 bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                      <Minus size={16} />
                    </button>
                    <span className="text-xl font-black min-w-[2ch] text-center">{minutes}</span>
                    <button onClick={() => adjustTime('min', 1)} className="p-1.5 bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-2 rounded-xl border border-zinc-100 dark:border-zinc-700 flex flex-col items-center gap-1">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase">Sekunder</span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => adjustTime('sec', -10)} className="p-1.5 bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                      <Minus size={16} />
                    </button>
                    <span className="text-xl font-black min-w-[2ch] text-center">{seconds.toString().padStart(2, '0')}</span>
                    <button onClick={() => adjustTime('sec', 10)} className="p-1.5 bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Add Buttons */}
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                {[1, 2, 4, 5, 10].map(m => (
                  <button
                    key={m}
                    onClick={() => quickAdd(m)}
                    className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 rounded-lg font-bold text-xs whitespace-nowrap border border-indigo-100 dark:border-indigo-900/50 active:scale-95 transition-all"
                  >
                    +{m}m
                  </button>
                ))}
                <button
                  onClick={() => { setMinutes(0); setSeconds(0); setPresetMinutes(0); setPresetSeconds(0); }}
                  className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 rounded-lg font-bold text-xs whitespace-nowrap active:scale-95 transition-all"
                >
                  Nolla
                </button>
              </div>

              <button
                onClick={toggleTimer}
                disabled={totalSeconds === 0}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-black text-lg flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 dark:shadow-none active:scale-95 disabled:opacity-50 disabled:active:scale-100 transition-all"
              >
                <Play size={20} fill="currentColor" />
                STARTA
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
