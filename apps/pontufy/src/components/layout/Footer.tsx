import Link from 'next/link';
import Wordmark from '@/components/brand/Wordmark';

export default function Footer() {
  return (
    <footer className="bg-md-surface-dim border-t border-md-outline text-md-on-surface-variant py-8 px-6 pb-20 sm:pb-8 mt-auto">
      <div className="max-w-[1200px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <Wordmark className="text-base font-black text-md-on-surface" />
          <span className="text-xs text-md-on-surface-variant leading-relaxed">
            © 2026 Mestry&apos;s Tecnologia e Consultoria em TI LTDA. Todos os direitos reservados.
            <br />
            CNPJ: 68.027.889/0001-34
            <br />
            Rua Pais Leme, 215, Conj 1713, Pinheiros, São Paulo/SP
          </span>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-6 text-xs">
          <Link href="/termos" className="hover:text-md-on-surface transition-colors">Termos de Serviço</Link>
          <Link href="/privacidade" className="hover:text-md-on-surface transition-colors">Política de Privacidade</Link>
          <Link href="mailto:ajuda@pontufy.com" className="hover:text-md-on-surface transition-colors">ajuda@pontufy.com</Link>
        </div>
      </div>
    </footer>
  );
}
