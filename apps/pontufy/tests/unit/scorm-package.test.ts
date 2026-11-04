import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildManifest,
  buildScormPackage,
  kitForLesson,
  lessonFileName,
  renderLessonHtml,
  scormIdentifier,
} from '../../src/domain/scorm/package';
import { listZipEntries } from '../../src/lib/zip';

// ═══════════════════════════════════════════════════════════════════════════
// Pacote SCORM 1.2
//
// O que faz o pacote ser aceito por um LMS é o manifest: schema errado, item sem
// `identifierref` ou recurso sem `adlcp:scormtype="sco"` e o curso não importa —
// sem mensagem de erro útil do outro lado.
//
// O que faz o pacote ser útil é a aula não sair vazia: curso gerado antes do
// motor multi-formato tem `blocks` nulo, e o export precisa derivar o kit do
// markdown como o player faz.
// ═══════════════════════════════════════════════════════════════════════════

const course = { id: 'course-lgpd-001', title: 'LGPD <para> todos & todas', description: 'Base legal' };

const lessons = [
  {
    title: 'O que é dado pessoal',
    content: '## O que é dado pessoal\n\nNome, e-mail e CPF identificam alguém.\n\n- Nome\n- E-mail\n\nEvite coletar sem finalidade.',
    blocks: null,
  },
  {
    title: 'Bases legais',
    content: '## Bases legais\n\nConsentimento é uma das dez bases.\n\n- Consentimento\n- Legítimo interesse\n\nSempre registre a base.',
    blocks: null,
  },
];

test('manifest declara SCORM 1.2 e um item por aula', () => {
  const manifest = buildManifest(course, lessons);

  assert.match(manifest, /<schemaversion>1\.2<\/schemaversion>/);
  assert.match(manifest, /xmlns:adlcp="http:\/\/www\.adlnet\.org\/xsd\/adlcp_rootv1p2"/);
  assert.equal((manifest.match(/<item /g) ?? []).length, lessons.length);
  assert.equal((manifest.match(/adlcp:scormtype="sco"/g) ?? []).length, lessons.length);
});

test('item aponta para recurso existente e recurso aponta para arquivo existente', () => {
  const manifest = buildManifest(course, lessons);

  const itemRefs = [...manifest.matchAll(/identifierref="([^"]+)"/g)].map((m) => m[1]);
  const resources = [...manifest.matchAll(/<resource identifier="([^"]+)"/g)].map((m) => m[1]);

  for (const ref of itemRefs) {
    assert.ok(resources.includes(ref), `item referencia ${ref}, que não existe`);
  }
});

test('título com HTML é escapado no manifest e na aula', () => {
  const manifest = buildManifest(course, lessons);
  assert.ok(!manifest.includes('<para>'), 'título não foi escapado no manifest');
  assert.match(manifest, /&lt;para&gt;/);

  const html = renderLessonHtml({
    courseTitle: course.title,
    lessonTitle: '<script>alert(1)</script>',
    index: 0,
    total: 1,
    kit: kitForLesson(lessons[0]),
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'título não foi escapado na aula');
});

test('identificador do curso não carrega caractere inválido', () => {
  assert.equal(scormIdentifier('course-lgpd-001'), 'pontufy-course-lgpd-001');
  assert.match(scormIdentifier('id com espaço/e barra'), /^pontufy-[a-zA-Z0-9_-]+$/);
  assert.equal(scormIdentifier(''), 'pontufy-curso');
});

test('aula antiga sem kit deriva o conteúdo do markdown', () => {
  const kit = kitForLesson(lessons[0]);
  assert.ok(kit.slides.length >= 1, 'kit derivado precisa ter slide');
  assert.ok(kit.plain.summary.length >= 40);
});

test('pacote contém manifest, css e uma aula por lição', () => {
  const pkg = buildScormPackage(course, lessons);
  const names = listZipEntries(pkg.buffer);

  assert.ok(names.includes('imsmanifest.xml'));
  assert.ok(names.includes('scormcontent/styles.css'));
  assert.equal(pkg.lessonCount, 2);
  assert.ok(names.includes(lessonFileName(0)));
  assert.ok(names.includes(lessonFileName(1)));
  assert.equal(names.filter((name) => name.endsWith('.html')).length, 2);
});

test('nome do arquivo é seguro para download', () => {
  const pkg = buildScormPackage(course, lessons);
  assert.match(pkg.fileName, /^[a-z0-9-]+-scorm\.zip$/);
});

test('aula exportada carrega o glue do SCORM e não depende de rede', () => {
  const html = renderLessonHtml({
    courseTitle: course.title,
    lessonTitle: lessons[0].title,
    index: 0,
    total: 2,
    kit: kitForLesson(lessons[0]),
  });

  assert.ok(html.includes('cmi.core.lesson_status'), 'sem chamada SCORM o LMS não registra conclusão');
  assert.ok(html.includes('findAPI'), 'sem busca do objeto API o SCO não conversa com o LMS');

  // SCO que carrega mídia remota não abre em LMS de intranet fechada.
  assert.ok(!/src="https?:/i.test(html), 'SCO não pode carregar recurso remoto em src');
  assert.ok(!/href="https?:/i.test(html), 'SCO não pode linkar recurso remoto em href');
  assert.ok(html.includes('href="styles.css"'), 'CSS precisa ser relativo ao próprio pacote');
});

test('curso sem aulas não gera pacote', () => {
  assert.throws(() => buildScormPackage(course, []), /sem aulas/i);
});

test('export é determinístico — mesmo curso, mesmos bytes', () => {
  const date = new Date(Date.UTC(2026, 0, 1));
  const a = buildScormPackage(course, lessons, { date });
  const b = buildScormPackage(course, lessons, { date });

  assert.deepEqual(a.buffer, b.buffer);
});
