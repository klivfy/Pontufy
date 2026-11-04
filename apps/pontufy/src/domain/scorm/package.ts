import { escapeHtml } from '@/lib/html';
import { createZip, type ZipEntry } from '@/lib/zip';
import { deriveKitFromMarkdown } from '@/domain/learning/lesson-kit';
import { readLessonKit, type LessonKit } from '@/schemas/lesson-kit';

// ═══════════════════════════════════════════════════════════════════════════
// Export SCORM 1.2
//
// Por que 1.2 e não 2004: é o que a maioria dos LMS corporativos que atendem
// RH no Brasil aceita sem configuração. 2004 é melhor tecnicamente e pior de
// instalar no cliente.
//
// O pacote é autossuficiente: manifest + uma página por aula + CSS. Sem
// JavaScript de framework, sem CDN, sem chamada de rede. Um SCO que depende da
// rede não abre em LMS que roda em intranet fechada.
//
// Conteúdo: usa o kit da aula quando existe (`Lesson.blocks`) e deriva do
// markdown quando não existe — o mesmo fallback do player. Nenhuma aula sai
// vazia do export.
// ═══════════════════════════════════════════════════════════════════════════

export interface ScormCourseInput {
  id: string;
  title: string;
  description?: string | null;
}

export interface ScormLessonInput {
  title: string;
  /** Markdown da aula — usado para derivar o kit quando `blocks` é nulo. */
  content: string;
  /** Kit serializado (`Lesson.blocks`). Pode ser nulo em curso antigo. */
  blocks: unknown;
}

export interface BuiltScormPackage {
  buffer: Buffer;
  fileName: string;
  lessonCount: number;
}

/** Identificador seguro para o manifest (SCORM não aceita qualquer caractere). */
export function scormIdentifier(courseId: string): string {
  const safe = courseId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60);
  return `pontufy-${safe || 'curso'}`;
}

/** Nome de arquivo estável por aula — ASCII, sem acento, sem colisão por título. */
export function lessonFileName(index: number): string {
  return `scormcontent/lesson-${String(index + 1).padStart(2, '0')}.html`;
}

function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'curso'
  );
}

export function buildManifest(course: ScormCourseInput, lessons: ScormLessonInput[]): string {
  const orgId = scormIdentifier(course.id);

  const items = lessons
    .map(
      (lesson, index) => `      <item identifier="ITEM-${index + 1}" identifierref="RES-${index + 1}">
        <title>${escapeHtml(lesson.title)}</title>
      </item>`,
    )
    .join('\n');

  const resources = lessons
    .map(
      (_lesson, index) => `    <resource identifier="RES-${index + 1}" type="webcontent" adlcp:scormtype="sco" href="${lessonFileName(index)}">
      <file href="${lessonFileName(index)}"/>
      <file href="scormcontent/styles.css"/>
    </resource>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${orgId}" version="1.2"
          xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                              http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="${orgId}-org">
    <organization identifier="${orgId}-org">
      <title>${escapeHtml(course.title)}</title>
${items}
    </organization>
  </organizations>
  <resources>
${resources}
    <resource identifier="RES-STYLES" type="webcontent" href="scormcontent/styles.css">
      <file href="scormcontent/styles.css"/>
    </resource>
  </resources>
</manifest>
`;
}

const STYLES = `:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;padding:32px 20px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
     background:#f7f4ef;color:#2b2f2e;line-height:1.6}
main{max-width:720px;margin:0 auto}
.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5c5c5c;margin:0 0 8px}
h1{font-size:28px;line-height:1.25;margin:0 0 20px;color:#495453}
h2{font-size:18px;margin:28px 0 10px;color:#343434}
.card{background:#fdfcfa;border:1px solid #e2ded7;border-radius:16px;padding:20px;margin:16px 0}
ul{margin:0;padding-left:20px}
li{margin:6px 0}
.q{background:#f1eee8;border-left:4px solid #a7e3c1;border-radius:8px;padding:14px 16px;margin:12px 0}
.q p{margin:0 0 6px}
details{margin-top:8px}
summary{cursor:pointer;font-weight:600;color:#495453}
button{appearance:none;border:0;border-radius:999px;background:#495453;color:#fff;
       font:inherit;font-weight:600;padding:12px 26px;cursor:pointer;margin-top:28px}
button:disabled{opacity:.55;cursor:default}
.done{color:#495453;font-weight:600;margin-top:16px}
nav{display:flex;justify-content:space-between;gap:12px;margin-top:32px;font-size:14px}
nav a{color:#495453}
`;

/**
 * Glue SCORM 1.2. Sem `APIWrapper` de biblioteca: o LMS expõe `window.parent.API`
 * ou `window.opener.API`; se não achar, a aula continua legível — só não
 * reporta conclusão.
 */
const SCORM_GLUE = `<script>
(function () {
  function findAPI(win) {
    var tries = 0;
    while (win && !win.API && win.parent && win.parent !== win && tries < 12) {
      win = win.parent;
      tries += 1;
    }
    return win && win.API ? win.API : null;
  }

  var api = findAPI(window);

  window.markCompleted = function () {
    var note = document.getElementById('status');
    try {
      if (api && api.LMSInitialize) {
        api.LMSInitialize('');
        api.LMSSetValue('cmi.core.lesson_status', 'completed');
        api.LMSCommit('');
      }
      if (note) {
        note.textContent = api
          ? 'Aula concluída. Você pode seguir para a próxima.'
          : 'Aula concluída (este ambiente não registra progresso).';
      }
      var button = document.getElementById('complete');
      if (button) { button.disabled = true; }
    } catch (error) {
      if (note) { note.textContent = 'Registramos a leitura desta aula.'; }
    }
  };

  window.addEventListener('beforeunload', function () {
    if (api && api.LMSFinish) { try { api.LMSFinish(''); } catch (error) {} }
  });
})();
</script>`;

export function renderLessonHtml(params: {
  courseTitle: string;
  lessonTitle: string;
  index: number;
  total: number;
  kit: LessonKit;
}): string {
  const { courseTitle, lessonTitle, index, total, kit } = params;

  const slides = kit.slides
    .map(
      (slide) => `      <div class="card">
        <h2>${escapeHtml(slide.title)}</h2>
        <ul>${slide.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>
      </div>`,
    )
    .join('\n');

  const glossary = kit.plain.glossary?.length
    ? `      <h2>Glossário</h2>
      <div class="card"><ul>${kit.plain.glossary
        .map((entry) => `<li><strong>${escapeHtml(entry.term)}</strong> — ${escapeHtml(entry.definition)}</li>`)
        .join('')}</ul></div>`
    : '';

  const checkpoint = kit.checkpoint.length
    ? `      <h2>Para fixar</h2>
${kit.checkpoint
  .map(
    (question) => `      <div class="q">
        <p><strong>${escapeHtml(question.question)}</strong></p>
        <ul>${question.options.map((option) => `<li>${escapeHtml(option)}</li>`).join('')}</ul>
        <details><summary>Ver resposta</summary><p>${escapeHtml(question.options[question.correctIndex] ?? '')}</p>${
          question.explanation ? `<p>${escapeHtml(question.explanation)}</p>` : ''
        }</details>
      </div>`,
  )
  .join('\n')}`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(lessonTitle)}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <p class="eyebrow">${escapeHtml(courseTitle)} · Aula ${index + 1} de ${total}</p>
    <h1>${escapeHtml(lessonTitle)}</h1>

    <div class="card">
      <p>${escapeHtml(kit.plain.summary)}</p>
      <ul>${kit.plain.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>
    </div>

    <h2>No slide</h2>
${slides}

${glossary}
${checkpoint}

    <button id="complete" type="button" onclick="window.markCompleted()">Concluir aula</button>
    <p id="status" class="done"></p>

    <nav>
      <span>${index + 1} / ${total}</span>
      <span>${escapeHtml(courseTitle)}</span>
    </nav>
  </main>
${SCORM_GLUE}
</body>
</html>
`;
}

/** Kit da aula: o gravado, ou derivado do markdown — mesmo fallback do player. */
export function kitForLesson(lesson: ScormLessonInput): LessonKit {
  return readLessonKit(lesson.blocks) ?? deriveKitFromMarkdown(lesson.content ?? '', lesson.title);
}

export function buildScormPackage(
  course: ScormCourseInput,
  lessons: ScormLessonInput[],
  options: { date?: Date } = {},
): BuiltScormPackage {
  if (lessons.length === 0) {
    throw new Error('Curso sem aulas não gera pacote SCORM.');
  }

  const entries: ZipEntry[] = [
    { name: 'imsmanifest.xml', content: buildManifest(course, lessons) },
    { name: 'scormcontent/styles.css', content: STYLES },
  ];

  lessons.forEach((lesson, index) => {
    entries.push({
      name: lessonFileName(index),
      content: renderLessonHtml({
        courseTitle: course.title,
        lessonTitle: lesson.title,
        index,
        total: lessons.length,
        kit: kitForLesson(lesson),
      }),
    });
  });

  return {
    buffer: createZip(entries, options),
    fileName: `${slugify(course.title)}-scorm.zip`,
    lessonCount: lessons.length,
  };
}
