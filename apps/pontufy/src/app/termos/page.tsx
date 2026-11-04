import Link from 'next/link';
import { ScrollText } from 'lucide-react';

const TITLE = 'Termos de Uso: Pontufy';
const DESCRIPTION =
  'Termos e condições gerais de uso da plataforma Pontufy, operada pela Mestry\'s Tecnologia e Consultoria em TI LTDA, em conformidade com a LGPD e, quando aplicável, com o GDPR.';
const LAST_UPDATED = '12 de julho de 2026';
const CONTACT_EMAIL = 'ajuda@pontufy.com';
const DPO_EMAIL = 'privacidade@pontufy.com';

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
};

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="text-headline-sm font-bold text-md-on-surface">{title}</h2>
      <div className="mt-4 space-y-4 text-body-md text-md-on-surface-variant">{children}</div>
    </section>
  );
}

export default function TermosPage() {
  return (
    <main className="min-h-screen bg-md-surface-container-low py-20 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-md bg-md-tertiary/38 text-md-tertiary">
            <ScrollText className="size-6" aria-hidden="true" />
          </div>
          <span className="rounded-full border border-md-outline bg-md-surface-container px-3 py-1 text-label-sm text-md-on-surface-variant">
            Termos de Uso
          </span>
        </div>

        <h1 className="mt-6 text-display-sm font-black text-md-on-surface">
          Termos de <span className="text-md-tertiary">Uso</span>
        </h1>
        <p className="mt-4 text-body-sm text-md-on-surface-variant">Última atualização: {LAST_UPDATED}</p>

        <div className="mt-8 md-card-elevated p-5 text-body-sm text-md-on-surface-variant border border-md-outline">
          Este documento estabelece as condições gerais de uso da plataforma Pontufy, um
          serviço B2B SaaS de gamificação corporativa operado pela{' '}
          <strong className="text-md-on-surface">Mestry&apos;s Tecnologia e Consultoria em TI LTDA</strong>{' '}
          ("Pontufy", "nós", "nosso"). Ele respeita a Lei Geral de Proteção de Dados (LGPD, Lei
          nº 13.709/2018) e, quando aplicável a usuários na União Europeia, o Regulamento Geral
          de Proteção de Dados (GDPR, Regulamento (UE) 2016/679). Este material é informativo;
          recomendamos revisão jurídica antes de considerá-lo versão final, especialmente para
          contratos de prestação de serviço específicos com empresas contratantes (tenants).
        </div>

        <div className="mt-14 space-y-14">
          <Section id="aceitacao" title="1. Aceitação dos termos">
            <p>
              Ao acessar ou usar a plataforma Pontufy, você ("usuário", "você") concorda com
              estes Termos de Uso. Se você não concordar com qualquer parte destes termos,
              pedimos que não utilize o Serviço.
            </p>
            <p>
              O acesso à Pontufy é concedido por convite de uma empresa contratante (tenant) da
              qual você é colaborador, gestor de RH ou convidado. A relação comercial entre a
              Pontufy e a empresa contratante é regida por contrato específico, que prevalece
              sobre este documento em caso de conflito.
            </p>
          </Section>

          <Section id="quem-somos" title="2. Quem somos">
            <p>
              A Pontufy é operada pela Mestry&apos;s Tecnologia e Consultoria em TI LTDA, empresa
              brasileira sediada em São Paulo/SP, especializada em desenvolvimento de software
              sob medida.
            </p>
            <p>
              Para dúvidas gerais sobre estes termos, utilize o canal{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-md-tertiary hover:underline">
                {CONTACT_EMAIL}
              </a>
              . Para assuntos relacionados a dados pessoais, utilize{' '}
              <a href={`mailto:${DPO_EMAIL}`} className="text-md-tertiary hover:underline">
                {DPO_EMAIL}
              </a>
              .
            </p>
          </Section>

          <Section id="cadastro" title="3. Cadastro e contas de acesso">
            <p>
              O acesso à plataforma ocorre por convite da sua empresa contratante e está sujeito
              a expiração conforme prazo definido pelo administrador de RH. Você é responsável
              por manter suas credenciais em sigilo e por todas as atividades realizadas em sua
              conta.
            </p>
            <p>
              Existem três perfis de usuário: colaborador (employee), gestor de RH (admin_rh) e
              acesso restrito de convidado (guest), cada um com permissões específicas definidas
              pela sua empresa contratante.
            </p>
          </Section>

          <Section id="uso-da-plataforma" title="4. Uso da plataforma">
            <p>Ao utilizar a Pontufy, você concorda em não:</p>
            <ul className="ml-5 list-disc space-y-2">
              <li>Compartilhar suas credenciais de acesso com terceiros;</li>
              <li>Utilizá-la para fins ilícitos, fraudulentos ou que violem direitos de terceiros;</li>
              <li>
                Tentar acessar áreas, sistemas ou dados de outras empresas contratantes (tenants)
                sem autorização;
              </li>
              <li>
                Interferir no funcionamento da plataforma (ex.: ataques de negação de serviço,
                varreduras automatizadas não autorizadas, engenharia reversa);
              </li>
              <li>
                Enviar conteúdo malicioso, spam ou informações falsas por qualquer canal da
                plataforma.
              </li>
            </ul>
            <p>
              Reservamo-nos o direito de restringir ou suspender o acesso de usuários que violem
              estes termos.
            </p>
          </Section>

          <Section id="pontos-recompensas" title="5. Sistema de pontos e recompensas">
            <p>
              Os pontos acumulados na plataforma são virtuais, intransferíveis e não possuem
              valor monetário fora do ecossistema da empresa contratante. A conversão de pontos
              em recompensas na vitrine de benefícios está sujeita à política interna do RH de
              sua empresa e à disponibilidade de estoque dos parceiros de recompensa.
            </p>
          </Section>

          <Section id="cursos-ia" title="6. Cursos gerados por Inteligência Artificial">
            <p>
              A Pontufy utiliza modelos de inteligência artificial para gerar trilhas e conteúdo
              educacional a partir de materiais fornecidos pela empresa contratante. O conteúdo
              gerado é revisado antes da publicação, mas pode conter imprecisões; recomendamos a
              verificação por um responsável técnico da empresa contratante antes do uso em
              contextos críticos.
            </p>
          </Section>

          <Section id="propriedade-intelectual" title="7. Propriedade intelectual">
            <p>
              O conteúdo da plataforma (incluindo textos, marca, logotipo, layout, código-fonte
              da interface e materiais gráficos) é de titularidade da Mestry&apos;s Tecnologia ou
              licenciado a ela, protegido pela legislação de direitos autorais e propriedade
              industrial aplicável. É vedada a reprodução, distribuição ou uso comercial sem
              autorização prévia por escrito.
            </p>
            <p>
              Cursos e trilhas gerados pela IA a partir de materiais da empresa contratante
              permanecem de titularidade da empresa contratante, conforme definido em contrato
              específico, que prevalece sobre esta seção.
            </p>
          </Section>

          <Section id="protecao-de-dados" title="8. Proteção de dados pessoais (LGPD e GDPR)">
            <p>
              O tratamento de dados pessoais realizado por meio da plataforma segue nossa{' '}
              <Link href="/privacidade" className="text-md-tertiary hover:underline">
                Política de Privacidade
              </Link>
              , elaborada em conformidade com a LGPD. Caso você seja titular de dados localizado
              no Espaço Econômico Europeu, no Reino Unido ou em jurisdição equivalente, buscamos
              observar também os princípios e direitos previstos no GDPR.
            </p>
            <p>
              Solicitações relacionadas a esses direitos podem ser enviadas a{' '}
              <a href={`mailto:${DPO_EMAIL}`} className="text-md-tertiary hover:underline">
                {DPO_EMAIL}
              </a>
              . Nenhuma cláusula destes Termos limita os direitos que titulares de dados possuem
              de forma cogente sob a LGPD ou o GDPR.
            </p>
          </Section>

          <Section id="isencao-garantias" title="9. Isenção de garantias">
            <p>
              A plataforma e seu conteúdo são fornecidos "como estão" ("as is"), sem garantias
              de qualquer tipo, expressas ou implícitas, incluindo, mas não se limitando a,
              garantias de disponibilidade ininterrupta, ausência de erros ou adequação a uma
              finalidade específica. Envidamos esforços razoáveis para manter a plataforma
              atualizada, segura e disponível, mas não garantimos operação livre de falhas.
            </p>
          </Section>

          <Section id="limitacao-responsabilidade" title="10. Limitação de responsabilidade">
            <p>
              Na máxima extensão permitida pela legislação aplicável, a Mestry&apos;s Tecnologia
              não será responsável por danos indiretos, incidentais, lucros cessantes ou perda de
              dados decorrentes do uso ou da incapacidade de uso da plataforma, exceto nos casos
              de dolo, culpa grave, ou quando a limitação de responsabilidade for vedada por lei,
              incluindo obrigações irrenunciáveis previstas na LGPD, no GDPR e no Código de
              Defesa do Consumidor, quando aplicável.
            </p>
          </Section>

          <Section id="suspensao-rescisao" title="11. Suspensão e rescisão">
            <p>
              Podemos suspender ou encerrar, a qualquer momento e sem aviso prévio, o acesso de
              usuários que violem estes Termos de Uso ou a legislação aplicável, sem prejuízo de
              outras medidas cabíveis. O encerramento do contrato entre a Pontufy e a empresa
              contratante implica a suspensão do acesso de todos os usuários vinculados a ela.
            </p>
          </Section>

          <Section id="lei-aplicavel" title="12. Legislação aplicável e foro">
            <p>
              Estes Termos de Uso são regidos pelas leis da República Federativa do Brasil. Fica
              eleito o foro da Comarca de São Paulo/SP para dirimir eventuais controvérsias, com
              renúncia a qualquer outro, por mais privilegiado que seja, sem prejuízo dos
              direitos irrenunciáveis de titulares de dados sob o GDPR de apresentar reclamação
              perante a autoridade de proteção de dados de seu país de residência habitual, local
              de trabalho ou local da suposta infração.
            </p>
          </Section>

          <Section id="alteracoes" title="13. Alterações destes termos">
            <p>
              Podemos atualizar estes Termos de Uso periodicamente para refletir mudanças legais,
              operacionais ou de serviço. A versão vigente será sempre publicada nesta página,
              com a data da última atualização em destaque no topo. O uso continuado da
              plataforma após alterações implica concordância com os novos termos.
            </p>
          </Section>

          <Section id="contato" title="14. Contato">
            <p>
              Dúvidas sobre estes Termos de Uso podem ser enviadas para{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-md-tertiary hover:underline">
                {CONTACT_EMAIL}
              </a>
              . Para exercer direitos relacionados a dados pessoais, utilize{' '}
              <a href={`mailto:${DPO_EMAIL}`} className="text-md-tertiary hover:underline">
                {DPO_EMAIL}
              </a>
              . Veja também nossa{' '}
              <Link href="/privacidade" className="text-md-tertiary hover:underline">
                Política de Privacidade
              </Link>
              .
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
}
