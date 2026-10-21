# brag (copia de projeto)

Origem: https://github.com/latent-spaces/brag (MIT, ver LICENSE), commit 069432c, plugin 0.4.0.

Diferencas em relacao ao original:
- `assets/music/` (5 trilhas mp3 e seus cues) NAO foi copiado: o README do projeto pede para verificar a licenca das musicas antes de
  redistribuir. A skill continua funcionando sem elas (cues sao detectados na composicao; qualquer trilha propria serve).
- Copia real dos arquivos (sem symlinks) e sem os manifestos de plugin, exemplos, docs e o site.

Uso: pedir "let's /brag" ao agente dentro do projeto. Requer Node.js 22+, FFmpeg e o CLI Hyperframes (npx hyperframes doctor).
A skill roda `npx hyperframes ...` (pacote npm sem versao fixa) apenas quando e usada.
