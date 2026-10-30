export type Partner = 'amazon' | 'magalu' | 'shopee' | 'mercadolivre' | 'custom';

export function getPartnerDisplayName(partner: Partner): string {
  switch (partner) {
    case 'amazon': return 'Amazon';
    case 'magalu': return 'Magalu';
    case 'shopee': return 'Shopee';
    case 'mercadolivre': return 'Mercado Livre';
    default: return 'Parceiro';
  }
}

export function getPartnerIcon(partner: Partner): string {
  switch (partner) {
    case 'amazon': return '📦';
    case 'magalu': return '🛍️';
    case 'shopee': return '🛒';
    case 'mercadolivre': return '🟡';
    default: return '🔗';
  }
}
