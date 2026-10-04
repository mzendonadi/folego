// Contagem regressiva do acesso de 30 dias dos produtos pagos no Pix, com o botão de refazer com novos dados.
// O mesmo componente aparece no Mapa, no tradutor e nos guias, para a regra ficar igual em todos.
import { el, icon } from './dom.js';

const DAY = 86_400_000;

/** Quanto falta, em palavras que a pessoa entende (dias; horas quando falta menos de 2 dias). */
export function timeLeft(accessUntil, now = Date.now()) {
  const ms = new Date(accessUntil).getTime() - now;
  if (ms <= 0) return { value: 0, unit: 'dias', label: 'Acesso encerrado', tone: 'critical', ms: 0 };
  if (ms < 2 * DAY) {
    const hours = Math.max(1, Math.ceil(ms / 3_600_000));
    return { value: hours, unit: hours === 1 ? 'hora' : 'horas', label: `Faltam ${hours} ${hours === 1 ? 'hora' : 'horas'}`, tone: 'critical', ms };
  }
  const days = Math.ceil(ms / DAY);
  return { value: days, unit: 'dias', label: `Faltam ${days} dias`, tone: days <= 5 ? 'attention' : 'ok', ms };
}

/**
 * @param {{ accessUntil: number | string, what: string, onRedo?: (() => void) | null, totalDays?: number, redoLabel?: string }} o
 *  what = o que foi liberado, ex.: "Mapa", "guia", "tradução".
 */
export function accessBanner({ accessUntil, what, onRedo = null, totalDays = 30, redoLabel = 'Refazer com novos dados' }) {
  const left = timeLeft(accessUntil);
  const until = new Date(accessUntil).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const pct = Math.max(0, Math.min(100, Math.round((left.ms / (totalDays * DAY)) * 100)));
  const redo = onRedo ? el('button', { class: 'btn btn-primary', type: 'button' }, icon('arrow-right'), redoLabel) : null;
  redo?.addEventListener('click', onRedo);
  return el(
    'section', { class: `access-banner tone-${left.tone} no-print`, role: 'status', 'aria-label': `Prazo de acesso: ${left.label}` },
    el('div', { class: 'ab-count' }, el('strong', {}, String(left.value)), el('span', {}, left.unit === 'dias' ? 'dias restantes' : `${left.unit} restantes`)),
    el(
      'div', { class: 'ab-body' },
      el('p', { class: 'ab-title' }, `Seu acesso ao ${what} vai até ${until}`),
      el('div', { class: 'ab-meter', role: 'img', 'aria-label': `${pct}% do prazo ainda disponível` }, el('span', { style: `width:${pct}%` })),
      el('p', { class: 'fine' }, `Até lá você pode refazer com dados novos quantas vezes quiser, sem pagar de novo. A data final não muda.${left.tone === 'ok' ? '' : ' Depois dela, o conteúdo deixa de abrir e os dados são apagados.'}`),
    ),
    redo,
  );
}
