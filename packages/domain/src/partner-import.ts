// Importação de planilhas de contatos do parceiro (Euro Multiplan): leitura de .xlsx no próprio navegador (sem biblioteca),
// reconhecimento das colunas e normalização de cada linha. Roda no navegador e no servidor (o servidor revalida tudo).
// A planilha original NÃO tem linha de cabeçalho: o layout "SIAPE 67 colunas" é posicional (A..BO). Planilhas com cabeçalho
// são reconhecidas pelo nome das colunas. O que não tem campo próprio vai em `extra` (coluna -> valor) e fica guardado.

export type SheetRow = Record<string, string>;

const dec = (s: string): string => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lê o diretório central do zip e devolve uma função para extrair cada arquivo como texto. */
function openZip(bytes: Uint8Array): { has: (name: string) => boolean; text: (name: string) => Promise<string>; names: string[] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e -= 1;
  if (e < 0) throw new Error('Arquivo não é um .xlsx válido.');
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const entries = new Map<string, { method: number; size: number; offset: number }>();
  const utf8 = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Arquivo .xlsx corrompido.');
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true);
    const el = v.getUint16(p + 30, true);
    const cl = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    entries.set(utf8.decode(bytes.subarray(p + 46, p + 46 + nl)), { method, size, offset });
    p += 46 + nl + el + cl;
  }
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    text: async (name) => {
      const en = entries.get(name);
      if (!en) throw new Error(`Faltou ${name} no .xlsx.`);
      const lnl = v.getUint16(en.offset + 26, true);
      const lel = v.getUint16(en.offset + 28, true);
      const start = en.offset + 30 + lnl + lel;
      const raw = bytes.subarray(start, start + en.size);
      if (en.method === 0) return utf8.decode(raw);
      if (en.method !== 8) throw new Error('Compressão do .xlsx não suportada.');
      return utf8.decode(await inflateRaw(raw));
    },
  };
}

export const MAX_XLSX_BYTES = 60 * 1024 * 1024;

/** Primeira planilha do arquivo, linha a linha, com as células indexadas pela letra da coluna (A, B, ... AA, ...). */
export async function readXlsx(input: ArrayBuffer | Uint8Array): Promise<SheetRow[]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_XLSX_BYTES) throw new Error('Arquivo grande demais. Divida a planilha em partes de até 60 MB.');
  const zip = openZip(bytes);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (zip.has('xl/workbook.xml') && zip.has('xl/_rels/workbook.xml.rels')) {
    const wb = await zip.text('xl/workbook.xml');
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
    const rels = await zip.text('xl/_rels/workbook.xml.rels');
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (rid && new RegExp(`Id="${rid}"`).test(m[0])) {
        const target = /Target="([^"]+)"/.exec(m[0])?.[1];
        if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      }
    }
  }
  if (!zip.has(sheetPath)) sheetPath = zip.names.find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)) ?? sheetPath;
  const shared: string[] = [];
  if (zip.has('xl/sharedStrings.xml')) {
    const sst = await zip.text('xl/sharedStrings.xml');
    for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(dec([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]!).join('')));
  }
  const xml = await zip.text(sheetPath);
  const rows: SheetRow[] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: SheetRow = {};
    for (const c of rm[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = /\br="([A-Z]+)\d+"/.exec(c[1]!)?.[1];
      if (!col) continue;
      const attrs = c[1]!;
      const body = c[2] ?? '';
      let val: string | undefined;
      if (/\bt="s"/.test(attrs)) val = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1])];
      else if (/\bt="inlineStr"/.test(attrs)) val = dec([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]!).join(''));
      else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        val = raw === undefined ? undefined : dec(raw);
      }
      if (val !== undefined && val.trim() !== '') row[col] = val.trim();
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------------------------------------------------
export interface PartnerContactRecord {
  cpf: string;
  name: string;
  birthDate?: string | undefined;
  age?: number | undefined;
  sex?: 'F' | 'M' | undefined;
  motherName?: string | undefined;
  matricula?: string | undefined;
  /** UF do órgão/lotação (coluna O da planilha); a UF do endereço fica em address.uf (coluna BC). */
  orgUf?: string | undefined;
  orgCode?: string | undefined;
  serviceStatus?: string | undefined;
  entryDate?: string | undefined;
  baseCents?: number | undefined;
  marginUsedCents?: number | undefined;
  /** Margem consignável livre (a menor entre as duas bases: 35% e 70% da remuneração). */
  availableMarginCents?: number | undefined;
  cardMarginCents?: number | undefined;
  phones: string[];
  emails: string[];
  address: { street?: string | undefined; number?: string | undefined; complement?: string | undefined; district?: string | undefined; city?: string | undefined; uf?: string | undefined; cep?: string | undefined };
  bank: { payer?: string | undefined; agency?: string | undefined; account?: string | undefined; kind?: string | undefined };
  extra: Record<string, string>;
}

/** Colunas da planilha da Euro (sem cabeçalho). O significado é o mais provável pelos dados; conferir com a Euro. */
export const SIAPE_LAYOUT = {
  cpf: 'A', name: 'B', birthDate: 'C', age: 'D', sex: 'E', motherName: 'F',
  bankKind: 'G', agency: 'H', account: 'I', payer: 'J', entryDate: 'K', matricula: 'M',
  orgUf: 'O', orgCode: 'P', baseCents: 'AA', cardMarginCents: 'AD', marginUsedCents: 'AI', availableMarginCents: 'AV', serviceStatus: 'AU',
  street: 'AX', number: 'AY', complement: 'AZ', district: 'BA', city: 'BB', uf: 'BC', cep: 'BD',
  phones: ['BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BK', 'BL'], emails: ['BM', 'BN', 'BO'],
} as const;

/** Nome legível de cada coluna conhecida (usado na tela de importação e na documentação). */
export const SIAPE_COLUMN_LABELS: Record<string, string> = {
  A: 'CPF', B: 'Nome', C: 'Data de nascimento', D: 'Idade', E: 'Sexo', F: 'Nome da mãe', G: 'Tipo de conta', H: 'Agência', I: 'Conta', J: 'Banco pagador',
  K: 'Data de ingresso (provável)', M: 'Matrícula', O: 'UF do órgão', P: 'Código do órgão', Q: 'Valor Q (a confirmar)', R: 'Valor R (a confirmar)', S: 'Código S (a confirmar)',
  T: 'Estabilidade', U: 'Código U (único)', AA: 'Base de cálculo da margem', AB: 'Margem de cartão 5% (total)', AD: 'Margem de cartão livre', AH: 'Margem 35% (total)', AI: 'Margem 35% usada',
  AJ: 'Margem 35% livre', AK: 'Teto 70% (total)', AL: 'Comprometido do teto 70%', AM: 'Teto 70% livre', AQ: 'Lotação', AT: 'Regime', AU: 'Situação funcional', AV: 'Margem livre efetiva',
  AX: 'Logradouro', AY: 'Número', AZ: 'Complemento', BA: 'Bairro', BB: 'Cidade', BC: 'UF do endereço', BD: 'CEP',
  BE: 'Telefone 1', BF: 'Telefone 2', BG: 'Telefone 3', BH: 'Telefone 4', BI: 'Telefone 5', BJ: 'Fixo 1', BK: 'Fixo 2', BL: 'Fixo 3', BM: 'E-mail 1', BN: 'E-mail 2', BO: 'E-mail 3',
};

export type LayoutMap = Partial<Record<keyof typeof SIAPE_LAYOUT, string | readonly string[]>>;

const strip = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const ALIASES: [keyof typeof SIAPE_LAYOUT, RegExp][] = [
  ['cpf', /^(cpf|documento)$/], ['name', /^(nome|nome completo|cliente|servidor|nome do servidor)$/], ['birthDate', /^(nascimento|data de nascimento|dt nascimento|data nasc)$/], ['sex', /^(sexo|genero)$/],
  ['motherName', /^(mae|nome da mae|filiacao)$/], ['matricula', /^(matricula|siape|matricula siape)$/], ['orgUf', /^(uf orgao|uf do orgao|uf lotacao)$/],
  ['serviceStatus', /^(situacao|situacao funcional|status funcional)$/], ['availableMarginCents', /^(margem|margem livre|margem disponivel|margem consignavel)$/],
  ['cardMarginCents', /^(margem cartao|margem do cartao|margem de cartao)$/], ['baseCents', /^(salario|remuneracao|renda|salario bruto|remuneracao bruta)$/],
  ['street', /^(endereco|logradouro|rua)$/], ['number', /^(numero|num)$/], ['complement', /^(complemento)$/], ['district', /^(bairro)$/], ['city', /^(cidade|municipio)$/], ['uf', /^(uf|estado)$/], ['cep', /^(cep)$/],
  ['payer', /^(banco|banco pagador)$/], ['agency', /^(agencia)$/], ['account', /^(conta)$/], ['orgCode', /^(orgao|codigo do orgao|cod orgao)$/],
];

/** Descobre o layout: sem cabeçalho (A = CPF numérico, B = nome) usa o layout posicional da Euro; com cabeçalho, mapeia pelos nomes das colunas. */
export function detectLayout(first: SheetRow | undefined): { kind: 'siape' | 'cabecalho' | 'desconhecido'; map: LayoutMap } {
  if (!first) return { kind: 'desconhecido', map: {} };
  const a = first.A ?? '';
  if (/^[\d.\-\s]{9,14}$/.test(a) && first.B && !/^[\d.]+$/.test(first.B)) return { kind: 'siape', map: SIAPE_LAYOUT as unknown as LayoutMap };
  const map: Record<string, string | string[]> = {};
  const phones: string[] = [];
  const emails: string[] = [];
  for (const [col, text] of Object.entries(first)) {
    const t = strip(text);
    if (/^(telefone|celular|fone|whatsapp|tel)( \d+)?$/.test(t)) phones.push(col);
    else if (/^(e mail|email)( \d+)?$/.test(t)) emails.push(col);
    else for (const [key, re] of ALIASES) if (re.test(t) && map[key] === undefined) { map[key] = col; break; }
  }
  if (phones.length) map.phones = phones;
  if (emails.length) map.emails = emails;
  if (!map.cpf || !map.name) return { kind: 'desconhecido', map: {} };
  return { kind: 'cabecalho', map: map as LayoutMap };
}

export function cleanCpf(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 0 || d.length > 11) return null;
  const cpf = d.padStart(11, '0'); // o Excel perde os zeros à esquerda
  if (/^(\d)\1{10}$/.test(cpf)) return null;
  const dv = (n: number): number => {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Number(cpf[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]) ? cpf : null;
}

/** Data: serial do Excel (dias desde 1899-12-30), ISO ou dd/mm/aaaa. */
export function toIsoDate(v: unknown): string | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (br) return `${br[3]}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`;
  const n = Number(s);
  if (Number.isFinite(n) && n > 1000 && n < 100000) return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000).toISOString().slice(0, 10);
  return undefined;
}

const toCents = (v: unknown): number | undefined => {
  const raw = String(v ?? '').trim();
  if (!raw) return undefined;
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
};

export function normalizePhone(v: unknown): string | null {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  d = d.replace(/^0+/, '');
  return d.length === 10 || d.length === 11 ? d : null;
}

const txt = (v: unknown, max = 120): string | undefined => {
  const s = String(v ?? '').trim();
  return s && s !== '0' ? s.slice(0, max) : undefined;
};
const cells = (row: SheetRow, ref: string | readonly string[] | undefined): string[] => (ref === undefined ? [] : (typeof ref === 'string' ? [ref] : ref).map((c) => row[c] ?? '').filter((x) => x !== ''));
const first = (row: SheetRow, ref: string | readonly string[] | undefined): string => cells(row, ref)[0] ?? '';

export interface NormalizeResult { record?: PartnerContactRecord; error?: 'sem_cpf' | 'cpf_invalido' | 'sem_nome' }

export function normalizeRow(row: SheetRow, map: LayoutMap): NormalizeResult {
  const rawCpf = first(row, map.cpf);
  if (!rawCpf) return { error: 'sem_cpf' };
  const cpf = cleanCpf(rawCpf);
  if (!cpf) return { error: 'cpf_invalido' };
  const name = txt(first(row, map.name), 120);
  if (!name) return { error: 'sem_nome' };
  const used = new Set<string>();
  for (const v of Object.values(map)) for (const c of typeof v === 'string' ? [v] : v ?? []) used.add(c);
  const extra: Record<string, string> = {};
  for (const [col, value] of Object.entries(row)) if (!used.has(col) && value !== '' && value !== '0') extra[col] = value.slice(0, 160);
  const sex = first(row, map.sex).toUpperCase();
  const phones = [...new Set(cells(row, map.phones).map(normalizePhone).filter((x): x is string => x !== null))];
  const emails = [...new Set(cells(row, map.emails).map((e) => e.toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
  const age = Number(first(row, map.age));
  const ufOf = (v: string): string | undefined => (/^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : undefined);
  const cep = first(row, map.cep).replace(/\D/g, '').padStart(8, '0').slice(0, 8);
  return {
    record: {
      cpf, name,
      birthDate: toIsoDate(first(row, map.birthDate)),
      age: Number.isInteger(age) && age > 0 && age < 130 ? age : undefined,
      sex: sex === 'F' || sex === 'M' ? sex : undefined,
      motherName: txt(first(row, map.motherName)),
      matricula: txt(first(row, map.matricula), 40),
      orgUf: ufOf(first(row, map.orgUf)),
      orgCode: txt(first(row, map.orgCode), 40),
      serviceStatus: txt(first(row, map.serviceStatus), 60),
      entryDate: toIsoDate(first(row, map.entryDate)),
      baseCents: toCents(first(row, map.baseCents)),
      marginUsedCents: toCents(first(row, map.marginUsedCents)),
      availableMarginCents: toCents(first(row, map.availableMarginCents)),
      cardMarginCents: toCents(first(row, map.cardMarginCents)),
      phones, emails,
      address: { street: txt(first(row, map.street)), number: txt(first(row, map.number), 20), complement: txt(first(row, map.complement), 60), district: txt(first(row, map.district), 80), city: txt(first(row, map.city), 80), uf: ufOf(first(row, map.uf)), cep: cep && cep !== '00000000' ? cep : undefined },
      bank: { payer: txt(first(row, map.payer), 80), agency: txt(first(row, map.agency), 20), account: txt(first(row, map.account), 30), kind: txt(first(row, map.bankKind), 20) },
      extra,
    },
  };
}

export interface PartnerSheetPlan {
  layout: 'siape' | 'cabecalho' | 'desconhecido';
  total: number;
  records: PartnerContactRecord[];
  invalid: { sem_cpf: number; cpf_invalido: number; sem_nome: number };
  /** Linhas repetidas dentro do próprio arquivo (mesmo CPF): só a primeira vale. */
  repeatedInFile: number;
}

/** Do arquivo lido para a lista pronta de contatos (sem repetidos), com a contagem do que foi descartado e por quê. */
export function planSheet(rows: SheetRow[]): PartnerSheetPlan {
  const det = detectLayout(rows[0]);
  const plan: PartnerSheetPlan = { layout: det.kind, total: 0, records: [], invalid: { sem_cpf: 0, cpf_invalido: 0, sem_nome: 0 }, repeatedInFile: 0 };
  if (det.kind === 'desconhecido') return plan;
  const body = det.kind === 'cabecalho' ? rows.slice(1) : rows;
  const seen = new Set<string>();
  plan.total = body.length;
  for (const row of body) {
    const r = normalizeRow(row, det.map);
    if (!r.record) {
      plan.invalid[r.error!] += 1;
      continue;
    }
    if (seen.has(r.record.cpf)) {
      plan.repeatedInFile += 1;
      continue;
    }
    seen.add(r.record.cpf);
    plan.records.push(r.record);
  }
  return plan;
}
