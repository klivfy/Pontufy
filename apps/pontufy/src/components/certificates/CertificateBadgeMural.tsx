'use client';

import { useMemo, useState, useEffect } from 'react';
import { Share2, Award, Sparkles, Star, Trophy } from 'lucide-react';

// TAREFA 14 — Mural de badges com raridade + botão compartilhar LinkedIn.

export interface CertificateWithMeta {
  id: string;
  courseId: string;
  courseName: string;
  issuedAt: string;
  verificationHash: string;
}

type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

const RARITY_CONFIG: Record<Rarity, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  common: { label: 'Comum', color: 'text-md-on-surface-variant', bg: 'bg-md-surface-container', border: 'border-md-outline', icon: <Star className="w-5 h-5 text-md-on-surface-variant" /> },
  rare: { label: 'Raro', color: 'text-md-primary', bg: 'bg-md-primary/10', border: 'border-md-primary/30', icon: <Star className="w-5 h-5 text-md-primary" fill="currentColor" /> },
  epic: { label: 'Épico', color: 'text-md-on-highlight', bg: 'bg-md-highlight/50', border: 'border-md-highlight/30', icon: <Sparkles className="w-5 h-5 text-md-on-highlight" /> },
  legendary: { label: 'Lendário', color: 'text-md-secondary', bg: 'bg-md-secondary/50', border: 'border-md-secondary/30', icon: <Trophy className="w-5 h-5 text-md-secondary" /> },
};

function getRarityFromHash(hash: string): Rarity {
  const sum = hash.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const mod = sum % 100;
  if (mod < 2) return 'legendary';
  if (mod < 8) return 'epic';
  if (mod < 23) return 'rare';
  return 'common';
}

function shareOnLinkedIn(cert: CertificateWithMeta, employeeName: string, tenantName: string) {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const verifyUrl = `${baseUrl}/verify/${cert.id}`;
  const text = `Acabei de concluir o curso "${cert.courseName}" na ${tenantName}! 🏆 Verifique meu certificado: ${verifyUrl} #Pontufy #AprendizadoContínuo`;
  const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(verifyUrl)}&title=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'width=600,height=400');
}

export default function CertificateBadgeMural({ certificates }: { certificates: CertificateWithMeta[] }) {
  const [employeeName, setEmployeeName] = useState('');
  const [tenantName, setTenantName] = useState('');

  useEffect(() => {
    fetch('/api/users/me', { cache: 'no-store' })
      .then((res) => res.ok && res.json())
      .then((data) => {
        if (data?.name) setEmployeeName(data.name);
        if (data?.tenantName) setTenantName(data.tenantName);
      })
      .catch(() => {});
  }, []);
  const enriched = useMemo(() =>
    certificates.map((c) => ({
      ...c,
      rarity: getRarityFromHash(c.verificationHash),
      issuedDate: new Date(c.issuedAt).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    })),
    [certificates]
  );

  if (enriched.length === 0) {
    return (
      <div className="bg-md-surface-container border border-md-outline-variant rounded-2xl p-8 text-center">
        <Award className="mx-auto text-md-on-surface-muted mb-4" size={48} />
        <p className="text-md-on-surface-variant">Nenhum certificado emitido ainda.</p>
        <p className="text-xs text-md-on-surface-variant mt-1">Complete cursos para ganhar badges de raridade única!</p>
      </div>
    );
  }

  const rarityOrder: Rarity[] = ['legendary', 'epic', 'rare', 'common'];
  const sorted = [...enriched].sort((a, b) => rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity));

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-md-on-surface tracking-tight flex items-center gap-2">
            <Award className="text-md-primary" size={24} />
            Meus Certificados
          </h2>
          <p className="text-md-on-surface-variant text-sm mt-0.5">
            {certificates.length} certificado{certificates.length !== 1 ? 's' : ''} — cada um com raridade única baseada no hash criptográfico
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((cert) => {
          const cfg = RARITY_CONFIG[cert.rarity];
          return (
            <article
              key={cert.id}
              className={`relative group overflow-hidden rounded-2xl p-5 border transition-all duration-300 ${cfg.bg} ${cfg.border} hover:border-opacity-70 hover:scale-[1.015]`}
            >
              {/* Rarity badge */}
              <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm border text-[10px] font-bold uppercase tracking-wider">
                {cfg.icon}
                <span className={cfg.color}>{cfg.label}</span>
              </div>

              {/* Icon + Course */}
              <div className="flex items-start gap-4">
                <div className={`shrink-0 w-14 h-14 rounded-xl flex items-center justify-center ${cfg.bg} ${cfg.border}`}>
                  <Award className={cfg.color} size={28} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-md-on-surface truncate">{cert.courseName}</p>
                  <p className="text-xs text-md-on-surface-variant mt-0.5">Emitido em {cert.issuedDate}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex items-center justify-between pt-4 border-t border-md-outline-variant">
                <button
                  onClick={() => shareOnLinkedIn(cert, employeeName, tenantName)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-md-primary/50 border border-md-primary/30 text-md-primary text-xs font-medium hover:bg-md-primary/60 transition"
                  aria-label="Compartilhar no LinkedIn"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                  <span>Compartilhar</span>
                </button>

                <a
                  href={`/verify/${cert.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-md-surface-container-low border border-md-outline-variant text-md-on-surface-variant text-xs font-medium hover:bg-md-surface-container transition"
                >
                  Verificar
                </a>
              </div>
            </article>
          );
        })}
      </div>

      {/* Legenda de raridade */}
      <div className="grid grid-cols-4 gap-3 text-center">
        {rarityOrder.map((r) => {
          const cfg = RARITY_CONFIG[r];
          const count = enriched.filter((c) => c.rarity === r).length;
          return (
            <div key={r} className={`rounded-xl p-3 ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                {cfg.icon}
                <span className={`font-bold ${cfg.color} text-sm`}>{cfg.label}</span>
              </div>
              <p className="text-2xl font-black text-md-on-surface">{count}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}