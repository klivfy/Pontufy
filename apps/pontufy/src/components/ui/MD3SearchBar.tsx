'use client';
import { useCallback, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';

// MD3 Search Bar expansível — integrada ao useStore (searchQuery global,
// consumida pelo catálogo de cursos). Expandida via Framer Motion com easing
// M3 (emphasized). Enter submete para /cursos?q=; digitação faz debounce de 300ms.
export function MD3SearchBar({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const [isOpen, setIsOpen] = useState(false);
  const [localValue, setLocalValue] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (value: string) => {
      setLocalValue(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setSearchQuery(value), 300);
    },
    [setSearchQuery],
  );

  const handleSubmit = useCallback(() => {
    const q = localValue.trim();
    setSearchQuery(q);
    router.push(q ? `/cursos?q=${encodeURIComponent(q)}` : '/cursos');
  }, [localValue, router, setSearchQuery]);

  const close = useCallback(() => {
    setIsOpen(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return (
    <div className={`relative flex items-center ${compact ? 'w-full' : ''}`}>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.input
            key="md3-search-input"
            ref={inputRef}
            type="text"
            autoFocus
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') close();
            }}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: compact ? '100%' : 264, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            placeholder="Buscar cursos..."
            aria-label="Buscar cursos"
            className={`${
              compact ? 'w-full' : 'absolute right-10'
            } pl-4 pr-9 py-1.5 rounded-full text-sm bg-md-surface-container border border-md-outline-variant text-md-on-surface placeholder:text-md-on-surface-muted focus:outline-none focus:border-md-primary transition-colors`}
          />
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        aria-label={isOpen ? 'Fechar busca' : 'Abrir busca'}
        className={`p-2 text-md-on-surface-variant hover:text-md-on-surface transition-colors rounded-full ${
          compact && isOpen ? 'absolute right-1 z-10' : ''
        }`}
      >
        {isOpen ? <X size={18} /> : <Search size={18} />}
      </button>
    </div>
  );
}