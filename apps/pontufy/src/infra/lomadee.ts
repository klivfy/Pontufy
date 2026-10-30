// File: src/lib/lomadee.ts
// Lomadee (Social Soul) Affiliate Integration Service - Legacy API v2/v3
// Server-only: Never expose API tokens to the client.
//
// API legada (App Token + Source ID):
//   Base:  https://api.lomadee.com/{versao}/{appToken}/{recurso}?sourceId={sourceId}&format=json
//   Recursos: coupon/_all, coupon/_categories, offer/_search, offer/_bestsellers,
//             deeplink/_create, category/_all, store/_all

export interface LomadeeConfig {
  appToken: string;
  sourceId: string;
  apiBaseUrl: string;
}

export interface LomadeeDeeplinkResponse {
  deeplink: string;
  shortUrl?: string;
  trackingId?: string;
}

export interface LomadeeCoupon {
  id: string;
  title: string;
  description?: string;
  code?: string;
  discountType: 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING';
  discountValue: number;
  minOrderValue?: number;
  validFrom: string;
  validUntil: string;
  affiliateLink: string;
  partnerName: string;
  partnerLogo?: string;
  category?: string;
  termsAndConditions?: string;
}

export interface LomadeeOffer {
  id: string;
  title: string;
  description?: string;
  originalPrice?: number;
  promotionalPrice: number;
  discountPercentage?: number;
  imageUrl?: string;
  affiliateLink: string;
  partnerName: string;
  partnerLogo?: string;
  category?: string;
  validUntil?: string;
}

export interface LomadeeCatalogResponse {
  coupons: LomadeeCoupon[];
  offers: LomadeeOffer[];
  diagnostics?: LomadeeDiagnostics;
}

export interface LomadeeDiagnostics {
  couponsStatus?: number;
  couponsBodySample?: string;
  offersStatus?: number;
  offersBodySample?: string;
  errors: string[];
}

function getConfig(): LomadeeConfig {
  const appToken = process.env.LOMADEE_APP_TOKEN;
  const sourceId = process.env.LOMADEE_SOURCE_ID;
  const apiBaseUrl = process.env.LOMADEE_API_BASE_URL || 'https://api.lomadee.com/v2';

  if (!appToken || !sourceId) {
    throw new Error('Lomadee configuration missing: LOMADEE_APP_TOKEN and LOMADEE_SOURCE_ID are required');
  }

  return { appToken, sourceId, apiBaseUrl };
}

/**
 * Monta a URL de um recurso da API legada v2/v3.
 * Formato: {base}/{appToken}/{recurso}?sourceId={sourceId}&format=json&...
 */
function buildResourceUrl(
  resource: string,
  params: Record<string, string | number | boolean | undefined> = {},
): string {
  const { appToken, sourceId, apiBaseUrl } = getConfig();
  const base = apiBaseUrl.replace(/\/+$/, '');
  const query = new URLSearchParams({ sourceId, format: 'json' });

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(key, String(value));
    }
  }

  return `${base}/${encodeURIComponent(appToken)}/${resource}?${query.toString()}`;
}

/**
 * GET de um recurso com tratamento explícito de erro HTTP.
 * NÃO engole falhas: loga status + corpo e relança com mensagem descritiva.
 */
async function requestJson<T>(url: string): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    cache: 'no-store',
  });

  const text = await response.text();

  if (!response.ok) {
    const sample = text.slice(0, 600);
    console.error(`Lomadee request failed [${response.status} ${response.statusText}] URL=${url}`);
    console.error(`Lomadee response body: ${sample || '(vazio)'}`);
    throw new Error(`Lomadee request failed (${response.status} ${response.statusText}): ${sample}`);
  }

  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    console.error(`Lomadee response is not JSON [${response.status}]: ${text.slice(0, 600)}`);
    throw new Error('Lomadee response is not valid JSON');
  }

  return { status: response.status, body };
}

/**
 * Extrai um array de itens de uma resposta com formato defensivo.
 * Suporta: { data: { coupons: [...] } }, { coupons: [...] }, { data: [...] }, [...]
 */
function extractArray(body: unknown, keys: string[]): unknown[] {
  if (Array.isArray(body)) return body;

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;

    for (const key of keys) {
      const direct = record[key];
      if (Array.isArray(direct)) return direct;
    }

    const data = record['data'];
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const dataRecord = data as Record<string, unknown>;
      for (const key of keys) {
        const nested = dataRecord[key];
        if (Array.isArray(nested)) return nested;
      }
    }

    if (Array.isArray(data)) return data;
  }

  return [];
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function asNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseDiscountType(label: string | undefined): LomadeeCoupon['discountType'] {
  if (!label) return 'PERCENTAGE';
  const normalized = label.toLowerCase();
  if (normalized.includes('frete') || normalized.includes('shipping')) return 'FREE_SHIPPING';
  if (normalized.includes('$') || normalized.includes('r$') || normalized.includes('fix')) return 'FIXED';
  return 'PERCENTAGE';
}

function extractDiscountValue(discountLabel: string | undefined, type: LomadeeCoupon['discountType']): number {
  if (!discountLabel) return 0;
  const numbers = discountLabel.replace(',', '.').match(/\d+(\.\d+)?/g);
  const value = numbers ? parseFloat(numbers[0]) : 0;
  if (Number.isNaN(value)) return 0;
  if (type === 'PERCENTAGE') return value;
  if (type === 'FIXED') return value;
  return 0;
}

function findLinkUrl(raw: Record<string, unknown> | undefined, type: string): string | undefined {
  const links = raw?.['links'];
  if (Array.isArray(links)) {
    for (const linkEntry of links) {
      const inner = linkEntry && typeof linkEntry === 'object' ? (linkEntry as Record<string, unknown>)['link'] : undefined;
      const link = inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : linkEntry;
      if (link && typeof link === 'object') {
        const linkRecord = link as Record<string, unknown>;
        if (!type || linkRecord['type'] === type) {
          const url = asString(linkRecord['url']) || asString(linkRecord['redirectlink']) || asString(linkRecord['redirectLink']);
          if (url) return url;
        }
      }
    }
  }
  return undefined;
}

function extractThumbnailUrl(partner: Record<string, unknown> | undefined): string | undefined {
  if (!partner) return undefined;
  const thumbnail = partner['thumbnail'];
  if (thumbnail && typeof thumbnail === 'object' && !Array.isArray(thumbnail)) {
    const url = asString((thumbnail as Record<string, unknown>)['url']);
    if (url) return url;
  }
  return undefined;
}

function mapCoupon(raw: unknown): LomadeeCoupon | null {
  const entry = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const id = asString(entry['id']) || asString(entry['couponId']) || '';
  const title = asString(entry['name']) || asString(entry['title']) || asString(entry['couponname']) || '';
  if (!id || !title) return null;

  const description = asString(entry['description']) || asString(entry['longDescription']);
  const code = asString(entry['code']) || asString(entry['coupon']);
  const discountLabel = asString(entry['discount']) || asString(entry['discountLabel']) || description;
  const discountType = parseDiscountType(discountLabel);
  const discountValue = extractDiscountValue(discountLabel, discountType);

  const seller = entry['seller'] && typeof entry['seller'] === 'object'
    ? (entry['seller'] as Record<string, unknown>)
    : undefined;
  const advertiser = entry['advertiser'] && typeof entry['advertiser'] === 'object'
    ? (entry['advertiser'] as Record<string, unknown>)
    : undefined;
  const partner = seller ?? advertiser;
  const partnerName = asString(partner?.['name']) || asString(partner?.['sellername']) || asString(entry['partnerName']) || 'Parceiro';
  const partnerLogo = asString(partner?.['logo']) || extractThumbnailUrl(partner) || asString(entry['partnerLogo']);

  const linkUrl = asString(entry['url']) || findLinkUrl(entry, 'offer') || asString(entry['affiliateLink']) || '';

  const categories = entry['categories'];
  const category = Array.isArray(categories) && categories.length > 0 ? String(categories[0]) : asString(entry['category']);

  const validFrom = asString(entry['startDate']) || asString(entry['beginDate']) || new Date(0).toISOString();
  const validUntil = asString(entry['endDate']) || asString(entry['expiryDate']) || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id,
    title,
    description,
    code,
    discountType,
    discountValue,
    minOrderValue: asNumber(entry['minimumOrderValue']) ?? asNumber(entry['minOrderValue']),
    validFrom,
    validUntil,
    affiliateLink: linkUrl,
    partnerName,
    partnerLogo,
    category,
    termsAndConditions: asString(entry['termsAndConditions']) || description,
  };
}

function mapOffer(raw: unknown): LomadeeOffer | null {
  const outer = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  // A v2/v3 pode retornar itens como { offer: { ... } }
  const entry = outer['offer'] && typeof outer['offer'] === 'object'
    ? (outer['offer'] as Record<string, unknown>)
    : outer;

  const id = asString(entry['id']) || asString(entry['offerId']) || asString(entry['offername']) || '';
  const title = asString(entry['name']) || asString(entry['offername']) || asString(entry['offerName']) || asString(entry['title']) || '';
  if (!title) return null;

  const description = asString(entry['description']) || asString(entry['longDescription']);

  const priceObj = entry['price'] && typeof entry['price'] === 'object'
    ? (entry['price'] as Record<string, unknown>)
    : undefined;
  const promotionalPrice = asNumber(priceObj?.['value']) ?? asNumber(entry['promotionalPrice']) ?? asNumber(entry['price']);
  const originalPrice = asNumber(priceObj?.['oldValue']) ?? asNumber(entry['originalPrice']) ?? asNumber(entry['priceOld']);

  let discountPercentage = asNumber(entry['discountPercentage']) ?? asNumber(entry['discount']);
  if (!discountPercentage && originalPrice && promotionalPrice && originalPrice > 0) {
    discountPercentage = Math.round(((originalPrice - promotionalPrice) / originalPrice) * 100);
  }

  const thumbnailObj = entry['thumbnail'] && typeof entry['thumbnail'] === 'object'
    ? (entry['thumbnail'] as Record<string, unknown>)
    : undefined;
  const imageUrl = asString(thumbnailObj?.['url']) || asString(entry['imageURL']) || asString(entry['imageUrl']) || asString(entry['image']);

  const seller = entry['seller'] && typeof entry['seller'] === 'object'
    ? (entry['seller'] as Record<string, unknown>)
    : undefined;
  const partnerName = asString(seller?.['sellername']) || asString(seller?.['name']) || asString(entry['partnerName']) || 'Parceiro';
  const sellerThumb = seller?.['thumbnail'] && typeof seller['thumbnail'] === 'object'
    ? (seller['thumbnail'] as Record<string, unknown>)
    : undefined;
  const partnerLogo = asString(sellerThumb?.['url']) || asString(seller?.['logo']) || asString(entry['partnerLogo']);

  const linkUrl = asString(entry['url']) || findLinkUrl(entry, 'offer') || asString(entry['affiliateLink']) || '';

  const categories = entry['categories'];
  const category = Array.isArray(categories) && categories.length > 0 ? String(categories[0]) : asString(entry['category']);

  const validUntil = asString(entry['endDate']) || asString(entry['expiryDate']);

  return {
    id,
    title,
    description,
    originalPrice,
    promotionalPrice: promotionalPrice ?? 0,
    discountPercentage,
    imageUrl,
    affiliateLink: linkUrl,
    partnerName,
    partnerLogo,
    category,
    validUntil,
  };
}

export class LomadeeService {
  private static instance: LomadeeService;

  static getInstance(): LomadeeService {
    if (!LomadeeService.instance) {
      LomadeeService.instance = new LomadeeService();
    }
    return LomadeeService.instance;
  }

  /**
   * Cria um deeplink de afiliado com subId de tracking.
   * Recurso: deeplink/_create?url=...&subId=...
   */
  async createTrackedLink(targetUrl: string, trackingSubId: string): Promise<string> {
    try {
      const url = buildResourceUrl('deeplink/_create', { url: targetUrl, subId: trackingSubId });
      const { body } = await requestJson<Record<string, unknown>>(url);

      const link = extractDeeplink(body);
      if (link) return link;

      // Fallback defensivo: qualquer URL presente na resposta
      const raw = JSON.stringify(body);
      const urlMatch = raw.match(/https?:\/\/[^\s"']+/);
      if (urlMatch) return urlMatch[0].replace(/[\]}"',;]$/g, '');

      throw new Error('Lomadee deeplink response did not contain a link');
    } catch (error) {
      console.error('Lomadee createTrackedLink error:', error);
      // Fail-open: retorna a URL original se a Lomadee estiver indisponível
      return targetUrl;
    }
  }

  /**
   * Busca cupons e ofertas ativos do catálogo Lomadee (API legada v2/v3).
   * Cupons:   coupon/_all
   * Ofertas:  offer/_search (vazio = todas) ou offer/_bestsellers como fallback
   */
  async fetchCatalog(categoryId?: number): Promise<LomadeeCatalogResponse> {
    const diagnostics: LomadeeDiagnostics = { errors: [] };
    const baseParams: Record<string, string | number | undefined> = {
      results: '50',
      page: '1',
      ...(categoryId ? { categoryId: categoryId.toString() } : {}),
    };

    const couponsUrl = buildResourceUrl('coupon/_all', baseParams);
    const offersUrl = buildResourceUrl('offer/_search', { keyword: '' });

    const [couponsResult, offersResult] = await Promise.allSettled([
      requestJson<unknown>(couponsUrl),
      requestJson<unknown>(offersUrl),
    ]);

    let coupons: LomadeeCoupon[] = [];
    let offers: LomadeeOffer[] = [];

    if (couponsResult.status === 'fulfilled') {
      diagnostics.couponsStatus = couponsResult.value.status;
      diagnostics.couponsBodySample = JSON.stringify(couponsResult.value.body).slice(0, 800);
      coupons = extractArray(couponsResult.value.body, ['coupons', 'couponList', 'list', 'results'])
        .map(mapCoupon)
        .filter((c): c is LomadeeCoupon => c !== null);
    } else {
      diagnostics.errors.push(`coupon/_all: ${(couponsResult.reason as Error).message}`);
    }

    if (offersResult.status === 'fulfilled') {
      diagnostics.offersStatus = offersResult.value.status;
      diagnostics.offersBodySample = JSON.stringify(offersResult.value.body).slice(0, 800);
      offers = extractArray(offersResult.value.body, ['offers', 'offerList', 'list', 'results'])
        .map(mapOffer)
        .filter((o): o is LomadeeOffer => o !== null);
    } else {
      // Fallback: tenta ofertas em destaque
      try {
        const bestsellers = await requestJson<unknown>(buildResourceUrl('offer/_bestsellers', baseParams));
        diagnostics.offersStatus = bestsellers.status;
        diagnostics.offersBodySample = JSON.stringify(bestsellers.body).slice(0, 800);
        offers = extractArray(bestsellers.body, ['offers', 'offerList', 'list', 'results'])
          .map(mapOffer)
          .filter((o): o is LomadeeOffer => o !== null);
        if (offers.length === 0) {
          diagnostics.errors.push('offer/_search falhou e offer/_bestsellers retornou vazio');
        }
      } catch (error) {
        diagnostics.errors.push(`offer/_bestsellers: ${(error as Error).message}`);
      }
    }

    return { coupons, offers, diagnostics };
  }

  /**
   * Busca apenas cupons.
   */
  async fetchCoupons(categoryId?: number): Promise<LomadeeCoupon[]> {
    const { coupons } = await this.fetchCatalog(categoryId);
    return coupons;
  }

  /**
   * Busca apenas ofertas.
   */
  async fetchOffers(categoryId?: number): Promise<LomadeeOffer[]> {
    const { offers } = await this.fetchCatalog(categoryId);
    return offers;
  }

  /**
   * Valida se o serviço está configurado.
   */
  isConfigured(): boolean {
    try {
      getConfig();
      return true;
    } catch {
      return false;
    }
  }
}

function extractDeeplink(body: Record<string, unknown>): string | undefined {
  if (!body || typeof body !== 'object') return undefined;

  // Formato legado: { data: { redirectlink | redirectLink | deeplink | url } }
  const data = body['data'];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const dataRecord = data as Record<string, unknown>;
    const direct = asString(dataRecord['redirectlink']) || asString(dataRecord['redirectLink'])
      || asString(dataRecord['deeplink']) || asString(dataRecord['url']);
    if (direct) return direct;

    const links = dataRecord['links'];
    if (Array.isArray(links) && links.length > 0) {
      const first = links[0];
      const inner = first && typeof first === 'object' ? (first as Record<string, unknown>)['link'] : undefined;
      const link = inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : first;
      if (link && typeof link === 'object') {
        const url = asString((link as Record<string, unknown>)['url'])
          || asString((link as Record<string, unknown>)['redirectlink'])
          || asString((link as Record<string, unknown>)['redirectLink']);
        if (url) return url;
      }
    }
  }

  // Formato legado: { lomadeelinks: [ { lomadeelink: { redirectlink } } ] }
  const lomadeeLinks = body['lomadeelinks'];
  if (Array.isArray(lomadeeLinks) && lomadeeLinks.length > 0) {
    const first = lomadeeLinks[0] as Record<string, unknown>;
    const lomadeeLink = first['lomadeelink'] as Record<string, unknown> | undefined;
    if (lomadeeLink) {
      return asString(lomadeeLink['redirectlink']) || asString(lomadeeLink['redirectLink']) || asString(lomadeeLink['url']);
    }
  }

  return undefined;
}

// Export singleton instance
export const lomadeeService = LomadeeService.getInstance();

// Convenience function for creating tracked links
export async function createLomadeeTrackedLink(targetUrl: string, trackingSubId: string): Promise<string> {
  return lomadeeService.createTrackedLink(targetUrl, trackingSubId);
}

// Convenience function for fetching catalog
export async function fetchLomadeeCatalog(categoryId?: number): Promise<LomadeeCatalogResponse> {
  return lomadeeService.fetchCatalog(categoryId);
}
