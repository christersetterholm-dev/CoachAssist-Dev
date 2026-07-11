import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Pipette, ChevronDown, ChevronUp } from 'lucide-react';
import { PRESET_COLORS, VEST_COLORS } from '../types';

interface ColorPickerProps {
  selectedColor: string;
  onChange: (color: string) => void;
  direction?: 'up' | 'down';
  minimal?: boolean;
}

export default function ColorPicker({ selectedColor, onChange, direction = 'down', minimal = false }: ColorPickerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [portalPosition, setPortalPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (isExpanded && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 280; // w-64 to w-72 approx
      const viewportWidth = window.innerWidth;
      
      let left = rect.left + rect.width / 2 - dropdownWidth / 2;
      
      // Keep within viewport
      if (left < 10) left = 10;
      if (left + dropdownWidth > viewportWidth - 10) {
        left = viewportWidth - dropdownWidth - 10;
      }

      const top = direction === 'up' 
        ? rect.top - 12 // Space for margin
        : rect.bottom + 12;

      setPortalPosition({ top, left });

      const handleClickOutside = (e: MouseEvent) => {
        const isClickInsideButton = buttonRef.current?.contains(e.target as Node);
        const isClickInsideDropdown = dropdownRef.current?.contains(e.target as Node);
        
        if (!isClickInsideButton && !isClickInsideDropdown) {
          setIsExpanded(false);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded, direction]);

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^#[0-9A-F]{0,6}$/i.test(value)) {
      onChange(value);
    }
  };

  // Filter out vest colors from the rest of the presets to avoid duplicates in the expanded view
  const otherColors = PRESET_COLORS.filter(
    color => !VEST_COLORS.some(vc => vc.toLowerCase() === color.toLowerCase())
  );

  const dropdownPosition = direction === 'up' 
    ? "bottom-0 mb-0 origin-bottom" 
    : "top-0 mt-0 origin-top";

  return (
    <div className="relative overflow-visible" ref={buttonRef}>
      <div className="flex items-center gap-1.5 py-1 px-1 -mx-1 overflow-visible">
        {minimal ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className={`w-9 h-9 rounded-full border-2 border-white/20 transition-all flex items-center justify-center ${isExpanded ? 'scale-110 shadow-lg ring-2 ring-indigo-500' : 'hover:scale-105'}`}
            style={{ backgroundColor: selectedColor }}
          >
            {isExpanded ? (
              <ChevronUp 
                size={16} 
                className={selectedColor.toLowerCase() === '#ffffff' || selectedColor.toLowerCase() === '#facc15' ? 'text-black' : 'text-white'} 
              />
            ) : (
              <ChevronDown 
                size={16} 
                className={selectedColor.toLowerCase() === '#ffffff' || selectedColor.toLowerCase() === '#facc15' ? 'text-black' : 'text-white'} 
              />
            )}
          </button>
        ) : (
          <>
            {VEST_COLORS.map(color => (
              <button
                key={color}
                type="button"
                onClick={() => onChange(color)}
                className={`w-6 h-6 rounded-full border-2 transition-all shrink-0 ${
                  selectedColor.toLowerCase() === color.toLowerCase() 
                    ? 'border-zinc-900 dark:border-white scale-125 shadow-md z-10' 
                    : 'border-transparent hover:scale-110'
                }`}
                style={{ backgroundColor: color }}
                title="Västfärg"
              />
            ))}
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className={`w-6 h-6 rounded-full border-2 border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-all shrink-0 ${isExpanded ? 'bg-zinc-100 dark:bg-zinc-800' : 'bg-white dark:bg-zinc-950'}`}
            >
              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </>
        )}
      </div>

      {isExpanded && createPortal(
        <div 
          ref={dropdownRef}
          className={`fixed ${dropdownPosition} p-3 bg-zinc-900 rounded-xl border border-zinc-800 shadow-2xl space-y-4 animate-in fade-in slide-in-from-${direction === 'up' ? 'bottom' : 'top'}-2 duration-200 z-[9999] w-64 sm:w-72`}
          style={{ 
            top: direction === 'up' ? 'auto' : portalPosition.top,
            bottom: direction === 'up' ? (window.innerHeight - portalPosition.top) : 'auto',
            left: portalPosition.left 
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-6 gap-2 p-1">
            {otherColors.map(color => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  onChange(color);
                  setIsExpanded(false);
                }}
                className={`w-8 h-8 rounded-full border-2 transition-all ${
                  selectedColor.toLowerCase() === color.toLowerCase() 
                    ? 'border-indigo-500 scale-110 shadow-md z-10' 
                    : 'border-white/10 hover:border-white/30 hover:scale-110'
                }`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-zinc-800">
            <div className="relative flex-1 group">
              <input
                type="text"
                value={selectedColor}
                onChange={handleHexChange}
                placeholder="#000000"
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono text-sm uppercase"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
                <Pipette size={16} />
              </div>
            </div>

            <div className="relative group shrink-0">
              <input
                type="color"
                value={selectedColor.length === 7 ? selectedColor : '#6366f1'}
                onChange={(e) => onChange(e.target.value)}
                className="w-10 h-10 rounded-xl border border-zinc-800 p-0.5 cursor-pointer bg-zinc-950"
              />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-zinc-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-[260]">
                Välj fritt
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
