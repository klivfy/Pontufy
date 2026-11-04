import ProductCard from './ProductCard';

export interface Product {
  id: string;
  title: string;
  imageUrl?: string;
  partner?: string;
  partnerStore?: string;
  pointsRequired?: number;
  pricePoints?: number;
  category?: string;
  originalUrl?: string;
  externalId?: string;
}

interface ProductGridProps {
  products: Product[];
  userPoints: number;
  onRedeem: (product: Product) => void;
}

export default function ProductGrid({ products, userPoints, onRedeem }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="px-8 md:px-16 py-12 text-center text-md-on-surface-variant">
        Nenhum item encontrado nesta categoria.
      </div>
    );
  }

  return (
    <div className="px-8 md:px-16 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
      {products.map((product) => (
        <ProductCard 
          key={product.id} 
          product={product} 
          userPoints={userPoints}
          onRedeem={onRedeem}
        />
      ))}
    </div>
  );
}
