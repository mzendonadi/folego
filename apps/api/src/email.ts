// E-mail transacional (só mensagens que a pessoa pediu: link de acesso, código de login, lembretes de assinatura).
// O endereço NUNCA é gravado por causa do link de acesso: é usado para enviar e descartado.
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
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
      body: JSON.stringify({ from: this.cfg.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
      signal: AbortSignal.timeout(10_000),
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
export function layout(title: string, paragraphs: string[], button?: { label: string; url: string }): { text: string; html: string } {
  const text = [title, '', ...paragraphs, ...(button ? ['', `${button.label}: ${button.url}`] : []), '', 'Fôlego · folego.online'].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#12241c;line-height:1.5"><h2 style="margin:0 0 12px">${esc(title)}</h2>${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}${
    button ? `<p><a href="${esc(button.url)}" style="display:inline-block;background:#0b4a3a;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${esc(button.label)}</a></p><p style="font-size:12px;color:#5b6b64">Se o botão não abrir, copie este endereço: ${esc(button.url)}</p>` : ''
  }<p style="font-size:12px;color:#5b6b64">Fôlego · folego.online</p></div>`;
  return { text, html };
}

/** Sender de desenvolvimento: escreve no log do servidor em vez de enviar de verdade. Nunca em produção. */
export class ConsoleSender implements EmailSender {
  readonly name = 'console';
  async send(m: EmailMessage): Promise<void> {
    console.log(`[e-mail simulado] para ${m.to} · ${m.subject}\n${m.text}`);
  }
}
