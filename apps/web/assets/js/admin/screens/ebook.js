// Marketing → eBook de presente: repositório do PDF que vai por e-mail, sozinho, a quem assina Ousado ou Desbravador.
// Dá para subir, atualizar o arquivo, trocar o título, ativar uma versão, baixar, mandar um teste e excluir.
import { api } from '../api.js';
import { el, toast, int, dt, card, field, loading, errorBox, kpis, kpi } from '../ui.js';
import { confirmDialog } from '../../confirm.js';

const mb = (b) => `${(b / 1024 / 1024).toFixed(2).replace('.', ',')} MB`;

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

export async function ebookTab() {
  const host = el('div', { class: 'bo-stack' });

  async function draw() {
    host.replaceChildren(loading());
    try {
      const d = await api.ebooks();
      const active = d.ebooks.find((e) => e.active) ?? null;
      const others = d.ebooks.filter((e) => !e.active);

      const download = (e) => {
        const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Baixar PDF');
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const f = await api.baixarEbook(e.id);
            save(f.blob, f.filename);
          } catch (err) {
            toast(err.message);
          }
          b.disabled = false;
        });
        return b;
      };
      const remove = (e) => {
        const b = el('button', { class: 'btn btn-danger btn-sm', type: 'button' }, 'Excluir');
        b.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: 'Excluir este eBook?',
            text: e.active ? 'Ele é o eBook de presente em uso. Sem outro ativo, novos assinantes ficam sem o presente até você ativar ou subir outro. Esta ação não pode ser desfeita.' : 'O arquivo será apagado para sempre.',
            confirmLabel: 'Excluir',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.apagarEbook(e.id);
            toast('eBook excluído.');
            draw();
          } catch (err) {
            toast(err.message);
          }
        });
        return b;
      };
      const replaceBtn = (e) => {
        const input = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, 'aria-label': 'Novo arquivo PDF' });
        const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Atualizar arquivo');
        b.addEventListener('click', () => input.click());
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          b.disabled = true;
          try {
            await api.atualizarEbook(e.id, file);
            toast('Arquivo atualizado (nova versão).');
            draw();
          } catch (err) {
            b.disabled = false;
            toast(err.message);
          }
        });
        return el('span', {}, input, b);
      };

      let activeCard;
      if (active) {
        const title = el('input', { class: 'input', type: 'text', maxlength: '160', value: active.title, 'aria-label': 'Título do eBook' });
        const saveTitle = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Salvar título');
        saveTitle.addEventListener('click', async () => {
          try {
            await api.editarEbook(active.id, { title: title.value.trim() });
            toast('Título salvo.');
            draw();
          } catch (err) {
            toast(err.message);
          }
        });
        const test = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !d.emailConfigured }, 'Enviar teste para o meu e-mail');
        test.addEventListener('click', async () => {
          test.disabled = true;
          try {
            const r = await api.testarEbook(active.id);
            toast(`Teste enviado para ${r.to}.`);
          } catch (err) {
            toast(err.message);
          }
          test.disabled = false;
        });
        activeCard = card(
          'eBook de presente (ativo)',
          el('p', { class: 'muted' }, 'É o arquivo que vai em anexo no e-mail de agradecimento a quem assina um plano Ousado ou Desbravador.'),
          el('div', { class: 'bo-actions' }, field('Título', title), saveTitle),
          el('p', { class: 'fine' }, `${active.filename} · ${mb(active.sizeBytes)} · versão ${active.version} · atualizado ${dt(active.updatedAt)} · enviado a ${int(active.sentCount)} pessoa(s)${active.source === 'padrao' ? ' · eBook padrão do Fôlego' : ''}`),
          el('div', { class: 'bo-actions' }, download(active), replaceBtn(active), test, remove(active)),
          d.emailConfigured ? null : el('p', { class: 'note note-amber' }, 'O envio de e-mail não está configurado no servidor: o presente só sai depois que ele for configurado.'),
        );
      } else {
        activeCard = card('Nenhum eBook ativo', el('p', { class: 'note note-amber' }, 'Sem um eBook ativo, ninguém recebe o presente. Suba um PDF abaixo ou ative uma versão anterior.'));
      }

      const titleIn = el('input', { class: 'input', type: 'text', maxlength: '160', placeholder: 'Ex.: Respira. Organiza. Avança. (edição 2)', 'aria-label': 'Título do novo eBook' });
      const fileIn = el('input', { class: 'input', type: 'file', accept: 'application/pdf,.pdf', 'aria-label': 'Arquivo PDF' });
      const activate = el('input', { type: 'checkbox', id: 'eb-ativar', checked: true });
      const upload = el('button', { class: 'btn btn-primary', type: 'button' }, 'Subir PDF');
      upload.addEventListener('click', async () => {
        const file = fileIn.files?.[0];
        if (!file) return toast('Escolha o arquivo PDF.');
        if (file.size > 15 * 1024 * 1024) return toast('O PDF passa de 15 MB.');
        upload.disabled = true;
        try {
          await api.subirEbook({ file, title: titleIn.value.trim() || file.name.replace(/\.pdf$/i, ''), activate: activate.checked });
          toast(activate.checked ? 'eBook enviado e ativado. Os próximos assinantes recebem esta versão.' : 'eBook guardado (inativo).');
          draw();
        } catch (err) {
          upload.disabled = false;
          toast(err.message);
        }
      });

      const olderRows = others.map((e) => {
        const act = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Usar como presente');
        act.addEventListener('click', async () => {
          try {
            await api.editarEbook(e.id, { active: true });
            toast('Versão ativada.');
            draw();
          } catch (err) {
            toast(err.message);
          }
        });
        return el('li', { class: 'bo-row' }, el('div', {}, el('strong', {}, e.title), el('p', { class: 'fine' }, `${e.filename} · ${mb(e.sizeBytes)} · v${e.version} · criado ${dt(e.createdAt)} · enviado ${int(e.sentCount)}x`)), el('div', { class: 'bo-actions' }, act, download(e), replaceBtn(e), remove(e)));
      });

      host.replaceChildren(...[
        kpis(
          kpi('Presente automático', active ? 'Ligado' : 'Pausado', active ? 'quem assina Ousado ou Desbravador recebe' : 'sem eBook ativo', active ? 'good' : 'warn'),
          kpi('Aguardando envio', int(d.waiting), d.waiting ? 'assinantes na fila (o envio sai em instantes)' : 'ninguém na fila', ''),
          kpi('Enviados (eBook ativo)', int(active?.sentCount ?? 0), 'pessoas presenteadas', ''),
        ),
        activeCard,
        card('Subir um novo eBook', el('p', { class: 'muted' }, 'Aceita PDF de até 15 MB. Ao ativar, o novo arquivo passa a ser o presente de quem assinar daqui para frente; quem já recebeu não recebe de novo.'), el('div', { class: 'bo-actions' }, field('Título', titleIn), field('Arquivo', fileIn)), el('div', { class: 'check' }, activate, el('label', { for: 'eb-ativar' }, 'Tornar este o eBook de presente agora')), el('div', { class: 'bo-actions' }, upload)),
        others.length ? card('Outras versões guardadas', el('ul', { class: 'bo-list' }, ...olderRows)) : null,
        el('p', { class: 'fine' }, 'O e-mail de agradecimento usa o visual do Fôlego/Prumo e é enviado uma única vez por pessoa. Quem sobe de Controle para Ousado ou Desbravador também recebe. Use "Enviar teste" para ver o e-mail chegando.'),
      ].filter(Boolean));
    } catch (e) {
      host.replaceChildren(errorBox(e, draw));
    }
  }
  await draw();
  return host;
}
