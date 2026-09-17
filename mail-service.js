'use strict';

const nodemailer = require('nodemailer');

const LABELS = { new: 'Yeni', paid: 'Ödənildi', confirmed: 'Təsdiqləndi', processing: 'Hazırlanır', shipped: 'Göndərildi', delivered: 'Çatdırıldı', cancelled: 'Ləğv edildi' };
const validEmail = value => typeof value === 'string' && value.length <= 160 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);

function createMailService(db, { env = process.env, transport, clock = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS email_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT NOT NULL UNIQUE,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    submitted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS email_outbox_pending ON email_outbox(state, next_attempt_at);`);
  // A process may have stopped while waiting for Gmail. SMTP is at-least-once,
  // so an ambiguous connection failure can result in a duplicate delivery.
  db.prepare("UPDATE email_outbox SET state='pending' WHERE state='sending'").run();
  const enabled = env.MAIL_ENABLED === 'true';
  const user = String(env.GMAIL_USER || '').trim();
  const pass = String(env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  const configured = enabled && validEmail(user) && Boolean(pass);
  const sender = { name: env.MAIL_FROM_NAME || 'AUREN FASHION', address: user };
  const smtp = configured ? (transport || nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass }, connectionTimeout: 15000, greetingTimeout: 15000,
    socketTimeout: 30000,
  })) : null;
  let running = false;
  let timer;

  function enqueue(orderId, status, eventKey) {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!order) throw new Error('Order missing for notification');
    const items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(orderId);
    const receipt = status === 'new';
    const subject = `AUREN FASHION — Sifariş #${orderId}: ${receipt ? 'qəbul edildi' : LABELS[status] || status}`;
    const body = [
      `Salam, ${order.customer_name}!`, '',
      receipt ? `Sifarişiniz qəbul edildi. Sifariş nömrəsi: #${orderId}.` : `#${orderId} nömrəli sifarişinizin yeni vəziyyəti: ${LABELS[status] || status}.`, '',
      ...items.map(item => `${item.product_name} (${item.selected_size}) × ${item.quantity} — ${Number(item.line_total_azn).toFixed(2)} AZN`), '',
      `Cəmi: ${Number(order.total_azn).toFixed(2)} AZN / ${Number(order.total_usd).toFixed(2)} USD`,
      '', 'Sualınız varsa, bu e-poçta cavab yaza bilərsiniz.', 'AUREN FASHION',
    ].join('\n');
    const recipient = String(order.email || '').trim();
    db.prepare(`INSERT OR IGNORE INTO email_outbox
      (event_key,order_id,recipient,subject,body,state,last_error,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(eventKey, orderId, recipient, subject, body,
        validEmail(recipient) ? 'pending' : 'skipped',
        validEmail(recipient) ? '' : 'missing_email', new Date(clock()).toISOString());
  }

  async function drain() {
    if (!smtp || running) return;
    running = true;
    try {
      const jobs = db.prepare("SELECT * FROM email_outbox WHERE state='pending' AND next_attempt_at<=? ORDER BY id LIMIT 10").all(clock());
      for (const job of jobs) {
        db.prepare("UPDATE email_outbox SET state='sending', attempts=attempts+1 WHERE id=?").run(job.id);
        try {
          const result = await smtp.sendMail({ from: sender, to: job.recipient, replyTo: user,
            subject: job.subject, text: job.body,
            messageId: `<auren-${job.event_key.replace(/[^a-z0-9-]/gi, '-')}-${job.id}@${user.split('@')[1]}>`,
          });
          if (!result.accepted?.length) { const error = new Error('Recipient rejected'); error.code = 'EENVELOPE'; throw error; }
          // Gmail accepting a message does not prove inbox delivery.
          db.prepare("UPDATE email_outbox SET state='submitted', submitted_at=?, last_error='' WHERE id=?")
            .run(new Date(clock()).toISOString(), job.id);
        } catch (error) {
          const attempts = job.attempts + 1;
          const code = ['EAUTH','ECONNECTION','ETIMEDOUT','ESOCKET','EENVELOPE','EMESSAGE'].includes(error.code) ? error.code : 'SEND_FAILED';
          db.prepare("UPDATE email_outbox SET state=?, next_attempt_at=?, last_error=? WHERE id=?")
            .run(attempts >= 5 ? 'failed' : 'pending', clock() + Math.min(3600000, 60000 * 2 ** (attempts - 1)), code, job.id);
        }
      }
    } finally { running = false; }
  }
  function start() {
    if (!smtp || timer) return;
    const tick = () => drain().catch(() => console.error('Email queue processing failed. Check database access.'));
    timer = setInterval(tick, 5000); timer.unref(); tick();
  }
  function stop() { clearInterval(timer); timer = null; }
  function retryFailed() {
    return db.prepare("UPDATE email_outbox SET state='pending',attempts=0,next_attempt_at=0,last_error='' WHERE state='failed'").run().changes;
  }
  return { enqueue, drain, start, stop, retryFailed,
    status: () => ({ enabled, configured, sender: user }),
    recent: () => db.prepare('SELECT id,order_id,recipient,state,attempts,last_error,created_at FROM email_outbox ORDER BY id DESC LIMIT 20').all(),
  };
}

module.exports = { createMailService, validEmail };
