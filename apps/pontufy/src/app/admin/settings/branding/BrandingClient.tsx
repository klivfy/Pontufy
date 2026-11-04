'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Palette, Image as ImageIcon, ArrowLeft, Check } from 'lucide-react';
import { sanitizeHexColor, DEFAULT_PRIMARY_COLOR, DEFAULT_ACCENT_COLOR } from '@/lib/branding';

interface Branding {
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
}

const PRESETS = ['#495453', '#A7E3C1', '#CAD9CA', '#E0D2C5', '#F5C8BF', '#343434', '#6D5F52', '#848484'];

export default function BrandingClient() {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY_COLOR);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_COLOR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [colorError, setColorError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/branding', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setBranding(data);
          setLogoUrl(data.logoUrl ?? '');
          setFaviconUrl(data.faviconUrl ?? '');
          setPrimaryColor(data.primaryColor ?? DEFAULT_PRIMARY_COLOR);
          setAccentColor(data.accentColor ?? DEFAULT_ACCENT_COLOR);
        } else {
          setError(data.error || 'Erro ao carregar a marca.');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Erro ao conectar ao servidor.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const validateColors = (): boolean => {
    const primary = sanitizeHexColor(primaryColor);
    const accent = sanitizeHexColor(accentColor);
    if (!primary || !accent) {
      setColorError('Cores inválidas. Use formato #RGB ou #RRGGBB.');
      return false;
    }
    setColorError('');
    return true;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved(false);

    if (!validateColors()) return;

    setSaving(true);
    try {
      const res = await fetch('/api/admin/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logoUrl: logoUrl.trim() || null,
          faviconUrl: faviconUrl.trim() || null,
          primaryColor: primaryColor.trim(),
          accentColor: accentColor.trim(),
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setBranding(data.branding);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError(data.error || 'Erro ao salvar a marca.');
      }
    } catch {
      setError('Erro ao conectar ao servidor.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-md-primary" size={26} />
      </div>
    );
  }

  const primaryHex = sanitizeHexColor(primaryColor) ?? DEFAULT_PRIMARY_COLOR;
  const accentHex = sanitizeHexColor(accentColor) ?? DEFAULT_ACCENT_COLOR;

  return (
    <div className="space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div>
            <h1 className="text-headline-md font-extrabold text-md-on-surface">Identidade Visual</h1>
            <p className="text-body-md text-md-on-surface-variant mt-1">
              Personalize a marca exibida para {branding?.name ?? 'sua empresa'}
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div className="bg-md-error/10 border border-md-error/30 text-md-error text-body-sm p-3 rounded-xl text-center font-medium">
          {error}
        </div>
      )}
      {colorError && (
        <div className="bg-md-error/10 border border-md-error/30 text-md-error text-body-sm p-3 rounded-xl text-center font-medium">
          {colorError}
        </div>
      )}
      {saved && (
        <div className="flex items-center justify-center gap-2 bg-md-tertiary-container/20 border border-md-tertiary-container/30 text-md-on-tertiary-container text-body-sm p-3 rounded-xl font-medium">
          <Check size={16} /> Identidade visual salva com sucesso!
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <section className="md-card-outlined md-elevation-1 p-6">
          <h2 className="text-label-lg font-bold text-md-on-surface uppercase tracking-wider mb-5 flex items-center gap-2">
            <ImageIcon size={18} className="text-md-primary" /> Logos
          </h2>

          <div className="space-y-5">
            <div>
              <label className="text-label-lg text-md-on-surface-variant mb-2 block">
                URL do logo
              </label>
              <input
                type="text"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://suaempresa.com/logo.png"
                className="w-full px-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
              />
            </div>

            <div>
              <label className="text-label-lg text-md-on-surface-variant mb-2 block">
                URL do favicon
              </label>
              <input
                type="text"
                value={faviconUrl}
                onChange={(e) => setFaviconUrl(e.target.value)}
                placeholder="https://suaempresa.com/favicon.ico"
                className="w-full px-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
              />
            </div>

            {logoUrl && (
              <div className="flex items-center gap-3 p-4 bg-md-surface-container-high border border-md-outline rounded-xl">
                <img
                  src={logoUrl}
                  alt="Prévia do logo"
                  className="h-12 w-12 object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.opacity = '0.3';
                  }}
                />
                <p className="text-body-sm text-md-on-surface-variant">Prévia do logo</p>
              </div>
            )}
          </div>
        </section>

        <section className="md-card-outlined md-elevation-1 p-6">
          <h2 className="text-label-lg font-bold text-md-on-surface uppercase tracking-wider mb-5 flex items-center gap-2">
            <Palette size={18} className="text-md-primary" /> Cores da marca
          </h2>

          <div className="grid sm:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="text-label-lg text-md-on-surface-variant mb-2 block">
                Cor primária
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={primaryHex}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-11 w-14 rounded-xl border border-md-outline bg-transparent cursor-pointer"
                />
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="flex-1 px-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md uppercase transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="text-label-lg text-md-on-surface-variant mb-2 block">
                Cor de destaque
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={accentHex}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-11 w-14 rounded-xl border border-md-outline bg-transparent cursor-pointer"
                />
                <input
                  type="text"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="flex-1 px-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md uppercase transition-colors"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 mb-6">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setPrimaryColor(preset)}
                className="h-9 w-9 rounded-full border border-md-outline transition-transform hover:scale-110"
                style={{ backgroundColor: preset }}
                aria-label={`Usar cor ${preset}`}
              />
            ))}
          </div>

          <div className="p-5 bg-md-surface-container-high border border-md-outline rounded-xl">
            <p className="text-body-sm text-md-on-surface-variant mb-4">Prévia do gradiente da marca:</p>
            <div className="flex items-center gap-4 flex-wrap">
              <button
                type="button"
                className="md-btn md-btn-filled text-body-md"
                style={{ background: `linear-gradient(135deg, ${primaryHex} 0%, #A7E3C1 100%)` }}
              >
                CTA principal
              </button>
              <span
                className="text-headline-sm font-black"
                style={{ backgroundImage: `linear-gradient(135deg, ${primaryHex} 0%, ${accentHex} 100%)`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
              >
                Pontufy
              </span>
            </div>
          </div>
        </section>

        <button
          type="submit"
          disabled={saving}
          className="md-btn md-btn-filled w-full"
        >
          {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
          Salvar identidade visual
        </button>
      </form>
    </div>
  );
}