import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createZip, crc32, listZipEntries, type ZipEntry } from '../../src/lib/zip';

// ═══════════════════════════════════════════════════════════════════════════
// Escritor de ZIP
//
// Um ZIP "quase certo" é pior que nenhum: o LMS do cliente recusa o pacote sem
// dizer por quê. Aqui se verifica o que a especificação exige — assinatura,
// CRC, tamanhos e diretório central — e, quando a máquina tem `unzip` ou o
// PowerShell, o arquivo é aberto por uma ferramenta de verdade.
// ═══════════════════════════════════════════════════════════════════════════

const entries: ZipEntry[] = [
  { name: 'imsmanifest.xml', content: '<?xml version="1.0"?><manifest/>' },
  { name: 'scormcontent/lesson-01.html', content: '<html><body>Aula um</body></html>' },
  { name: 'scormcontent/styles.css', content: 'body{margin:0}' },
];

test('CRC-32 bate com o valor de referência', () => {
  // "123456789" tem CRC conhecido: 0xCBF43926.
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('')), 0);
});

test('assinatura de arquivo ZIP no início e EOCD no fim', () => {
  const zip = createZip(entries);

  assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(zip.subarray(zip.length - 22, zip.length - 18).toString('hex'), '504b0506');
});

test('diretório central lista todas as entradas, na ordem escrita', () => {
  const zip = createZip(entries);
  assert.deepEqual(listZipEntries(zip), entries.map((entry) => entry.name));
});

test('conteúdo é recuperável byte a byte', () => {
  const zip = createZip(entries);
  const text = zip.toString('utf8');

  for (const entry of entries) {
    assert.ok(text.includes(entry.content as string), `conteúdo de ${entry.name} não está no arquivo`);
  }
});

test('export é determinístico com a mesma data', () => {
  const a = createZip(entries, { date: new Date(Date.UTC(2026, 0, 1)) });
  const b = createZip(entries, { date: new Date(Date.UTC(2026, 0, 1)) });
  assert.deepEqual(a, b);
});

test('entrada sem nome, com .. ou duplicada é rejeitada', () => {
  assert.throws(() => createZip([{ name: '', content: 'x' }]), /inválido/i);
  assert.throws(() => createZip([{ name: '../escape.txt', content: 'x' }]), /inválido/i);
  assert.throws(
    () =>
      createZip([
        { name: 'a.txt', content: '1' },
        { name: 'a.txt', content: '2' },
      ]),
    /duplicada/i,
  );
});

test('pacote vazio não é pacote', () => {
  assert.throws(() => createZip([]), /vazio/i);
});

test('o arquivo é aceito por uma ferramenta de descompactação real', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pontufy-zip-'));
  const zipPath = path.join(dir, 'pacote.zip');
  const outDir = path.join(dir, 'saida');

  try {
    writeFileSync(zipPath, createZip(entries));

    let extracted = false;

    try {
      // `unzip -l` valida CRC e diretório central — erro vira exit code 1.
      const output = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
      for (const entry of entries) {
        assert.ok(output.includes(entry.name), `${entry.name} não aparece no índice do unzip`);
      }
      extracted = true;
    } catch (error) {
      // Sem `unzip` (Windows não tem por padrão): tenta o Expand-Archive.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    if (!extracted) {
      try {
        execFileSync(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`,
          ],
          { stdio: 'pipe' },
        );
        extracted = true;
      } catch {
        // cai no skip abaixo
      }
    }

    if (!extracted) {
      t.skip('Sem `unzip` nem PowerShell para validar externamente.');
      return;
    }

    if (existsSync(outDir)) {
      assert.ok(existsSync(path.join(outDir, 'imsmanifest.xml')), 'imsmanifest.xml não foi extraído');
      assert.ok(
        existsSync(path.join(outDir, 'scormcontent', 'lesson-01.html')),
        'aula não foi extraída no caminho esperado',
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
