import { Coins, CheckCircle2, Lock, TicketPercent, ExternalLink } from 'lucide-react';

interface ProductCardProps {
  product: {
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
  };
  userPoints: number;
  onRedeem: (product: any) => void;
}

export default function ProductCard({ product, userPoints, onRedeem }: ProductCardProps) {
  const price = product.pricePoints ?? product.pointsRequired ?? 0;
  const partner = product.partnerStore ?? product.partner ?? 'Parceiro';
  const canRedeem = userPoints >= price;
  const progress = Math.min((userPoints / price) * 100, 100);
  const pointsMissing = price - userPoints;
  const isLomadee = product.partner === 'LOMADEE' || product.externalId?.startsWith('coupon:') || product.externalId?.startsWith('offer:');
  const category = product.category;

  return (
    <div className="bg-md-surface border border-md-outline rounded-xl overflow-hidden flex flex-col hover:border-md-primary/40 transition-all duration-200 group">
      {/* Partner Logo / Product Image - Grid Style */}
      <div className="relative h-44 bg-md-surface-container-lowest flex items-center justify-center p-6">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={`Logo ${partner}`}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-md-on-surface-variant">
            <Coins size={32} />
            <span className="text-xs font-semibold">{partner}</span>
          </div>
        )}

        {/* Coupon Badge - Top Left */}
        <div className="absolute top-3 left-3 bg-md-primary text-md-on-primary px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
          <TicketPercent size={12} />
          {isLomadee ? 'Cupom' : 'Benefício'}
        </div>

        {/* Partner Name Badge - Top Right */}
        <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase tracking-wider">
          {partner}
        </div>
      </div>

      {/* Product Details */}
      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-semibold text-md-on-surface text-sm leading-snug mb-3 flex-1 line-clamp-2">
          {product.title}
        </h3>

        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-1.5 text-md-tertiary font-black text-base">
            <Coins size={16} />
            {price.toLocaleString('pt-BR')} pts
          </div>
          
          {product.originalUrl && (
            <a
              href={product.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-md-on-surface-variant hover:text-md-primary hover:bg-md-surface-container-high rounded transition-colors"
              title="Ver oferta original"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>

        {canRedeem ? (
          <button
            onClick={() => onRedeem(product)}
            className="w-full bg-md-primary hover:bg-md-primary-container text-md-on-primary font-bold py-2.5 rounded-full transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <CheckCircle2 size={16} /> Resgatar
          </button>
        ) : (
          <div className="w-full flex flex-col gap-2">
            <button
              disabled
              className="w-full bg-md-surface-container text-md-on-surface-muted font-bold py-2.5 rounded-lg cursor-not-allowed flex items-center justify-center gap-2 text-sm border border-md-outline"
            >
              <Lock size={14} /> Resgatar
            </button>
            <div className="flex flex-col gap-1">
              <div className="w-full h-1 bg-md-outline rounded-full overflow-hidden">
                <div
                  className="h-full bg-md-tertiary rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-[10px] text-md-on-surface-muted font-semibold text-center">
                Faltam {pointsMissing.toLocaleString('pt-BR')} pts
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
