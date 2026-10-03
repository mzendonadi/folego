// CAMADA DE API (MOCK). Em produção estas funções viram chamadas HTTP (POST /cases, GET /cases/:id/preview,
// POST /orders, GET /cases/:id/deliverables/:code) e o resultado completo NUNCA chega ao navegador antes do
// pagamento confirmado. Aqui, para a demonstração, o motor roda no navegador e o "servidor" é um Map em memória.
import { diagnose, buildPreview } from '../vendor/engine.js';

const cases = new Map(); // caseId → { input, diagnosis, paid }
const orders = new Map(); // orderId → { caseId, totalCents, items, paid, expiresAt }

const PRICES = { recovery_map: 2900, defense_letters: 1900, calendar_30d: 1999, extra_income_plan: 1599 };
const PIX_TTL_SECONDS = 30 * 60;

const id = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createCase(input) {
  const diagnosis = diagnose(input);
  const caseId = id('case');
  cases.set(caseId, { input, diagnosis, paid: false });
  return { caseId, preview: buildPreview(diagnosis, input.debts) };
}

export async function createOrder({ caseId, products }) {
  if (!cases.has(caseId)) throw new Error('caso não encontrado');
  const items = products;
  const totalCents = items.reduce((s, code) => s + PRICES[code], 0);
  const orderId = id('ord');
  const expiresAt = Date.now() + PIX_TTL_SECONDS * 1000;
  orders.set(orderId, { caseId, totalCents, items, paid: false, expiresAt });
  await wait(350);
  return {
    orderId,
    totalCents,
    items,
    expiresAt,
    // Payload de DEMONSTRAÇÃO. Não é um Pix válido; o real vem do gateway (copia e cola + QR dinâmico).
    pixCode: `DEMO-FOLEGO-${orderId.toUpperCase()}-${String(totalCents).padStart(6, '0')}-NAO-E-UM-PIX-REAL`,
  };
}

export async function getOrderStatus(orderId) {
  const order = orders.get(orderId);
  if (!order) return { status: 'unknown' };
  if (order.paid) return { status: 'paid' };
  if (Date.now() > order.expiresAt) return { status: 'expired' };
  return { status: 'pending' };
}

/** Só existe na demonstração: faz o papel do webhook do gateway confirmando o Pix. */
export async function demoConfirmPayment(orderId) {
  const order = orders.get(orderId);
  if (!order) throw new Error('pedido não encontrado');
  await wait(600);
  order.paid = true;
  const c = cases.get(order.caseId);
  if (c) c.paid = true;
  return { status: 'paid' };
}

export async function getDelivery(orderId) {
  const order = orders.get(orderId);
  if (!order || !order.paid) throw new Error('conteúdo bloqueado até o pagamento');
  const c = cases.get(order.caseId);
  return { input: c.input, diagnosis: c.diagnosis, items: order.items, generated: { scripts: { status: 'unavailable', content: null }, letters: { status: 'unavailable', content: null } } };
}

export async function getMe() {
  return { access: null }; // a demonstração estática não guarda nada
}
export async function createAccessLink() {
  throw new Error('indisponível na demonstração');
}
export async function getFeatures() {
  return { email: false, leads: false, subscriptions: false };
}
export async function emailAccessLink() {
  throw new Error('indisponível na demonstração');
}
const notAvailable = () => {
  throw new Error('indisponível na demonstração');
};
export const requestLoginCode = notAvailable;
export const loginWithCode = notAvailable;
export const logout = notAvailable;
export const getAccount = async () => ({ email: '', subscription: null });
export const deleteAccount = notAvailable;
export const createSubscriptionOrder = notAvailable;
export const setSubscriptionCancel = notAvailable;
export const getMonth = notAvailable;
export const addEntries = notAvailable;
export const deleteEntry = notAvailable;
export const setEntryCategory = notAvailable;
export const setLimit = notAvailable;
export const saveGoal = notAvailable;
export const deleteGoal = notAvailable;
export const addGoalContribution = notAvailable;
export const deleteGoalContribution = notAvailable;
export const getCoach = notAvailable;
export const simulateInvestmentApi = notAvailable;

export async function submitLead() {
  throw new Error('indisponível na demonstração');
}
export async function revokeLead() {
  throw new Error('indisponível na demonstração');
}
export async function redeemAccess() {
  throw new Error('indisponível na demonstração');
}

export async function createTranslation() {
  throw new Error('indisponível na demonstração');
}
export async function getTranslation() {
  throw new Error('indisponível na demonstração');
}

export async function unsubscribeEmails() {
  throw new Error('indisponível na demonstração');
}
export async function getCatalog() {
  throw new Error('indisponível na demonstração');
}
export async function trackEvent() {}

export async function submitIncomeInterview() {
  throw new Error('indisponível na demonstração');
}
export async function setIncomeProgress() {
  throw new Error('indisponível na demonstração');
}

export async function deleteCase(caseId) {
  cases.delete(caseId);
  for (const [orderId, order] of orders) if (order.caseId === caseId) orders.delete(orderId);
}
export const getWallets = notAvailable;
export const createWallet = notAvailable;
export const deleteWallet = notAvailable;
export const setEntryWallet = notAvailable;
export const getReminders = notAvailable;
export const createReminder = notAvailable;
export const updateReminder = notAvailable;
export const deleteReminder = notAvailable;
export const getDebts = notAvailable;
export const createDebt = notAvailable;
export const updateDebt = notAvailable;
export const deleteDebt = notAvailable;
export const payDebt = notAvailable;
export const setMonthLimit = notAvailable;
export const copyBudgetMonth = notAvailable;
export const askPlanner = notAvailable;
export const getCoachOverview = notAvailable;
export const startJourney = notAvailable;
export const stopJourney = notAvailable;
export const getMarket = notAvailable;
export const setObjective = notAvailable;
export const getGoalTemplates = notAvailable;
export const getHousehold = notAvailable;
export const inviteHousehold = notAvailable;
export const removeHouseholdMember = notAvailable;
export const acceptHousehold = notAvailable;
export const leaveHousehold = notAvailable;
export const createCheckout = notAvailable;
export const getExport = notAvailable;
export const downloadExportXlsx = notAvailable;
export const updateProfile = notAvailable;
