// Ícone de perfil no topo do Prumo (na linha da marca) e a foto: escolher, trocar e remover.
// A foto é reduzida aqui, no aparelho, para um quadrado de 192 px em JPEG (uns 15 a 35 KB), e só então enviada.
import { API_BASE } from '../config.js';
import { el, toast } from './dom.js';
import { confirmDialog } from './confirm.js';

const SIZE = 192;
const MAX_BYTES = 36 * 1024;
const button = () => document.getElementById('acc-profile-btn');

const initialOf = (acc) => {
  const base = (acc.profile?.displayName || acc.email || '?').trim();
  return base.charAt(0).toUpperCase() || '?';
};
const photoUrl = (at) => `${API_BASE}/account/avatar?v=${encodeURIComponent(at)}`;

/** Conteúdo do círculo: a foto, ou a inicial da pessoa quando não há foto. */
function face(acc, className) {
  const at = acc.profile?.avatarAt;
  if (at) return el('img', { class: className, src: photoUrl(at), alt: '', width: String(SIZE / 2), height: String(SIZE / 2), decoding: 'async' });
  return el('span', { class: `${className} avatar-initial`, 'aria-hidden': 'true' }, initialOf(acc));
}

export function hideHeaderAvatar() {
  const b = button();
  if (!b) return;
  b.hidden = true;
  b.replaceChildren();
  b.onclick = null;
}

/** Mostra o ícone no topo. `onOpen` abre a aba Perfil. */
export function showHeaderAvatar(acc, onOpen) {
  const b = button();
  if (!b) return;
  b.hidden = false;
  b.replaceChildren(face(acc, 'avatar-img'));
  b.setAttribute('aria-label', `Meu perfil${acc.profile?.displayName ? `, ${acc.profile.displayName}` : ''}`);
  b.onclick = onOpen;
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* cai no <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** Foto qualquer → JPEG quadrado de 192 px, centralizado, até ~36 KB. */
export async function photoToAvatar(file) {
  const src = await loadBitmap(file);
  const w = src.width;
  const h = src.height;
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, SIZE, SIZE);
  c.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) {
    const blob = await toBlob(canvas, q);
    if (blob && blob.size <= MAX_BYTES) {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      return { mime: 'image/jpeg', data };
    }
  }
  throw new Error('foto_grande');
}

/** Cartão "Foto do perfil" (aba Perfil): incluir, trocar e remover. */
export function avatarCard(ctx, openProfile) {
  const acc = ctx.acc;
  const has = Boolean(acc.profile?.avatarAt);
  const input = el('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Escolher foto do perfil' });
  const pick = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, has ? 'Trocar foto' : 'Escolher foto');
  const remove = has ? el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Remover foto') : null;
  pick.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    pick.disabled = true;
    try {
      const out = await ctx.api.saveAvatar(await photoToAvatar(file));
      acc.profile = { ...acc.profile, avatarAt: out.avatarAt };
      showHeaderAvatar(acc, openProfile);
      toast('Foto atualizada.');
      ctx.refresh();
    } catch (e) {
      pick.disabled = false;
      toast(e?.message === 'foto_grande' ? 'Essa foto ficou grande demais. Tente outra.' : e?.status === 415 ? 'Não consegui ler essa imagem. Tente outra foto.' : 'Não consegui salvar a foto agora.');
    }
  });
  if (remove) {
    remove.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Remover a foto?', text: 'O ícone volta a mostrar a inicial do seu nome.', confirmLabel: 'Remover' }))) return;
      try {
        await ctx.api.deleteAvatar();
        acc.profile = { ...acc.profile, avatarAt: null };
        showHeaderAvatar(acc, openProfile);
        toast('Foto removida.');
        ctx.refresh();
      } catch { toast('Não consegui remover agora.'); }
    });
  }
  return el('section', { class: 'card d-section avatar-card' },
    el('h2', {}, 'Foto do perfil'),
    el('div', { class: 'avatar-row' }, el('span', { class: 'avatar-big' }, face(acc, 'avatar-img')), el('div', { class: 'row-actions' }, pick, remove, input)),
    el('p', { class: 'fine muted' }, 'Aparece no ícone do topo. Só você vê. Reduzimos a foto no seu aparelho antes de guardar.'),
  );
}
