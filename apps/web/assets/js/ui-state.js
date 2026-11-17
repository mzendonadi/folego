// Estado de tela que sobrevive enquanto a sessão estiver ativa: filtros, busca, página e aba escolhidos no backoffice (/gestao) e no portal do parceiro.
// Fica no sessionStorage (some ao fechar a aba do navegador ou ao sair da conta) e guarda só escolhas de tela, nunca dados de clientes.
// O objeto devolvido é um Proxy: qualquer atribuição (`st.page = 2`, `st.filtro = 'todos'`) já grava, sem chamar nada.

const SAVE_DELAY_MS = 120;

/** Cria (ou recupera da sessão) o estado `key`. Campos novos de `initial` entram sozinhos; um valor guardado de outro tipo é ignorado. */
export function persistentState(key, initial, { transient = [] } = {}) {
  let data = clone(initial);
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) data = merge(data, JSON.parse(raw));
  } catch {
    /* sem armazenamento ou conteúdo inválido: começa do padrão */
  }
  let timer = 0;
  const flush = () => {
    window.clearTimeout(timer);
    try {
      // `transient`: campos que passam de uma tela para outra mas nunca ficam guardados (ex.: celular de um contato).
      sessionStorage.setItem(key, JSON.stringify(data, (k, v) => (transient.includes(k) ? undefined : v)));
    } catch {
      /* sem armazenamento: o estado vale só nesta tela */
    }
  };
  const save = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, SAVE_DELAY_MS);
  };
  // Uma tela que recebeu um bloco recém-criado pode mudá-lo direto (sem passar pelo Proxy): ao recarregar ou sair da página, grava tudo o que está na memória.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  const wrap = (obj) => new Proxy(obj, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      return value && typeof value === 'object' && !(value instanceof Set) && !(value instanceof Map) ? wrap(value) : value;
    },
    set(target, prop, value, receiver) {
      const ok = Reflect.set(target, prop, value, receiver);
      save();
      return ok;
    },
    deleteProperty(target, prop) {
      const ok = Reflect.deleteProperty(target, prop);
      save();
      return ok;
    },
  });
  return wrap(data);
}

/** Esquece tudo o que foi guardado com `key` (ao sair da conta ou quando a sessão termina). */
export function clearPersistentState(...keys) {
  for (const key of keys) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* sem armazenamento */
    }
  }
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/** Só aceita do que foi guardado os campos de mesmo tipo; blocos que as telas criam depois (`state.<tela>`) entram como objetos simples. */
function merge(base, saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return base;
  for (const k of Object.keys(saved)) {
    if (k === '__proto__' || k === 'constructor') continue;
    if (!(k in base)) {
      if (saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k])) base[k] = saved[k];
      continue;
    }
    if (typeof base[k] === 'object' && base[k] && typeof saved[k] === 'object' && saved[k]) base[k] = merge(base[k], saved[k]);
    else if (typeof base[k] === typeof saved[k]) base[k] = saved[k];
  }
  return base;
}
