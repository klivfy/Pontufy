// ═══════════════════════════════════════════════════════════════════════════
// Escape de HTML para templates (módulo PURO)
//
// Vivia dentro de `infra/email.ts`, que arrasta consigo configuração de
// ambiente e cliente de e-mail. Uma função de string não deve obrigar quem a
// importa a ter banco ou SMTP configurado — separado para poder ser testada e
// reutilizada em qualquer template.
// ═══════════════════════════════════════════════════════════════════════════

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}
