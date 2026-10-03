// E-mail transacional (só mensagens que a pessoa pediu: link de acesso, código de login, lembretes de assinatura).
// O endereço NUNCA é gravado por causa do link de acesso: é usado para enviar e descartado.
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Cabeçalhos extras (ex.: List-Unsubscribe, que faz Gmail e Outlook mostrarem o botão "cancelar inscrição"). */
  headers?: Record<string, string>;
  /** Arquivos anexados (ex.: o eBook de presente). */
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

export interface EmailConfig {
  provider: 'resend';
  apiKey: string;
  from: string;
}

export class ResendSender implements EmailSender {
  readonly name = 'resend';
  private readonly cfg: EmailConfig;
  private readonly fetchFn: typeof fetch;
  constructor(cfg: EmailConfig, fetchFn: typeof fetch = fetch) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }
  async send(m: EmailMessage): Promise<void> {
    const res = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.cfg.from, to: [m.to], subject: m.subject, text: m.text, html: m.html, ...(m.headers ? { headers: m.headers } : {}), ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType })) } : {}) }),
      signal: AbortSignal.timeout(m.attachments?.length ? 30_000 : 10_000),
    });
    if (!res.ok) throw new Error(`Resend respondeu ${res.status}`);
  }
}

/** Sender de teste: guarda o que "enviou". */
export class MemorySender implements EmailSender {
  readonly name = 'memory';
  sent: EmailMessage[] = [];
  async send(m: EmailMessage): Promise<void> {
    this.sent.push(m);
  }
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Molde simples e legível (sem imagens externas, sem rastreadores). */
export function layout(title: string, paragraphs: string[], button?: { label: string; url: string }, footer?: { unsubscribeUrl: string }): { text: string; html: string } {
  const foot = footer ? `Você recebe este e-mail porque tem uma conta no Fôlego. Para não receber mais mensagens como esta: ${footer.unsubscribeUrl}` : '';
  const text = [title, '', ...paragraphs, ...(button ? ['', `${button.label}: ${button.url}`] : []), '', 'Fôlego · folego.online', ...(foot ? ['', foot] : [])].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#12241c;line-height:1.5"><h2 style="margin:0 0 12px">${esc(title)}</h2>${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}${
    button ? `<p><a href="${esc(button.url)}" style="display:inline-block;background:#0b4a3a;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${esc(button.label)}</a></p><p style="font-size:12px;color:#5b6b64">Se o botão não abrir, copie este endereço: ${esc(button.url)}</p>` : ''
  }<p style="font-size:12px;color:#5b6b64">Fôlego · folego.online</p>${footer ? `<p style="font-size:12px;color:#5b6b64">Você recebe este e-mail porque tem uma conta no Fôlego. <a href="${esc(footer.unsubscribeUrl)}" style="color:#5b6b64">Cancelar o recebimento de mensagens como esta</a>.</p>` : ''}</div>`;
  return { text, html };
}

export interface BrandMail {
  /** Texto que aparece na prévia da caixa de entrada. */
  preheader: string;
  /** Linha pequena acima do título (ex.: "Um presente para você"). */
  kicker?: string;
  title: string;
  /** Parágrafos em texto simples (negrito com **assim**). */
  paragraphs: string[];
  /** Caixa de destaque (lista curta). */
  highlight?: { title: string; items: string[] };
  button?: { label: string; url: string };
  /** Parágrafos finais menores (ex.: aviso, assinatura). */
  closing?: string[];
  /** Link para parar de receber este tipo de mensagem. */
  optOut?: { label: string; url: string };
}

const inline = (t: string) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const stripBold = (t: string) => t.replace(/\*\*([^*]+)\*\*/g, '$1');

/**
 * Molde de marca do Fôlego/Prumo (tabelas e estilos inline: funciona no Gmail, Outlook e celulares).
 * Sem imagens externas nem rastreadores: o "anel" da marca é desenhado com bordas arredondadas.
 */
export function brandLayout(m: BrandMail): { text: string; html: string } {
  const text = [m.title, '', ...m.paragraphs.map(stripBold), ...(m.highlight ? ['', m.highlight.title, ...m.highlight.items.map((i) => `- ${stripBold(i)}`)] : []), ...(m.button ? ['', `${m.button.label}: ${m.button.url}`] : []), ...(m.closing ? ['', ...m.closing.map(stripBold)] : []), '', 'Fôlego · Prumo, o app de finanças do Fôlego · folego.online', ...(m.optOut ? ['', `${m.optOut.label}: ${m.optOut.url}`] : [])].join('\n');
  const green = '#0b4a3a';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.title)}</title></head>
<body style="margin:0;padding:0;background:#f3efe4;font-family:Helvetica,Arial,sans-serif;color:#1d2b25">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(m.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden">
<tr><td style="background:${green};padding:26px 32px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td valign="middle" style="padding-right:12px"><div style="width:30px;height:30px;border:4px solid #ffffff;border-radius:50%;box-sizing:border-box;position:relative"><div style="width:10px;height:10px;background:#c99a2e;border-radius:50%;margin:6px"></div></div></td>
    <td valign="middle" style="font-family:Georgia,'Times New Roman',serif;font-size:28px;color:#ffffff;font-weight:bold;letter-spacing:.5px">fôlego</td>
  </tr></table>
  <div style="font-size:12px;letter-spacing:2px;color:#a9d3c0;margin-top:14px;text-transform:uppercase">${esc(m.kicker ?? 'Respira. Organiza. Avança.')}</div>
</td></tr>
<tr><td style="padding:34px 32px 8px"><h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:${green}">${esc(m.title)}</h1>
${m.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6">${inline(p)}</p>`).join('')}
</td></tr>
${m.highlight ? `<tr><td style="padding:4px 32px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e4f1ea;border-left:5px solid #c99a2e;border-radius:10px"><tr><td style="padding:18px 22px"><div style="font-family:Georgia,serif;font-size:18px;font-weight:bold;color:${green};margin-bottom:8px">${esc(m.highlight.title)}</div>${m.highlight.items.map((i) => `<div style="font-size:15px;line-height:1.55;margin:5px 0;padding-left:16px;position:relative">&#9679;&nbsp;${inline(i)}</div>`).join('')}</td></tr></table></td></tr>` : ''}
${m.button ? `<tr><td align="center" style="padding:22px 32px 6px"><a href="${esc(m.button.url)}" style="display:inline-block;background:${green};color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:15px 30px;border-radius:999px">${esc(m.button.label)}</a><div style="font-size:12px;color:#6b7b73;margin-top:10px">Se o botão não abrir, copie este endereço: ${esc(m.button.url)}</div></td></tr>` : ''}
${m.closing?.length ? `<tr><td style="padding:18px 32px 6px">${m.closing.map((p) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#44544c">${inline(p)}</p>`).join('')}</td></tr>` : ''}
<tr><td style="padding:22px 32px 30px"><div style="border-top:1px solid #dfe5e0;padding-top:16px;font-size:12px;line-height:1.6;color:#6b7b73">Fôlego · Prumo, o app de finanças do Fôlego · <a href="https://folego.online" style="color:#6b7b73">folego.online</a>${m.optOut ? `<br><a href="${esc(m.optOut.url)}" style="color:#6b7b73">${esc(m.optOut.label)}</a>` : ''}</div></td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

/** Sender de desenvolvimento: escreve no log do servidor em vez de enviar de verdade. Nunca em produção. */
export class ConsoleSender implements EmailSender {
  readonly name = 'console';
  async send(m: EmailMessage): Promise<void> {
    console.log(`[e-mail simulado] para ${m.to} · ${m.subject}\n${m.text}`);
  }
}
