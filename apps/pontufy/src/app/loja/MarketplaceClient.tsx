'use client';

import { useState } from 'react';
import { Loader2, Gift } from 'lucide-react';

import CategoryFilter from '@/components/marketplace/CategoryFilter';
import ProductGrid from '@/components/marketplace/ProductGrid';
import CheckoutDrawer from '@/components/marketplace/CheckoutDrawer';
import { useStore } from '@/store/useStore';
import { useRewards } from '@/hooks/useApi';
import type { Product } from '@/components/marketplace/ProductGrid';

// ═══════════════════════════════════════════════════════════════════════════
// C5 — parte interativa da vitrine.
//
// A página (`page.tsx`) virou Server Component: lê sessão, tenant, saldo e o
// catálogo inicial no servidor. Este componente é dono do que de fato precisa
// de estado no cliente: filtro de categoria, drawer de resgate e saldo reativo.
//
// `initialRewards` alimenta o SWR como `fallbackData` — a primeira pintura já
// tem produto, sem spinner. `initialBalance` semeia o store de pontos, que é a
// fonte única do saldo no cliente.
// ═══════════════════════════════════════════════════════════════════════════

const categories = [
  { id: 'all', name: 'Todos' },
  { id: 'coupons', name: 'Cupons de Desconto' },
  { id: 'offers', name: 'Ofertas' },
  { id: 'tech', name: 'Tecnologia' },
  { id: 'health', name: 'Saúde' },
  { id: 'home', name: 'Utilidades' },
];

// Reusa o tipo do grid: a vitrine não deve inventar uma forma paralela do
// mesmo produto — divergência aqui vira erro de render silencioso.
type Reward = Product;

interface Props {
  initialRewards: Reward[];
  initialBalance: number;
}

export default function MarketplaceClient({ initialRewards, initialBalance }: Props) {
  // Sincroniza o saldo do servidor com o store uma única vez, na montagem.
  // Sem isso, o primeiro render mostraria saldo 0 e esconderia produtos que o
  // colaborador pode pagar.
  const [seeded] = useState(() => {
    useStore.getState().setPointsBalance(initialBalance);
    return true;
  });
  void seeded;

  const userPoints = useStore((s) => s.currentPointsBalance);
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState<Reward | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  const apiCategory = activeCategory === 'all' ? undefined : activeCategory;
  const { data: rewardsResponse, isLoading, mutate: refreshRewards } = useRewards(1, 50, apiCategory);

  // Categoria "Todos" usa o que veio do servidor na primeira pintura; as demais
  // continuam vindo da API (o filtro é do cliente e não vale pagar SSR por ele).
  const products: Reward[] =
    activeCategory === 'all' ? rewardsResponse?.data?.length ? rewardsResponse.data : initialRewards : rewardsResponse?.data || [];

  const handleRedeem = (product: Reward) => {
    const price = product.pricePoints ?? product.pointsRequired ?? 0;
    if (userPoints >= price) {
      setSelectedProduct(product);
      setIsCheckoutOpen(true);
    }
  };

  const handleRedeemSuccess = (newBalance: number) => {
    useStore.getState().setPointsBalance(newBalance);
    refreshRewards();
  };

  return (
    <>
      <CategoryFilter
        categories={categories}
        activeCategory={activeCategory}
        onSelect={setActiveCategory}
      />

      {isLoading && products.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-md-primary" size={36} />
        </div>
      ) : (
        <ProductGrid products={products} userPoints={userPoints} onRedeem={handleRedeem} />
      )}

      <CheckoutDrawer
        reward={selectedProduct}
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        userBalance={userPoints}
        onSuccess={handleRedeemSuccess}
      />
    </>
  );
}

export { categories };
export const MarketplaceHeader = Gift;
