// Portal do parceiro: importar planilha .xlsx da própria base. A planilha é lida AQUI, no navegador; só os dados já normalizados
// seguem para o servidor, em lotes, e o servidor nunca duplica (mesmo CPF = mesma pessoa).
import { el, icon, toast } from './dom.js';
import { readXlsx, planSheet, SIAPE_COLUMN_LABELS, MAX_XLSX_BYTES } from '../vendor/engine.js';

const BATCH = 200;
const n = (v) => Number(v).toLocaleString('pt-BR');
const LAYOUT = { siape: 'Planilha da Euro (colunas A a BO, sem cabeçalho)', cabecalho: 'Planilha com cabeçalho' };

export async function viewImportar(ctx) {
  const root = el('div', { class: 'pt-stack' });
  const stage = el('div', {});
  const history = el('div', {});

  const pick = el('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hidden: true, id: 'pt-file', 'aria-label': 'Escolher planilha .xlsx' });
  const drop = el('label', { class: 'pt-drop', for: 'pt-file' },
    icon('plus'),
    el('strong', {}, 'Escolha ou arraste a planilha (.xlsx)'),
    el('span', {}, 'Ela é lida neste aparelho. Contatos que já existem não são duplicados: o mesmo CPF vira a mesma pessoa, e telefones ou e-mails novos são somados.'));
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); });
  drop.addEventListener('drop', (e) => { const file = e.dataTransfer?.files?.[0]; if (file) read(file); });
  pick.addEventListener('change', () => { const file = pick.files?.[0]; pick.value = ''; if (file) read(file); });

  async function read(file) {
    if (!/\.xlsx$/i.test(file.name)) return toast('Use um arquivo .xlsx (Excel). Se for .xls ou .csv, salve como .xlsx.');
    if (file.size > MAX_XLSX_BYTES) return toast('Arquivo grande demais. Divida a planilha em partes de até 60 MB.');
    stage.replaceChildren(el('p', { class: 'pt-sub', role: 'status' }, `Lendo ${file.name}…`));
    let plan;
    try {
      plan = planSheet(await readXlsx(await file.arrayBuffer()));
    } catch (err) {
      stage.replaceChildren(el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, err.message || 'Não consegui ler esse arquivo.')));
      return;
    }
    if (plan.layout === 'desconhecido') {
      stage.replaceChildren(el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Não reconheci as colunas. Use a planilha no layout da Euro (sem cabeçalho, CPF na coluna A e nome na B) ou uma planilha com cabeçalho contendo pelo menos "CPF" e "Nome".')));
      return;
    }
    preview(file, plan);
  }

  function preview(file, plan) {
    const bad = plan.invalid.sem_cpf + plan.invalid.cpf_invalido + plan.invalid.sem_nome;
    const withPhone = plan.records.filter((r) => r.phones.length).length;
    const withMargin = plan.records.filter((r) => (r.availableMarginCents ?? 0) > 0).length;
    const go = el('button', { class: 'btn btn-primary', type: 'button', disabled: plan.records.length === 0 }, `Importar ${n(plan.records.length)} contatos`);
    const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Cancelar');
    cancel.addEventListener('click', () => stage.replaceChildren());
    const bar = el('div', { class: 'pt-bar pt-progress', hidden: true }, el('i', { style: 'width:0%' }));
    const status = el('p', { class: 'pt-sub', 'aria-live': 'polite' });
    const stat = (label, value, tone = '') => el('div', { class: `pt-metric ${tone}` }, el('span', { class: 'pt-metric-label' }, label), el('strong', { class: 'pt-metric-value' }, value));
    stage.replaceChildren(el('section', { class: 'pt-card' },
      el('h2', { class: 'pt-h2' }, file.name),
      el('p', { class: 'pt-sub' }, `Layout reconhecido: ${LAYOUT[plan.layout]}.`),
      el('div', { class: 'pt-metrics tight' },
        stat('Linhas no arquivo', n(plan.total)),
        stat('Contatos válidos', n(plan.records.length), 'is-accent'),
        stat('Repetidos no arquivo', n(plan.repeatedInFile)),
        stat('Descartados', n(bad))),
      bad ? el('p', { class: 'pt-sub' }, `Descartados: ${plan.invalid.sem_cpf} sem CPF, ${plan.invalid.cpf_invalido} com CPF inválido, ${plan.invalid.sem_nome} sem nome.`) : null,
      el('p', { class: 'pt-sub' }, `${n(withPhone)} com telefone · ${n(withMargin)} com margem livre.`),
      plan.layout === 'siape' ? el('details', { class: 'pt-cols-help' }, el('summary', {}, 'Como lemos as colunas desta planilha'), el('ul', {}, ...Object.entries(SIAPE_COLUMN_LABELS).map(([c, l]) => el('li', {}, el('strong', {}, c), ` ${l}`)))) : null,
      bar, status,
      el('div', { class: 'pt-actions' }, go, cancel)));
    go.addEventListener('click', async () => {
      go.disabled = true;
      cancel.disabled = true;
      bar.hidden = false;
      try {
        const start = await ctx.call('POST', '/partner/imports', { filename: file.name, layout: plan.layout, total: plan.total, invalid: bad, repeatedInFile: plan.repeatedInFile });
        for (let i = 0; i < plan.records.length; i += BATCH) {
          await ctx.call('POST', `/partner/imports/${start.importId}/rows`, { rows: plan.records.slice(i, i + BATCH) });
          const done = Math.min(plan.records.length, i + BATCH);
          bar.firstChild.style.width = `${Math.round((done / plan.records.length) * 100)}%`;
          status.textContent = `Enviando… ${n(done)} de ${n(plan.records.length)}`;
        }
        const r = await ctx.call('POST', `/partner/imports/${start.importId}/finish`, {});
        const view = el('button', { class: 'btn btn-primary', type: 'button' }, 'Ver minha base');
        view.addEventListener('click', () => ctx.go('base'));
        stage.replaceChildren(el('section', { class: 'pt-card pt-done' },
          el('h2', { class: 'pt-h2' }, 'Importação concluída'),
          el('div', { class: 'pt-metrics tight' }, stat('Contatos novos', n(r.created), 'is-accent'), stat('Atualizados', n(r.updated)), stat('Já estavam iguais', n(r.same)), stat('Descartados', n(r.invalid + r.repeatedInFile))),
          el('p', { class: 'pt-sub' }, 'Nada foi duplicado. Atualizados = ganharam telefone, e-mail ou margem nova; o que você já tinha anotado continua como estava.'),
          view));
        loadHistory();
      } catch (err) {
        status.textContent = '';
        go.disabled = false;
        cancel.disabled = false;
        toast(err.message || 'Não consegui importar agora.');
      }
    });
  }

  async function loadHistory() {
    try {
      const r = await ctx.call('GET', '/partner/imports');
      history.replaceChildren(el('section', { class: 'pt-card' }, el('h2', { class: 'pt-h2' }, 'Importações anteriores'),
        r.imports.length === 0 ? el('p', { class: 'pt-sub' }, 'Nenhuma importação ainda.') : el('div', { class: 'pt-table-wrap' }, el('table', { class: 'pt-table' },
          el('thead', {}, el('tr', {}, ...['Arquivo', 'Data', 'Novos', 'Atualizados', 'Iguais', 'Descartados'].map((h) => el('th', { scope: 'col' }, h)))),
          el('tbody', {}, ...r.imports.map((x) => el('tr', {}, el('td', {}, el('strong', {}, x.filename), el('span', { class: 'pt-cell-sub' }, x.finished ? LAYOUT[x.layout] : 'não concluída')), el('td', {}, new Date(x.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })), el('td', { class: 'num' }, n(x.created)), el('td', { class: 'num' }, n(x.updated)), el('td', { class: 'num' }, n(x.same)), el('td', { class: 'num' }, n(x.invalid + x.repeatedInFile)))))))));
    } catch (err) {
      if (!err.silent) history.replaceChildren(el('p', { class: 'note note-amber' }, err.message));
    }
  }

  root.append(
    el('header', { class: 'pt-head' }, el('div', {}, el('h1', {}, 'Importar planilha'), el('p', {}, 'Traga suas planilhas quantas vezes precisar. Cada versão nova só acrescenta o que falta: ninguém é duplicado.'))),
    el('section', { class: 'pt-card' }, drop, pick),
    stage, history);
  loadHistory();
  return root;
}
