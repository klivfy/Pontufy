import type { ComponentPropsWithoutRef } from 'react';

/**
 * Wordmark Pontufy.
 *
 * Existe como componente por um motivo concreto: antes cada tela repetia
 * `<span className="text-md-primary">Pontu</span>fy`. Dentro de um container
 * `inline-flex gap-*` (vários logos usavam `gap-2`), o texto "fy" vira um flex
 * item anônimo e o `gap` abre um espaço visível — o wordmark aparecia como
 * "Pontu fy". Aqui o nome inteiro é um único nó de texto, então nenhum `gap`
 * do ancestral consegue parti-lo.
 *
 * A cor de "Pontu" é `md-primary` (e não `primary-container`): o container é
 * um tom pastel pensado para fundo, não para texto.
 */
export default function Wordmark({ className = '', ...rest }: ComponentPropsWithoutRef<'span'>) {
  return (
    <span className={`whitespace-nowrap leading-none ${className}`} {...rest}>
      <span className="text-md-primary">Pontu</span>fy
    </span>
  );
}
