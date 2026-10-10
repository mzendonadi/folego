// Divide os contatos de uma planilha em lotes pequenos para enviar ao servidor.
// O nginx corta corpos acima de 64 KB nas rotas da API: por isso os lotes são medidos em bytes, não em linhas.
// Uma linha com muitas colunas extras pesa mais que uma simples; o lote fecha antes de passar do teto.
export const MAX_BATCH_BYTES = 40_000;
export const MAX_BATCH_ROWS = 250;

export function batchesBySize(records, maxBytes = MAX_BATCH_BYTES, maxRows = MAX_BATCH_ROWS) {
  const enc = new TextEncoder();
  const out = [];
  let cur = [];
  let size = 0;
  for (const r of records) {
    const bytes = enc.encode(JSON.stringify(r)).length + 1;
    if (cur.length && (size + bytes > maxBytes || cur.length >= maxRows)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += bytes;
  }
  if (cur.length) out.push(cur);
  return out;
}
