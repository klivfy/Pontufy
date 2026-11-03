import { test, expect } from '@playwright/test';
import { zodSchema } from 'ai';
import { courseGenerationSchema, generatedCourseSchema } from '../../src/schemas/course-schema';

// ═══════════════════════════════════════════════════════════════════════════
// Regressão: o schema enviado ao modelo precisa ser ESTRITO
//
// Tradução de um bug real, encontrado na primeira geração com provedor de
// structured output estrito (Groq):
//
//   invalid JSON schema for response_format:
//   /properties/lessons/items/required: `required` is required to be supplied
//   and to be an array including every key in properties.
//   The following properties must be listed in `required`: pointsAwarded
//
// Causa: `.default()` e `.optional()` tiram a propriedade de `required`.
// O request é rejeitado com 400 ANTES de o modelo rodar — e o motor, sem
// saber disso, cai no template local. O usuário recebe um curso genérico
// acreditando ter sido gerado por IA.
//
// `zodSchema()` é o mesmo conversor que o SDK usa em `generateObject`, então
// o teste inspeciona exatamente o artefato enviado ao provedor.
// ═══════════════════════════════════════════════════════════════════════════

interface JsonSchemaNode {
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
}

function collectObjectNodes(node: JsonSchemaNode | undefined, acc: JsonSchemaNode[] = []): JsonSchemaNode[] {
  if (!node) return acc;
  if (node.properties) acc.push(node);
  for (const child of Object.values(node.properties ?? {})) collectObjectNodes(child, acc);
  if (node.items) collectObjectNodes(node.items, acc);
  return acc;
}

function jsonSchemaOf(schema: Parameters<typeof zodSchema>[0]): JsonSchemaNode {
  const wrapped = zodSchema(schema as never) as unknown as { jsonSchema: JsonSchemaNode };
  return wrapped.jsonSchema;
}

test.describe('schema de geração de curso', () => {
  test('todo objeto do schema do modelo lista TODAS as propriedades em `required`', () => {
    const nodes = collectObjectNodes(jsonSchemaOf(courseGenerationSchema));
    expect(nodes.length, 'o schema tem objetos aninhados (lessons e quiz)').toBeGreaterThan(2);

    for (const node of nodes) {
      const properties = Object.keys(node.properties ?? {});
      const required = node.required ?? [];
      const missing = properties.filter((p) => !required.includes(p));
      expect(
        missing,
        `Propriedade fora de \`required\` derruba provedores estritos: ${missing.join(', ')}`,
      ).toEqual([]);
    }
  });

  test('o schema canônico mantém defaults — por isso os dois coexistem', () => {
    // O canônico normaliza a resposta (aplica padrões); o estrito é o contrato
    // da chamada ao modelo. Este teste falha se alguém "unificar" os dois sem
    // perceber que isso reintroduz o bug acima.
    expect(generatedCourseSchema.shape.category.isOptional()).toBe(true);
    expect(generatedCourseSchema.shape.estimatedDurationMinutes.isOptional()).toBe(true);
    expect(generatedCourseSchema.shape.lessons.element.shape.pointsAwarded.isOptional()).toBe(true);

    expect(courseGenerationSchema.shape.category.isOptional()).toBe(false);
    expect(courseGenerationSchema.shape.lessons.element.shape.pointsAwarded.isOptional()).toBe(false);
    expect(courseGenerationSchema.shape.quiz.element.shape.explanation.isOptional()).toBe(false);
  });
});
