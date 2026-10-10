const KEY = 'folego:rascunho:v1';

let uid = 0;
export function newDebt() {
  uid += 1;
  return {
    uid: `d${Date.now().toString(36)}${uid}`,
    creditor: '',
    kind: '',
    kindNote: '', // só quando o tipo é "Outra": a pessoa diz qual dívida é
    balanceCents: null,
    paymentCents: null,
    overdue: '', // '' | 'no' | 'yes'
    overdueBand: '',
    installments: '',
    ratePct: '',
    firstDefaultMonth: '',
  };
}

export function emptyAnswers() {
  return {
    employmentType: '',
    cltContract: '', // só quando o vínculo é CLT: 'permanent' (prazo indeterminado) ou 'temporary' (contratação temporária)
    employmentNote: '', // só quando o vínculo é "Outra situação": a pessoa conta, em poucas palavras, como entra o dinheiro
    netIncomeCents: null,
    ageBand: '',
    uf: '',
    fixedExpensesCents: null,
    debts: [newDebt()],
    consent: false,
  };
}

export const state = {
  answers: emptyAnswers(),
  step: 0,
  doneSteps: [],
  caseId: null,
  preview: null,
  bumpCards: false,
  orderId: null,
  paid: false,
  /** Assinante do Prumo: preço/uso do Mapa calculados pelo servidor (null para visitantes e para o plano Controle). */
  mapOffer: null,
  /** Veio do convite "Falar com um parceiro": na prévia, abre o formulário do parceiro. */
  partnerGoal: false,
};

// O rascunho fica só neste navegador (sessionStorage) para o refresh não apagar o formulário.
// Pode falhar (modo privado, armazenamento bloqueado): o site funciona sem ele.
export function saveDraft() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ answers: state.answers, step: state.step, doneSteps: state.doneSteps }));
  } catch {
    /* sem armazenamento: segue sem rascunho */
  }
}

export function loadDraft() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || !saved.answers) return false;
    state.answers = { ...emptyAnswers(), ...saved.answers };
    if (!Array.isArray(state.answers.debts) || state.answers.debts.length === 0) state.answers.debts = [newDebt()];
    state.step = Number.isInteger(saved.step) ? saved.step : 0;
    state.doneSteps = Array.isArray(saved.doneSteps) ? saved.doneSteps : [];
    return true;
  } catch {
    return false;
  }
}

export function wipeAll() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nada a apagar */
  }
  state.answers = emptyAnswers();
  state.step = 0;
  state.doneSteps = [];
  state.caseId = null;
  state.preview = null;
  state.bumpCards = false;
  state.orderId = null;
  state.paid = false;
  state.addonCodes = null;
  state.translatorCaseId = null;
  state.translatorOrderId = null;
}
