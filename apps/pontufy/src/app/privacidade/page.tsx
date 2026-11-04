import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

const TITLE = 'Política de Privacidade, LGPD e GDPR: Pontufy';
const DESCRIPTION =
  'Como a Pontufy, operada pela Mestry\'s Tecnologia e Consultoria em TI LTDA, trata dados pessoais em conformidade com a Lei Geral de Proteção de Dados (LGPD) e, quando aplicável, com o GDPR.';
const LAST_UPDATED = '12 de julho de 2026';
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

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-md-surface-container-low py-20 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-md bg-md-tertiary/38 text-md-tertiary">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>
          <span className="rounded-full border border-md-outline bg-md-surface-container px-3 py-1 text-label-sm text-md-on-surface-variant">
            Privacidade, LGPD & GDPR
          </span>
        </div>

        <h1 className="mt-6 text-display-sm font-black text-md-on-surface">
          Política de <span className="text-md-tertiary">Privacidade</span>
        </h1>
        <p className="mt-4 text-body-sm text-md-on-surface-variant">Última atualização: {LAST_UPDATED}</p>

        <div className="mt-8 md-card-elevated p-5 text-body-sm text-md-on-surface-variant border border-md-outline">
          Este documento é mantido pela{' '}
          <strong className="text-md-on-surface">Mestry&apos;s Tecnologia e Consultoria em TI LTDA</strong>,
          operadora da plataforma Pontufy, e descreve como coletamos, usamos, armazenamos e
          protegemos dados pessoais em conformidade com a Lei nº 13.709/2018 (LGPD) e, para
          titulares localizados no Espaço Econômico Europeu, no Reino Unido ou em jurisdição
          equivalente, com o Regulamento (UE) 2016/679 (GDPR). Este material é informativo;
          recomendamos revisão jurídica antes de considerá-lo versão final.
        </div>

        <div className="mt-14 space-y-14">
          <Section id="introducao" title="1. Introdução e âmbito de aplicação">
            <p>
              A Pontufy ("nós") é uma plataforma B2B SaaS de gamificação corporativa operada pela
              Mestry&apos;s Tecnologia e Consultoria em TI LTDA, empresa brasileira sediada em São
              Paulo/SP. Esta política se aplica a colaboradores, gestores de RH e convidados das
              empresas contratantes (tenants) que utilizam a plataforma, bem como a visitantes do
              nosso site.
            </p>
            <p>
              Esta política é regida principalmente pela LGPD. Para titulares de dados
              localizados no Espaço Econômico Europeu, no Reino Unido ou em jurisdição
              equivalente, aplicamos também, no que couber, os princípios e direitos previstos no
              GDPR, conforme detalhado ao longo deste documento.
            </p>
          </Section>

          <Section id="controlador" title="2. Controlador, Operador e Encarregado (DPO)">
            <p>
              <strong className="text-md-on-surface">Controlador:</strong> a empresa contratante
              (tenant) da qual você é colaborador é, em regra, a controladora dos seus dados
              pessoais tratados na plataforma. <strong className="text-md-on-surface">Operadora:</strong>{' '}
              a Mestry&apos;s Tecnologia e Consultoria em TI LTDA, São Paulo/SP, Brasil, atua como
              operadora dos dados no processamento técnico da plataforma Pontufy. Para fins do
              GDPR, aplicam-se os papéis equivalentes de "controller" e "processor".
            </p>
            <p>
              <strong className="text-md-on-surface">Encarregado (DPO):</strong> em cumprimento ao art.
              41 da LGPD e, no que aplicável, ao art. 37 do GDPR, disponibilizamos o canal{' '}
              <a href={`mailto:${DPO_EMAIL}`} className="text-md-tertiary hover:underline">
                {DPO_EMAIL}
              </a>{' '}
              para tratar de qualquer assunto relacionado a dados pessoais.
            </p>
          </Section>

          <Section id="dados-coletados" title="3. Dados que coletamos">
            <p>Podemos coletar as seguintes categorias de dados:</p>
            <ul className="ml-5 list-disc space-y-2">
              <li>
                <strong className="text-md-on-surface">Dados de cadastro:</strong> nome e e-mail
                corporativo fornecidos pela sua empresa contratante no momento do convite.
              </li>
              <li>
                <strong className="text-md-on-surface">Dados de engajamento:</strong> aulas assistidas,
                tempo de permanência, trilhas concluídas e resultados de quizzes.
              </li>
              <li>
                <strong className="text-md-on-surface">Dados de gamificação:</strong> histórico de
                pontuação, conquistas e resgates realizados na vitrine de recompensas.
              </li>
              <li>
                <strong className="text-md-on-surface">Dados de navegação:</strong> endereço IP, tipo de
                dispositivo e páginas visitadas, coletados via cookies e ferramentas de
                analytics.
              </li>
            </ul>
          </Section>

          <Section id="bases-legais" title="4. Bases legais (art. 7º da LGPD e art. 6º do GDPR)">
            <p>Realizamos o tratamento de dados com base em:</p>
            <ul className="ml-5 list-disc space-y-2">
              <li>
                <strong className="text-md-on-surface">Execução de contrato</strong> firmado entre a
                Pontufy e a empresa contratante, do qual você é beneficiário;
              </li>
              <li>
                <strong className="text-md-on-surface">Legítimo interesse</strong> para análise de
                engajamento, segurança e melhoria dos nossos serviços, sempre respeitando os
                direitos e liberdades do titular;
              </li>
              <li>
                <strong className="text-md-on-surface">Consentimento</strong> do titular quando aplicável
                a funcionalidades opcionais;
              </li>
              <li>
                <strong className="text-md-on-surface">Cumprimento de obrigação legal ou regulatória</strong>{' '}
                quando aplicável.
              </li>
            </ul>
            <p className="text-sm italic">
              Estas bases correspondem, sob o GDPR, à execução de contrato (art. 6º(1)(b)),
              legítimo interesse (art. 6º(1)(f)), consentimento (art. 6º(1)(a)) e cumprimento de
              obrigação legal (art. 6º(1)(c)). Não tratamos categorias especiais de dados (art. 9º
              do GDPR / dados sensíveis da LGPD) na operação padrão da plataforma.
            </p>
          </Section>

          <Section id="finalidades" title="5. Finalidades do tratamento">
            <ul className="ml-5 list-disc space-y-2">
              <li>Viabilizar o acesso e autenticação na plataforma;</li>
              <li>Personalizar as recomendações de cursos utilizando nossa Inteligência Artificial;</li>
              <li>Processar o acúmulo e resgate de pontos com transparência;</li>
              <li>
                Fornecer relatórios anonimizados ou específicos para o setor de Recursos Humanos
                da sua empresa, conforme acordo B2B;
              </li>
              <li>Analisar o desempenho da plataforma e melhorar a experiência do usuário;</li>
              <li>Prevenir fraudes, abusos e garantir a segurança dos nossos sistemas.</li>
            </ul>
          </Section>

          <Section id="compartilhamento" title="6. Compartilhamento com terceiros">
            <p>
              Não vendemos dados pessoais. O compartilhamento ocorre estritamente com:
            </p>
            <ul className="ml-5 list-disc space-y-2">
              <li>
                Parceiros de recompensa (ex.: Amazon, Magalu, Shopee), apenas no momento em que
                você decide resgatar um prêmio, para fins de faturamento e entrega;
              </li>
              <li>
                Provedores de inteligência artificial utilizados na geração de trilhas de curso,
                sob contrato e obrigações de confidencialidade;
              </li>
              <li>
                Prestadores de serviço estritamente necessários à operação da plataforma (ex.:
                hospedagem, e-mail transacional, cache e filas de processamento), sempre sob
                contrato compatível com a LGPD.
              </li>
            </ul>
          </Section>

          <Section id="retencao" title="7. Retenção e eliminação">
            <p>
              Mantemos dados pessoais pelo tempo necessário ao cumprimento das finalidades
              declaradas, à duração do contrato com a empresa contratante ou de obrigações
              legais. Encerrado o contrato ou concluído o prazo aplicável, os dados são
              eliminados ou anonimizados de forma segura, salvo hipóteses previstas em lei.
            </p>
          </Section>

          <Section id="transferencia-internacional" title="8. Transferência internacional de dados">
            <p>
              Nossos prestadores de serviço (por exemplo, hospedagem, cache e infraestrutura de
              nuvem, e provedores de inteligência artificial) podem processar dados em servidores
              localizados fora do Brasil, inclusive fora do Espaço Econômico Europeu. Quando isso
              ocorrer, buscamos garantir salvaguardas adequadas de proteção, como cláusulas
              contratuais padrão, decisões de adequação ou mecanismos equivalentes reconhecidos
              pela LGPD (art. 33) e pelo GDPR (Capítulo V), de forma a manter o mesmo nível de
              proteção previsto neste documento.
            </p>
          </Section>

          <Section id="direitos" title="9. Direitos do titular (LGPD e GDPR)">
            <p>Você pode, a qualquer momento, solicitar:</p>
            <ul className="ml-5 list-disc space-y-2">
              <li>Confirmação da existência de tratamento;</li>
              <li>Acesso aos seus dados;</li>
              <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
              <li>
                Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou
                tratados em desconformidade com a LGPD ("direito ao esquecimento" sob o GDPR);
              </li>
              <li>Limitação e oposição ao tratamento (GDPR);</li>
              <li>Portabilidade dos dados;</li>
              <li>
                Informação sobre entidades públicas e privadas com as quais os dados foram
                compartilhados;
              </li>
              <li>
                Não se sujeitar a decisões automatizadas que produzam efeitos jurídicos ou o
                afetem significativamente, sem possibilidade de revisão humana;
              </li>
              <li>Revogação do consentimento.</li>
            </ul>
            <p>
              As solicitações devem ser encaminhadas ao Encarregado pelo canal indicado na seção
              2. Quando a solicitação envolver dados controlados pela empresa contratante,
              poderemos mediá-la junto ao administrador de RH responsável. Responderemos no prazo
              legal aplicável (arts. 18 e 19 da LGPD; arts. 12 a 22 do GDPR). Titulares sob o
              GDPR também têm o direito de apresentar reclamação diretamente à autoridade de
              proteção de dados de seu país de residência, local de trabalho ou local da suposta
              infração.
            </p>
          </Section>

          <Section id="seguranca" title="10. Medidas de segurança">
            <p>
              Adotamos medidas técnicas e organizacionais razoáveis para proteger dados pessoais
              contra acessos não autorizados, destruição, perda, alteração ou qualquer forma de
              tratamento inadequado ou ilícito. Entre elas:
            </p>
            <ul className="ml-5 list-disc space-y-2">
              <li>Criptografia em trânsito (HTTPS/TLS) e hash de senhas com salt aleatório;</li>
              <li>Isolamento lógico dos dados entre empresas contratantes (arquitetura multi-tenant);</li>
              <li>Controle de acesso baseado em privilégios mínimos e por perfil de usuário;</li>
              <li>Registro e monitoramento de eventos de segurança;</li>
              <li>Treinamento contínuo da equipe em boas práticas de proteção de dados.</li>
            </ul>
            <p className="text-sm italic">
              Nenhum sistema é 100% imune a incidentes. Reforçamos nossos controles continuamente
              e recomendamos que titulares também adotem boas práticas de segurança, como não
              compartilhar suas credenciais de acesso.
            </p>
          </Section>

          <Section id="cookies" title="11. Cookies">
            <p>
              Utilizamos cookies estritamente necessários para o funcionamento da plataforma
              (ex.: manutenção de sessão) e, mediante consentimento, cookies analíticos para
              entender como visitantes interagem com nossas páginas públicas. Você pode
              gerenciar cookies nas configurações do seu navegador.
            </p>
          </Section>

          <Section id="incidentes" title="12. Incidentes de segurança">
            <p>
              Em caso de incidente de segurança que possa acarretar risco ou dano relevante aos
              titulares, comunicaremos a Autoridade Nacional de Proteção de Dados (ANPD), a
              empresa contratante e os titulares afetados nos prazos e formas exigidos pela LGPD.
              Quando o GDPR for aplicável, comunicaremos a autoridade de controle competente em
              até 72 horas da ciência do incidente (art. 33 do GDPR) e, quando o risco aos
              titulares for elevado, também os titulares afetados diretamente (art. 34 do GDPR).
            </p>
          </Section>

          <Section id="alteracoes" title="13. Alterações desta política">
            <p>
              Esta política pode ser atualizada periodicamente. Publicaremos a versão vigente
              nesta página com a data da última atualização em destaque no topo.
            </p>
          </Section>

          <Section id="contato" title="14. Fale com o Encarregado">
            <p>
              Dúvidas, solicitações ou reclamações relacionadas a dados pessoais podem ser
              enviadas para{' '}
              <a href={`mailto:${DPO_EMAIL}`} className="text-md-tertiary hover:underline">
                {DPO_EMAIL}
              </a>
              . Caso não fique satisfeito com nossa resposta, você também pode apresentar
              reclamação à Autoridade Nacional de Proteção de Dados (ANPD) ou, se aplicável, à
              autoridade de proteção de dados de seu país de residência habitual, local de
              trabalho ou local da suposta infração no âmbito do GDPR. Veja também nossos{' '}
              <Link href="/termos" className="text-md-tertiary hover:underline">
                Termos de Uso
              </Link>
              .
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
}
