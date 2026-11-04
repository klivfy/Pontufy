'use client';

interface Category {
  id: string;
  name: string;
}

interface CategoryFilterProps {
  categories: Category[];
  activeCategory: string;
  onSelect: (id: string) => void;
}

export default function CategoryFilter({ categories, activeCategory, onSelect }: CategoryFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto hide-scrollbar px-8 md:px-16 mb-8 py-1">
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className={`flex-none px-5 py-2 rounded-full font-semibold text-sm transition-all border ${
            activeCategory === cat.id
              ? 'bg-md-primary text-md-on-primary border-md-primary'
              : 'bg-md-surface-container text-md-on-surface-variant border-md-outline hover:border-md-primary/40 hover:text-md-on-surface'
          }`}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
