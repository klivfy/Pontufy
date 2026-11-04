'use client';
import { useState, useCallback } from 'react';
import { ChevronDown, Filter, ArrowUpDown, X } from 'lucide-react';

interface RewardFiltersProps {
  categories: string[];
  selectedCategory: string | null;
  sortBy: 'price_asc' | 'price_desc' | 'name_asc';
  onCategoryChange: (category: string | null) => void;
  onSortChange: (sort: 'price_asc' | 'price_desc' | 'name_asc') => void;
}

export function RewardFilters({
  categories,
  selectedCategory,
  sortBy,
  onCategoryChange,
  onSortChange,
}: RewardFiltersProps) {
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);

  const sortOptions = [
    { value: 'price_asc' as const, label: 'Menor preço' },
    { value: 'price_desc' as const, label: 'Maior preço' },
    { value: 'name_asc' as const, label: 'A-Z' },
  ];

  const handleCategorySelect = useCallback((category: string | null) => {
    onCategoryChange(category);
    setIsCategoryOpen(false);
  }, [onCategoryChange]);

  const handleSortSelect = useCallback((sort: 'price_asc' | 'price_desc' | 'name_asc') => {
    onSortChange(sort);
    setIsSortOpen(false);
  }, [onSortChange]);

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 p-4 bg-md-surface border border-md-outline rounded-xl">
      <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
        <button
          type="button"
          onClick={() => setIsCategoryOpen(!isCategoryOpen)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            selectedCategory
              ? 'bg-md-primary text-md-on-primary border border-md-primary'
              : 'bg-md-surface-container-low text-md-on-surface border border-md-outline-variant hover:bg-md-surface-container'
          }`}
        >
          <Filter size={16} />
          <span>{selectedCategory ? selectedCategory : 'Categorias'}</span>
          <ChevronDown size={14} className={isCategoryOpen ? 'rotate-180' : ''} />
        </button>

        {isCategoryOpen && (
          <div className="absolute z-10 mt-2 bg-md-surface border border-md-outline rounded-lg shadow-xl py-1 min-w-[180px]">
            <button
              type="button"
              onClick={() => handleCategorySelect(null)}
              className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                !selectedCategory ? 'bg-md-primary/15 text-md-primary-container' : 'text-md-on-surface hover:bg-md-surface-container-low'
              }`}
            >
              Todas
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => handleCategorySelect(cat)}
                className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                  selectedCategory === cat ? 'bg-md-primary/15 text-md-primary-container' : 'text-md-on-surface hover:bg-md-surface-container-low'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative w-full sm:w-auto">
        <button
          type="button"
          onClick={() => setIsSortOpen(!isSortOpen)}
          className="flex items-center gap-2 w-full px-4 py-2 rounded-lg text-sm font-medium bg-md-surface-container-low text-md-on-surface border border-md-outline-variant hover:bg-md-surface-container transition-all"
        >
          <ArrowUpDown size={16} />
          <span>{sortOptions.find((s) => s.value === sortBy)?.label || 'Ordenar'}</span>
          <ChevronDown size={14} className={isSortOpen ? 'rotate-180' : ''} />
        </button>

        {isSortOpen && (
          <div className="absolute right-0 z-10 mt-2 bg-md-surface-container border border-md-outline rounded-lg shadow-xl py-1 min-w-[180px]">
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSortSelect(opt.value)}
                className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                  sortBy === opt.value ? 'bg-md-primary/15 text-md-primary-container' : 'text-md-on-surface hover:bg-md-surface-container-low'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedCategory && (
        <button
          type="button"
          onClick={() => onCategoryChange(null)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-md-on-surface-variant hover:text-md-error hover:bg-md-error/25 transition-colors"
        >
          <X size={14} />
          Limpar filtros
        </button>
      )}
    </div>
  );
}