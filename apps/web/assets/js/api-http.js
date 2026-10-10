// Cliente HTTP do back-end real (apps/api). O resultado completo só chega depois do pagamento confirmado.
import { API_BASE } from '../config.js';
import { turnstileHeaders } from './turnstile.js';

class ApiError extends Error {
  constructor(message, status, code, issues) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

let siteKeyP = null;
/** Chave pública do Turnstile (null = desligado). Uma consulta só por carregamento da página. */
function turnstileKey() {
  siteKeyP ??= fetch(`${API_BASE}/features`, { credentials: 'same-origin', headers: { 'x-folego': '1' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => j?.turnstileSiteKey ?? null)
    .catch(() => null);
  return siteKeyP;
}
const guard = async () => turnstileHeaders(await turnstileKey());

async function request(method, path, { body, headers } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.message ?? 'Erro na requisição', res.status, json?.error, json?.issues);
  return json;
}

export async function createCase(input) {
  // O servidor define "hoje" e os ids; o cliente manda só o que o usuário informou + o aceite dos termos.
  const debts = input.debts.map(({ id, ...debt }) => debt);
  return request('POST', '/cases', { body: { profile: input.profile, debts, acceptTerms: true }, headers: await guard() });
}

/** fbc do clique no anúncio (se houve), para a Meta atribuir a conversão. */
const storedFbc = () => {
  try {
    return localStorage.getItem('folego_fbc') || undefined;
  } catch {
    return undefined;
  }
};

export async function createOrder({ caseId, products, contact }) {
  return request('POST', '/orders', { body: { caseId, products, ...(contact ? { contact: { ...contact, ...(storedFbc() ? { fbc: storedFbc() } : {}) } } : {}) }, headers: { 'idempotency-key': crypto.randomUUID() } });
}

/** Já pagou neste navegador? O cookie de sessão diz; assim o Mapa reabre sem cadastro. */
export async function getMe() {
  return request('GET', '/me');
}

/** Link para voltar ao Mapa em outro aparelho (só o hash fica no servidor). */
export async function createAccessLink(orderId) {
  return request('POST', `/orders/${orderId}/access-link`, { body: {} });
}

export async function getFeatures() {
  return request('GET', '/features');
}

export async function emailAccessLink(orderId, email) {
  return request('POST', `/orders/${orderId}/email-link`, { body: { email }, headers: await guard() });
}

export async function requestLoginCode(email) {
  return request('POST', '/account/login-code', { body: { email }, headers: await guard() });
}
export async function loginWithPassword(email, password) {
  return request('POST', '/account/login-password', { body: { email, password } });
}
export async function loginWithCode(email, code) {
  return request('POST', '/account/login', { body: { email, code } });
}
export async function logout() {
  return request('POST', '/account/logout', { body: {} });
}
export async function getAccount() {
  return request('GET', '/account');
}
export async function deleteAccount() {
  return request('DELETE', '/account');
}
export async function createSubscriptionOrder(plan) {
  return request('POST', '/account/subscription-order', { body: { plan }, headers: { 'idempotency-key': crypto.randomUUID() } });
}
export async function setSubscriptionCancel(cancel) {
  return request('POST', '/account/subscription-cancel', { body: { cancel } });
}
export async function getMonth(month) {
  return request('GET', `/account/month/${month}`);
}
export async function addEntries(entries) {
  return request('POST', '/account/entries', { body: { entries } });
}
export async function deleteEntry(id) {
  return request('DELETE', `/account/entries/${id}`);
}
export async function setEntryCategory(id, category) {
  return request('POST', `/account/entries/${id}/category`, { body: { category } });
}
/** Categorias próprias (além das 10 do sistema): criar e apagar (os lançamentos dela vão para "Outros"). */
export async function getCategories() {
  return request('GET', '/account/categories');
}
export async function createCategory(name) {
  return request('POST', '/account/categories', { body: { name } });
}
export async function deleteCategory(name) {
  return request('POST', '/account/categories/remove', { body: { name } });
}
export async function setLimit(category, limitCents) {
  return request('POST', `/account/limits/${encodeURIComponent(category)}`, { body: { limitCents } });
}
export async function saveGoal(goal) {
  return request('POST', '/account/goals', { body: goal });
}
export async function addGoalContribution(goalId, body) {
  return request('POST', `/account/goals/${goalId}/contributions`, { body });
}
export async function deleteGoalContribution(goalId, contributionId) {
  return request('DELETE', `/account/goals/${goalId}/contributions/${contributionId}`);
}
export async function deleteGoal(id) {
  return request('DELETE', `/account/goals/${id}`);
}
export async function getCoach() {
  return request('GET', '/account/coach');
}
export async function simulateInvestmentApi(input) {
  return request('POST', '/account/simulate', { body: input });
}

export async function getLeadState(caseId) {
  return request('GET', `/cases/${caseId}/leads`);
}

export async function submitLead(caseId, body) {
  return request('POST', `/cases/${caseId}/leads`, { body });
}

export async function revokeLead(caseId) {
  return request('DELETE', `/cases/${caseId}/leads`);
}

export async function redeemAccess(token) {
  return request('POST', '/access', { body: { token } });
}

export async function createTranslation(text) {
  return request('POST', '/translations', { body: { text, acceptTerms: true } });
}

export async function getTranslation(orderId) {
  return request('GET', `/orders/${orderId}/translation`);
}

export async function getOrderStatus(orderId) {
  return request('GET', `/orders/${orderId}`);
}

/** Só existe no servidor de desenvolvimento (gateway de mentira). Em produção a rota não existe. */
export async function demoConfirmPayment(orderId) {
  return request('POST', `/dev/pay/${orderId}`, { body: {} });
}

export async function getDelivery(orderId) {
  return request('GET', `/orders/${orderId}/delivery`);
}

export async function deleteCase(caseId) {
  return request('DELETE', `/cases/${caseId}`);
}

/** Preços, produtos à venda e avisos (o dono edita no backoffice). */
export async function unsubscribeEmails(token) {
  return request('POST', '/unsubscribe', { body: { token } });
}

export async function getCatalog() {
  return request('GET', '/catalog');
}

/** Evento de navegação anônimo (funil e jornada). */
export async function trackEvent(body) {
  return request('POST', '/events', { body });
}

export async function submitIncomeInterview(caseId, body) {
  return request('POST', `/cases/${caseId}/income-interview`, { body });
}

export async function setIncomeProgress(caseId, key, done) {
  return request('POST', `/cases/${caseId}/income-progress`, { body: { key, done } });
}
export async function getWallets() {
  return request('GET', '/account/wallets');
}
export async function createWallet(body) {
  return request('POST', '/account/wallets', { body });
}
export async function updateWallet(id, body) {
  return request('PUT', `/account/wallets/${id}`, { body });
}
export async function deleteWallet(id) {
  return request('DELETE', `/account/wallets/${id}`);
}
export async function setEntryWallet(id, walletId) {
  return request('POST', `/account/entries/${id}/wallet`, { body: { walletId } });
}
export async function getReminders() {
  return request('GET', '/account/reminders');
}
export async function createReminder(body) {
  return request('POST', '/account/reminders', { body });
}
export async function updateReminder(id, body) {
  return request('PUT', `/account/reminders/${id}`, { body });
}
export async function deleteReminder(id) {
  return request('DELETE', `/account/reminders/${id}`);
}
// Cartões de crédito (Ousado e Desbravador)
export async function getCards() {
  return request('GET', '/account/cards');
}
export async function createCard(body) {
  return request('POST', '/account/cards', { body });
}
export async function updateCard(id, body) {
  return request('PUT', `/account/cards/${id}`, { body });
}
export async function deleteCard(id) {
  return request('DELETE', `/account/cards/${id}`);
}
export async function addCardPurchase(id, body) {
  return request('POST', `/account/cards/${id}/purchases`, { body });
}
export async function cancelCardInstallments(id, planId) {
  return request('DELETE', `/account/cards/${id}/installments/${planId}`);
}
export async function addCardPayment(id, body) {
  return request('POST', `/account/cards/${id}/payments`, { body });
}
export async function deleteCardPayment(id, paymentId) {
  return request('DELETE', `/account/cards/${id}/payments/${paymentId}`);
}
export async function getCardInvoice(id, key) {
  return request('GET', `/account/cards/${id}/invoices/${key}`);
}
export async function getCardRevolving(id, fixedCents = 0) {
  return request('GET', `/account/cards/${id}/revolving?fixed=${Math.max(0, Math.round(fixedCents))}`);
}
export async function importCardInvoice(id, body) {
  return request('POST', `/account/cards/${id}/import`, { body });
}
/** Mapa da Virada para quem assina: oferta do Ousado, uso incluso do Desbravador ou o Mapa já ativo. */
export async function getMapOffer() {
  return request('GET', '/account/map-offer');
}
export async function getDebts(extraCents = 0) {
  return request('GET', `/account/debts?extra=${Math.max(0, Math.round(extraCents))}`);
}
export async function createDebt(body) {
  return request('POST', '/account/debts', { body });
}
export async function updateDebt(id, body) {
  return request('PUT', `/account/debts/${id}`, { body });
}
export async function deleteDebt(id) {
  return request('DELETE', `/account/debts/${id}`);
}
export async function payDebt(id, body) {
  return request('POST', `/account/debts/${id}/payments`, { body });
}
export async function setMonthLimit(month, category, limitCents) {
  return request('POST', `/account/budget/${month}/limits/${encodeURIComponent(category)}`, { body: { limitCents } });
}
export async function copyBudgetMonth(month) {
  return request('POST', `/account/budget/${month}/copy`);
}
export async function askPlanner(question) {
  return request('POST', '/account/planner', { body: { question } });
}
export async function getCoachOverview() {
  return request('GET', '/account/coach/overview');
}
export async function startJourney(id) {
  return request('POST', `/account/coach/journeys/${id}/start`);
}
export async function stopJourney(id) {
  return request('DELETE', `/account/coach/journeys/${id}`);
}
export async function getMarket() {
  return request('GET', '/account/market');
}
export async function setObjective(objective) {
  return request('POST', '/account/coach/objective', { body: { objective } });
}
export async function getGoalTemplates() {
  return request('GET', '/account/goal-templates');
}
export async function getHousehold() {
  return request('GET', '/account/household');
}
export async function inviteHousehold(email) {
  return request('POST', '/account/household/invite', { body: { email } });
}
export async function removeHouseholdMember() {
  return request('DELETE', '/account/household/member');
}
export async function acceptHousehold() {
  return request('POST', '/account/household/accept');
}
export async function leaveHousehold() {
  return request('POST', '/account/household/leave');
}
export async function createCheckout(plan, data = {}) {
  let referralCode;
  try {
    referralCode = localStorage.getItem('folego_ind') || undefined;
  } catch {
    referralCode = undefined;
  }
  return request('POST', '/account/subscription-checkout', { body: { plan, acceptTerms: true, ...(data.cpf ? { cpf: data.cpf } : {}), ...(data.name ? { name: data.name } : {}), ...(storedFbc() ? { fbc: storedFbc() } : {}), ...(data.phone ? { phone: data.phone } : {}), ...(referralCode && /^[a-z0-9]{8}$/.test(referralCode) ? { referralCode } : {}) } });
}
export async function getExport() {
  return request('GET', '/account/export');
}
export async function downloadExportXlsx() {
  const res = await fetch(`${API_BASE}/account/export.xlsx`, { credentials: 'same-origin', headers: { 'x-folego': '1' } });
  if (!res.ok) throw new ApiError('Não foi possível gerar a planilha', res.status);
  return res.blob();
}
export async function updateProfile(body) {
  return request('PUT', '/account/profile', { body });
}
export async function inviteLeadFriend({ friendEmail, yourName }) {
  return request('POST', '/referrals/lead', { body: { friendEmail, yourName } });
}
export async function getReferrals() {
  return request('GET', '/account/referrals');
}
export async function inviteSubscriberFriend({ friendEmail }) {
  return request('POST', '/account/referrals', { body: { email: friendEmail } });
}
export async function getRecurring() {
  return request('GET', '/account/recurring');
}
export async function setRecurringDecision(key, status) {
  return request('PUT', `/account/recurring/${encodeURIComponent(key)}`, { body: { status } });
}
export async function getScenarioBase() {
  return request('GET', '/account/scenario-base');
}

export async function createGuided(kind, input) {
  return request('POST', `/guided/${kind}`, { body: { input, acceptTerms: true } });
}
export async function getGuided(orderId) {
  return request('GET', `/orders/${orderId}/guided`);
}

// Refazer com novos dados dentro do prazo de acesso (não cobra de novo e não muda a data final).
export async function redoMap(orderId, input) {
  // Como no createCase: o servidor define "hoje" e os ids; o cliente manda só o que a pessoa informou.
  const debts = input.debts.map(({ id, ...debt }) => debt);
  return request('POST', `/orders/${orderId}/redo/map`, { body: { profile: input.profile, debts } });
}
export async function redoTranslation(orderId, text) {
  return request('POST', `/orders/${orderId}/redo/translation`, { body: { text } });
}
export async function redoGuided(orderId, input) {
  return request('POST', `/orders/${orderId}/redo/guided`, { body: { input } });
}

export async function getOpenFinance() {
  return request('GET', '/account/openfinance');
}
export async function ofConnectToken() {
  return request('POST', '/account/openfinance/connect-token', { body: {} });
}
export async function ofAddConnection(itemId) {
  return request('POST', '/account/openfinance/connections', { body: { itemId, acceptConsent: true } });
}
export async function ofSync(id) {
  return request('POST', `/account/openfinance/connections/${id}/sync`, { body: {} });
}
export async function ofReconnectToken(id) {
  return request('POST', `/account/openfinance/connections/${id}/reconnect-token`, { body: {} });
}
export async function ofRefresh(id) {
  return request('POST', `/account/openfinance/connections/${id}/refresh`, { body: {} });
}
export async function ofRevoke(id) {
  return request('DELETE', `/account/openfinance/connections/${id}`);
}
