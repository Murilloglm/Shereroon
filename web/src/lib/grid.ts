/**
 * Divide o espaço em `count` cartões de mesma proporção (16:9 por padrão), no maior tamanho que cabe: testa
 * cada número de colunas e fica com o que dá o cartão mais largo.
 */
export function bestGrid(count: number, width: number, height: number, gap: number, ratio = 16 / 9) {
  if (count <= 0) return { columns: 0, rows: 0, width: 0, height: 0 };
  let best = { columns: 1, rows: count, width: 0, height: 0 };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const byWidth = (width - gap * (columns - 1)) / columns;
    const byHeight = ((height - gap * (rows - 1)) / rows) * ratio;
    const tile = Math.max(0, Math.min(byWidth, byHeight));
    if (tile > best.width) best = { columns, rows, width: tile, height: tile / ratio };
  }
  return best;
}
