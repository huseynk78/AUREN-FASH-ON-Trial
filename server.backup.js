'use strict';

// Zero-dependency app: Node's built-in HTTP server and SQLite are sufficient.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

loadEnv(path.join(__dirname, '.env'));
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD || ADMIN_PASSWORD === 'change-this-to-a-long-private-password') {
  console.error('ADMIN_PASSWORD must be set in a private .env file. See .env.example.');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'shop.sqlite'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
setupDatabase();

const sessions = new Map();
const VALID_STATUSES = ['new', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
const NOTIFIABLE_STATUSES = new Set(['confirmed', 'shipped', 'delivered', 'cancelled']);
const STATUS_LABELS = {
  new: 'Yeni', confirmed: 'Təsdiqləndi', processing: 'Hazırlanır',
  shipped: 'Göndərildi', delivered: 'Çatdırıldı', cancelled: 'Ləğv edildi'
};

// Replace this single adapter later to deliver SMS/WhatsApp messages.
const NotificationService = {
  record(orderId, status) {
    if (!NOTIFIABLE_STATUSES.has(status)) return null;
    const order = db.prepare('SELECT id, customer_name, phone FROM orders WHERE id = ?').get(orderId);
    const text = `Bildiriş göndəriləcək: sifariş #${order.id} → ${STATUS_LABELS[status]}`;
    db.prepare(`INSERT INTO notifications (order_id, status, channel, state, message, created_at)
      VALUES (?, ?, 'future-channel', 'recorded', ?, ?)`)
      .run(orderId, status, text, now());
    return text;
  }
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const route = url.pathname;

    if (req.method === 'GET' && route === '/') return customerForm(req, res);
    if (req.method === 'POST' && route === '/orders') return createOrder(req, res);
    if (req.method === 'GET' && route === '/thank-you') return thankYou(req, res, url);
    if (req.method === 'GET' && route === '/health') return sendText(res, 200, 'ok');
    if (req.method === 'GET' && route === '/styles.css') return staticFile(res, 'styles.css', 'text/css; charset=utf-8');

    if (req.method === 'GET' && route === '/admin/login') return loginForm(req, res, url);
    if (req.method === 'POST' && route === '/admin/login') return login(req, res);

    const session = requireAdmin(req, res);
    if (!session) return;
    if (req.method === 'POST' && route === '/admin/logout') return logout(req, res, session);
    if (req.method === 'GET' && route === '/admin') return adminOrders(req, res, url, session);
    if (req.method === 'POST' && /^\/admin\/orders\/\d+\/status$/.test(route)) return updateOrderStatus(req, res, route, session);
    if (req.method === 'GET' && route === '/admin/products') return productsPage(req, res, url, session);
    if (req.method === 'POST' && route === '/admin/products') return saveProduct(req, res, session);
    if (req.method === 'POST' && /^\/admin\/products\/\d+\/toggle$/.test(route)) return toggleProduct(req, res, route, session);
    if (req.method === 'GET' && route === '/admin/settings') return settingsPage(req, res, url, session);
    if (req.method === 'POST' && route === '/admin/settings') return saveSettings(req, res, session);
    if (req.method === 'GET' && route === '/admin/export.xls') return exportOrders(req, res);

    return notFound(res);
  } catch (error) {
    console.error(error);
    return sendHtml(res, 500, page('Xəta', '<main class="container"><h1>Gözlənilməyən xəta</h1><p>Zəhmət olmasa yenidən cəhd edin.</p></main>'));
  }
});

server.listen(PORT, () => console.log(`Order manager is running at http://localhost:${PORT}`));

function setupDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_azn REAL NOT NULL CHECK(price_azn >= 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new', total_azn REAL NOT NULL,
      exchange_rate REAL NOT NULL, total_usd REAL NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER, product_name TEXT NOT NULL, unit_price_azn REAL NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0), line_total_azn REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
      old_status TEXT, new_status TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
      status TEXT NOT NULL, channel TEXT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_customer_name ON orders(customer_name);
    CREATE INDEX IF NOT EXISTS orders_phone ON orders(phone);
    CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS notifications_order_id ON notifications(order_id);
  `);
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'exchange_rate'").get();
  if (!setting) db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run('exchange_rate', '1.70', now());
  const row = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  if (row.count === 0) {
    const insert = db.prepare('INSERT INTO products (name, description, price_azn, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)');
    const timestamp = now();
    insert.run('Klassik köynək', 'Rahat, gündəlik model', 35, timestamp, timestamp);
    insert.run('Oversize huddi', 'Uniseks, yumşaq parça', 55, timestamp, timestamp);
    insert.run('Cins şalvar', 'Düz kəsim', 65, timestamp, timestamp);
    insert.run('Canvas çanta', 'Gündəlik parça çanta', 18, timestamp, timestamp);
  }
}

function customerForm(req, res) {
  const products = db.prepare('SELECT id, name, description, price_azn FROM products WHERE is_active = 1 ORDER BY name').all();
  const rate = exchangeRate();
  if (products.length === 0) return sendHtml(res, 200, page('Məhsullar', '<main class="container"><h1>Tezliklə</h1><p>Hazırda sifariş üçün məhsul yoxdur.</p></main>'));
  const productData = JSON.stringify(products).replace(/</g, '\\u003c');
  const content = `<main class="container customer-page">
    <section class="hero"><p class="eyebrow">ONLAYN SİFARİŞ</p><h1>Sifarişinizi asanlıqla verin</h1><p>Hesab yaratmağa ehtiyac yoxdur. Məlumatlarınız yalnız sifarişiniz üçün istifadə olunur.</p></section>
    <form class="card order-form" method="post" action="/orders" id="order-form">
      <h2>Məhsullar</h2><div id="item-rows"></div>
      <button class="button secondary" type="button" id="add-item">+ Başqa məhsul əlavə et</button>
      <div class="totals"><span>Cəmi</span><strong id="total-azn">0.00 AZN</strong><small id="total-usd">$0.00 USD</small></div>
      <h2>Çatdırılma məlumatları</h2>
      <label>Ad və soyad<input name="customer_name" required maxlength="100" autocomplete="name"></label>
      <label>Telefon nömrəsi<input name="phone" required maxlength="30" inputmode="tel" autocomplete="tel" placeholder="050 123 45 67"></label>
      <label>Ünvan<textarea name="address" required maxlength="500" autocomplete="street-address" rows="3" placeholder="Şəhər, küçə, bina/mənzil"></textarea></label>
      <input type="hidden" name="items" id="items-input">
      <button class="button primary submit" type="submit">Sifarişi təsdiqlə</button>
      <p class="fine-print">Qiymətlər AZN ilədir. USD məbləği 1 USD = ${formatNumber(rate)} AZN məzənnəsi ilə hesablanır.</p>
    </form>
  </main>
  <script>const PRODUCTS=${productData}; const RATE=${rate};
  const rows=document.querySelector('#item-rows'), itemsInput=document.querySelector('#items-input');
  const money=n=>Number(n).toFixed(2); const product=id=>PRODUCTS.find(p=>p.id===Number(id));
  function row(){const el=document.createElement('div'); el.className='item-row';
    const select=document.createElement('select'); select.className='product-select'; select.setAttribute('aria-label','Məhsul');
    PRODUCTS.forEach(p=>{const o=document.createElement('option'); o.value=p.id; o.textContent=p.name+' — '+money(p.price_azn)+' AZN'; select.appendChild(o)});
    const qty=document.createElement('input'); qty.className='qty-input'; qty.type='number'; qty.min='1'; qty.max='99'; qty.value='1'; qty.setAttribute('aria-label','Miqdar');
    const price=document.createElement('span'); price.className='line-price'; const remove=document.createElement('button'); remove.type='button'; remove.className='icon-button'; remove.textContent='Sil';
    el.append(select,qty,price,remove); const update=()=>{const p=product(select.value); price.textContent=money(p.price_azn*Number(qty.value||0))+' AZN'; calculate()}; select.addEventListener('change',update); qty.addEventListener('input',update);
    remove.addEventListener('click',()=>{if(rows.children.length>1){el.remove();calculate()}}); rows.appendChild(el); update(); }
  function calculate(){let sum=0, orderItems=[]; rows.querySelectorAll('.item-row').forEach(el=>{const id=el.querySelector('.product-select').value, quantity=Math.max(1,Math.min(99,Number(el.querySelector('.qty-input').value)||1)), p=product(id); sum+=p.price_azn*quantity; orderItems.push({productId:p.id,quantity})}); document.querySelector('#total-azn').textContent=money(sum)+' AZN'; document.querySelector('#total-usd').textContent='$'+money(sum/RATE)+' USD'; itemsInput.value=JSON.stringify(orderItems)}
  document.querySelector('#add-item').addEventListener('click',row); document.querySelector('#order-form').addEventListener('submit',calculate); row();
  </script>`;
  return sendHtml(res, 200, page('Sifariş ver', content));
}

async function createOrder(req, res) {
  const body = await readBody(req);
  const name = clean(body.customer_name, 100); const phone = clean(body.phone, 30); const address = clean(body.address, 500);
  let requestedItems;
  try { requestedItems = JSON.parse(body.items || '[]'); } catch { requestedItems = []; }
  if (!name || !phone || !address || !Array.isArray(requestedItems) || requestedItems.length < 1 || requestedItems.length > 10) {
    return sendHtml(res, 400, errorPage('Sifarişi yoxlayın', 'Bütün məlumatları və ən az bir məhsulu daxil edin.'));
  }
  const chosen = [];
  for (const item of requestedItems) {
    const id = Number(item.productId), quantity = Number(item.quantity);
    if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return sendHtml(res, 400, errorPage('Yanlış miqdar', 'Miqdar 1–99 arasında olmalıdır.'));
    const product = db.prepare('SELECT id, name, price_azn FROM products WHERE id = ? AND is_active = 1').get(id);
    if (!product) return sendHtml(res, 400, errorPage('Məhsul artıq yoxdur', 'Seçdiyiniz məhsullardan biri artıq aktiv deyil. Səhifəni yeniləyib yenidən cəhd edin.'));
    chosen.push({ product, quantity });
  }
  const total = chosen.reduce((sum, item) => sum + item.product.price_azn * item.quantity, 0);
  const rate = exchangeRate(); const timestamp = now(); let orderId;
  db.exec('BEGIN');
  try {
    const result = db.prepare(`INSERT INTO orders (customer_name, phone, address, status, total_azn, exchange_rate, total_usd, created_at, updated_at)
      VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?)`).run(name, phone, address, total, rate, total / rate, timestamp, timestamp);
    orderId = Number(result.lastInsertRowid);
    const itemInsert = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, unit_price_azn, quantity, line_total_azn) VALUES (?, ?, ?, ?, ?, ?)');
    chosen.forEach(({ product, quantity }) => itemInsert.run(orderId, product.id, product.name, product.price_azn, quantity, product.price_azn * quantity));
    db.prepare('INSERT INTO order_status_history (order_id, old_status, new_status, actor, created_at) VALUES (?, NULL, ?, ?, ?)').run(orderId, 'new', 'customer', timestamp);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  redirect(res, `/thank-you?id=${orderId}`);
}

function thankYou(req, res, url) {
  const id = Number(url.searchParams.get('id'));
  const order = db.prepare('SELECT id, total_azn, total_usd FROM orders WHERE id = ?').get(id);
  if (!order) return notFound(res);
  return sendHtml(res, 200, page('Sifariş qəbul edildi', `<main class="container narrow"><section class="card centered success"><p class="success-mark">✓</p><h1>Sifarişiniz qəbul edildi</h1><p>Sifariş nömrəniz <strong>#${order.id}</strong>-dir.</p><p>Cəmi: <strong>${money(order.total_azn)} AZN</strong> <small>($${money(order.total_usd)} USD)</small></p><p>Sifarişin vəziyyəti dəyişdikdə sizinlə əlaqə saxlanılacaq.</p><a class="button primary" href="/">Yeni sifariş ver</a></section></main>`));
}

function loginForm(req, res, url) {
  const failed = url.searchParams.get('error');
  const message = failed ? '<p class="alert error">Şifrə düzgün deyil.</p>' : '';
  return sendHtml(res, 200, page('Admin giriş', `<main class="container narrow"><form class="card login-form" method="post" action="/admin/login"><p class="eyebrow">MAĞAZA İDARƏETMƏSİ</p><h1>Admin girişi</h1>${message}<label>Şifrə<input type="password" name="password" required autofocus autocomplete="current-password"></label><button class="button primary submit">Daxil ol</button><a class="text-link" href="/">Müştəri səhifəsinə qayıt</a></form></main>`));
}

async function login(req, res) {
  const body = await readBody(req); const supplied = String(body.password || '');
  const valid = supplied.length === ADMIN_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(ADMIN_PASSWORD));
  if (!valid) return redirect(res, '/admin/login?error=1');
  const id = crypto.randomBytes(32).toString('hex'); const csrf = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { csrf, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  res.setHeader('Set-Cookie', `shop_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
  redirect(res, '/admin');
}

function adminOrders(req, res, url, session) {
  const search = clean(url.searchParams.get('q'), 100); const status = url.searchParams.get('status') || '';
  const filters = []; const params = [];
  if (search) { filters.push('(o.customer_name LIKE ? OR o.phone LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (VALID_STATUSES.includes(status)) { filters.push('o.status = ?'); params.push(status); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const orders = db.prepare(`SELECT o.*, (SELECT GROUP_CONCAT(product_name || ' ×' || quantity, ', ') FROM order_items WHERE order_id = o.id) AS items FROM orders o ${where} ORDER BY o.created_at DESC`).all(...params);
  const notifications = db.prepare('SELECT n.*, o.customer_name FROM notifications n JOIN orders o ON o.id=n.order_id ORDER BY n.created_at DESC LIMIT 15').all();
  const statusOptions = ['<option value="">Bütün statuslar</option>', ...VALID_STATUSES.map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`)].join('');
  const orderRows = orders.length ? orders.map(order => `<tr class="status-${order.status}"><td><strong>#${order.id}</strong><br><small>${dateTime(order.created_at)}</small></td><td><strong>${escapeHtml(order.customer_name)}</strong><br><a href="tel:${escapeAttr(order.phone)}">${escapeHtml(order.phone)}</a><br><small>${escapeHtml(order.address)}</small></td><td>${escapeHtml(order.items || '')}</td><td><strong>${money(order.total_azn)} AZN</strong><br><small>$${money(order.total_usd)}</small></td><td><form method="post" action="/admin/orders/${order.id}/status" class="inline-form"><input type="hidden" name="csrf" value="${session.csrf}"><select name="status">${VALID_STATUSES.map(s => `<option value="${s}" ${order.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select><button class="button small">Yadda saxla</button></form></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Bu filtrə uyğun sifariş yoxdur.</td></tr>';
  const notificationRows = notifications.length ? notifications.map(n => `<li><strong>#${n.order_id}</strong> — ${escapeHtml(n.message)}<br><small>${dateTime(n.created_at)} · ${escapeHtml(n.state)}</small></li>`).join('') : '<li class="empty">Hələ bildiriş qeydi yoxdur.</li>';
  const content = adminLayout('Sifarişlər', 'orders', `<section class="toolbar"><form method="get" action="/admin" class="filters"><input name="q" value="${escapeAttr(search)}" placeholder="Ad və ya telefonla axtar"><select name="status">${statusOptions}</select><button class="button small">Axtar</button><a class="button small secondary" href="/admin">Təmizlə</a></form><a class="button secondary" href="/admin/export.xls">Excel üçün yüklə</a></section><section class="table-wrap"><table><thead><tr><th>Sifariş</th><th>Müştəri</th><th>Məhsullar</th><th>Məbləğ</th><th>Status</th></tr></thead><tbody>${orderRows}</tbody></table></section><section class="card notifications"><h2>Bildiriş hadisələri</h2><p class="muted">Trial versiyada SMS/WhatsApp göndərilmir; aşağıdakı qeydlər gələcək kanal üçün hazır hadisələrdir.</p><ul class="notification-list">${notificationRows}</ul></section>`, session);
  sendHtml(res, 200, page('Admin · Sifarişlər', content));
}

async function updateOrderStatus(req, res, route, session) {
  const body = await readBody(req); if (!validCsrf(body, session)) return forbidden(res);
  const id = Number(route.split('/')[3]); const next = String(body.status || '');
  if (!VALID_STATUSES.includes(next)) return sendHtml(res, 400, errorPage('Yanlış status', 'Bu status tanınmır.'));
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(id); if (!order) return notFound(res);
  if (order.status !== next) {
    const timestamp = now(); db.exec('BEGIN');
    try {
      db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(next, timestamp, id);
      db.prepare('INSERT INTO order_status_history (order_id, old_status, new_status, actor, created_at) VALUES (?, ?, ?, ?, ?)').run(id, order.status, next, 'admin', timestamp);
      NotificationService.record(id, next); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  redirect(res, '/admin');
}

function productsPage(req, res, url, session) {
  const editing = Number(url.searchParams.get('edit'));
  const current = editing ? db.prepare('SELECT * FROM products WHERE id = ?').get(editing) : null;
  const products = db.prepare('SELECT * FROM products ORDER BY is_active DESC, name').all();
  const rows = products.map(p => `<tr><td>${escapeHtml(p.name)}<br><small>${escapeHtml(p.description)}</small></td><td>${money(p.price_azn)} AZN</td><td><span class="badge ${p.is_active ? 'active' : 'inactive'}">${p.is_active ? 'Aktiv' : 'Gizli'}</span></td><td><a class="text-link" href="/admin/products?edit=${p.id}">Dəyiş</a><form method="post" action="/admin/products/${p.id}/toggle" class="inline-form"><input type="hidden" name="csrf" value="${session.csrf}"><button class="link-button">${p.is_active ? 'Gizlət' : 'Aktiv et'}</button></form></td></tr>`).join('');
  const formTitle = current ? 'Məhsulu dəyiş' : 'Yeni məhsul';
  const content = adminLayout('Məhsullar', 'products', `<div class="two-column"><section class="card"><h2>${formTitle}</h2><form method="post" action="/admin/products"><input type="hidden" name="csrf" value="${session.csrf}"><input type="hidden" name="id" value="${current ? current.id : ''}"><label>Məhsul adı<input name="name" required maxlength="100" value="${escapeAttr(current ? current.name : '')}"></label><label>Açıqlama<textarea name="description" maxlength="300" rows="3">${escapeHtml(current ? current.description : '')}</textarea></label><label>Qiymət (AZN)<input name="price_azn" type="number" min="0" step="0.01" required value="${current ? escapeAttr(current.price_azn) : ''}"></label><button class="button primary submit">${current ? 'Dəyişiklikləri yadda saxla' : 'Məhsul əlavə et'}</button>${current ? '<a class="text-link" href="/admin/products">Ləğv et</a>' : ''}</form></section><section class="table-wrap"><table><thead><tr><th>Məhsul</th><th>Qiymət</th><th>Görünürlük</th><th></th></tr></thead><tbody>${rows}</tbody></table></section></div>`, session);
  sendHtml(res, 200, page('Admin · Məhsullar', content));
}

async function saveProduct(req, res, session) {
  const body = await readBody(req); if (!validCsrf(body, session)) return forbidden(res);
  const id = Number(body.id); const name = clean(body.name, 100); const description = clean(body.description, 300); const price = Number(body.price_azn);
  if (!name || !Number.isFinite(price) || price < 0) return sendHtml(res, 400, errorPage('Məhsulu yoxlayın', 'Ad və düzgün, mənfi olmayan qiymət daxil edin.'));
  const timestamp = now();
  if (id) { const product = db.prepare('SELECT id FROM products WHERE id = ?').get(id); if (!product) return notFound(res); db.prepare('UPDATE products SET name=?, description=?, price_azn=?, updated_at=? WHERE id=?').run(name, description, price, timestamp, id); }
  else db.prepare('INSERT INTO products (name, description, price_azn, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(name, description, price, timestamp, timestamp);
  redirect(res, '/admin/products');
}

async function toggleProduct(req, res, route, session) {
  const body = await readBody(req); if (!validCsrf(body, session)) return forbidden(res);
  const id = Number(route.split('/')[3]); const p = db.prepare('SELECT is_active FROM products WHERE id=?').get(id); if (!p) return notFound(res);
  db.prepare('UPDATE products SET is_active=?, updated_at=? WHERE id=?').run(p.is_active ? 0 : 1, now(), id); redirect(res, '/admin/products');
}

function settingsPage(req, res, url, session) {
  const saved = url.searchParams.get('saved'); const rate = exchangeRate();
  const notice = saved ? '<p class="alert success-alert">Məzənnə yadda saxlanıldı.</p>' : '';
  const content = adminLayout('Ayarlar', 'settings', `<section class="card settings-card"><h2>Məzənnə</h2>${notice}<p class="muted">1 USD üçün AZN məbləği. Müştəri ekranında USD = AZN ÷ məzənnə hesablanır.</p><form method="post" action="/admin/settings"><input type="hidden" name="csrf" value="${session.csrf}"><label>1 USD = neçə AZN?<input name="exchange_rate" type="number" min="0.01" max="100" step="0.01" required value="${escapeAttr(rate)}"></label><button class="button primary submit">Yadda saxla</button></form></section>`, session);
  sendHtml(res, 200, page('Admin · Ayarlar', content));
}

async function saveSettings(req, res, session) {
  const body = await readBody(req); if (!validCsrf(body, session)) return forbidden(res);
  const rate = Number(body.exchange_rate); if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return sendHtml(res, 400, errorPage('Məzənnəni yoxlayın', '0.01 ilə 100 arasında düzgün rəqəm yazın.'));
  db.prepare('UPDATE settings SET value=?, updated_at=? WHERE key=?').run(rate.toFixed(2), now(), 'exchange_rate'); redirect(res, '/admin/settings?saved=1');
}

function exportOrders(req, res) {
  const orders = db.prepare(`SELECT o.*, GROUP_CONCAT(oi.product_name || ' x' || oi.quantity, ', ') AS items FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC`).all();
  const header = ['Sifariş #', 'Tarix', 'Müştəri', 'Telefon', 'Ünvan', 'Məhsullar', 'Status', 'AZN', 'USD', 'Sifariş vaxtı məzənnəsi'];
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Sifarişlər"><Table><Row>${header.map(v => xmlCell(v)).join('')}</Row>${orders.map(o => `<Row>${[o.id, dateTime(o.created_at), o.customer_name, o.phone, o.address, o.items || '', STATUS_LABELS[o.status], money(o.total_azn), money(o.total_usd), money(o.exchange_rate)].map(xmlCell).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`;
  res.writeHead(200, { 'Content-Type': 'application/vnd.ms-excel; charset=utf-8', 'Content-Disposition': 'attachment; filename="orders-export.xls"', 'Cache-Control': 'no-store' }); res.end(xml);
}

function adminLayout(title, active, body, session) {
  const nav = [['orders', '/admin', 'Sifarişlər'], ['products', '/admin/products', 'Məhsullar'], ['settings', '/admin/settings', 'Ayarlar']].map(([id, href, label]) => `<a class="${active === id ? 'selected' : ''}" href="${href}">${label}</a>`).join('');
  return `<div class="admin-shell"><header class="admin-header"><a class="brand" href="/admin">Mağaza paneli</a><nav>${nav}</nav><form method="post" action="/admin/logout"><input type="hidden" name="csrf" value="${session.csrf}"><button class="link-button">Çıxış</button></form></header><main class="admin-content"><div class="page-heading"><h1>${title}</h1></div>${body}</main></div>`;
}

function requireAdmin(req, res) {
  const token = parseCookies(req.headers.cookie).shop_session; const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) { if (token) sessions.delete(token); redirect(res, '/admin/login'); return null; }
  return session;
}
async function logout(req, res, session) { const body = await readBody(req); if (!validCsrf(body, session)) return forbidden(res); const token = parseCookies(req.headers.cookie).shop_session; if (token) sessions.delete(token); res.setHeader('Set-Cookie', 'shop_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); redirect(res, '/admin/login'); }
function validCsrf(body, session) {
  const supplied = Buffer.from(String(body.csrf || ''));
  const expected = Buffer.from(session.csrf);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
function exchangeRate() { return Number(db.prepare("SELECT value FROM settings WHERE key = 'exchange_rate'").get().value); }
function now() { return new Date().toISOString(); }
function clean(value, max) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max); }
function money(number) { return Number(number).toFixed(2); }
function formatNumber(number) { return Number(number).toFixed(2); }
function dateTime(iso) { return new Intl.DateTimeFormat('az-AZ', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]); }
function escapeAttr(value) { return escapeHtml(value).replace(/'/g, '&#39;'); }
function xmlCell(value) { return `<Cell><Data ss:Type="String">${escapeHtml(value)}</Data></Cell>`; }
function page(title, body) { return `<!doctype html><html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#24443a"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/styles.css"></head><body>${body}</body></html>`; }
function errorPage(title, message) { return page(title, `<main class="container narrow"><section class="card centered"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="button primary" href="/">Geri qayıt</a></section></main>`); }
function parseCookies(header = '') { return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(v => { const i=v.indexOf('='); return [v.slice(0,i), decodeURIComponent(v.slice(i+1))]; })); }
function readBody(req) { return new Promise((resolve, reject) => { let raw=''; req.on('data', chunk => { raw += chunk; if (raw.length > 100000) { reject(new Error('Request too large')); req.destroy(); } }); req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(raw)))); req.on('error', reject); }); }
function staticFile(res, name, type) { const file = path.join(__dirname, 'public', name); fs.readFile(file, (error, data) => { if (error) return notFound(res); res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' }); res.end(data); }); }
function sendHtml(res, status, html) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); }
function sendText(res, status, text) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); }
function redirect(res, location) { res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }
function forbidden(res) { return sendHtml(res, 403, errorPage('Giriş rədd edildi', 'Təhlükəsizlik yoxlaması alınmadı. Səhifəni yeniləyin.')); }
function notFound(res) { return sendHtml(res, 404, page('Tapılmadı', '<main class="container narrow"><section class="card centered"><h1>Səhifə tapılmadı</h1><a class="button primary" href="/">Ana səhifə</a></section></main>')); }
function loadEnv(file) { if (!fs.existsSync(file)) return; fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => { const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ''); }); }
