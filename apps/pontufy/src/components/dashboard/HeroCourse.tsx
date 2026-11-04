import { Play, Info, Coins, Star } from 'lucide-react';
import Link from 'next/link';

/**
 * Destaque do dashboard como *media card* M3.
 *
 * Antes era um bloco full-bleed: imagem com dois scrims e texto branco solto em
 * cima, encostado nas bordas da viewport. Funcionava no tema escuro porque a
 * página inteira era preta — o herói se dissolvia nela. No tema claro esse
 * bloco não tem para onde dissolver: ou o scrim vira uma faixa preta, ou o
 * texto some.
 *
 * A solução é separar as camadas: a página é clara, o herói é um card escuro
 * (28dp de raio, elevação 2) com scrim construído sobre `md-inverse-surface`.
 * Assim o texto branco tem fundo garantido em qualquer imagem, e o card
 * pertence visualmente à página em vez de brigar com ela.
 */
export default function HeroCourse({ course }: { course: any }) {
  if (!course) return null;

  return (
    <section className="px-4 sm:px-6 md:px-10 pt-4">
      <div className="relative overflow-hidden rounded-[28px] bg-md-inverse-surface md-elevation-2">
        {/* Imagem */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${course.thumbnail})` }}
          aria-hidden="true"
        />

        {/* Scrim M3: dois gradientes sobre a mesma tinta, para o texto branco
            ter contraste previsível mesmo com thumbnail clara. */}
        <div className="absolute inset-0 bg-gradient-to-r from-md-inverse-surface via-md-inverse-surface/85 to-md-inverse-surface/20" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-t from-md-inverse-surface/85 via-transparent to-md-inverse-surface/30" aria-hidden="true" />

        {/* Conteúdo */}
        <div className="relative z-10 flex min-h-[58vh] sm:min-h-[64vh] max-w-2xl flex-col justify-end px-6 sm:px-10 md:px-14 py-9 sm:py-12">
          <div className="inline-flex w-fit items-center gap-1.5 px-2.5 py-1 bg-md-tertiary-container text-md-on-tertiary-container text-[11px] font-black rounded-sm mb-5 uppercase tracking-widest">
            <Star size={10} fill="currentColor" strokeWidth={0} /> Em Destaque
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight mb-4 leading-[1.05] line-clamp-4">
            {course.title}
          </h1>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm font-semibold mb-5">
            <span className="text-md-tertiary-container font-bold">{course.duration}</span>
            <span className="text-white/40">•</span>
            <span className="text-white/80">{course.modules} módulos</span>
            <span className="text-white/40">•</span>
            <span className="flex items-center gap-1 text-md-tertiary-container font-bold">
              <Coins size={13} fill="currentColor" /> +{course.pointsReward} pontos
            </span>
          </div>

          <p className="text-sm sm:text-base text-white/75 mb-8 max-w-lg leading-relaxed line-clamp-3">
            {course.description}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/player/${course.id}`} className="md-btn md-btn-filled">
              <Play size={18} fill="currentColor" strokeWidth={0} /> Assistir Agora
            </Link>
            <Link
              href={`/player/${course.id}`}
              className="md-btn md-btn-outlined border-white/30 text-white backdrop-blur-sm hover:bg-white/10"
            >
              <Info size={17} /> Detalhes
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
