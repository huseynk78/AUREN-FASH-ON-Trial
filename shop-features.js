'use strict';

const crypto = require('node:crypto');
const { buildOrderWorkbook } = require('./order-export');

function createShopFeatures(ctx) {
  const { db, mailService, readBody, validCsrf, sendHtml, page, redirect, forbidden, notFound,
    escapeHtml: h, money, now, dateTime, clean, validEmail, imagesFor, variantsFor,
    imageMarkup, productImagesEditor, saveImage, removeStoredImage, adminLayout,
    exchangeRate, STATUS_LABELS, STATUSES, sessions, parseCookies } = ctx;
  const events = new Set();
  let revision = 0;
  db.exec(`CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS shop_migrations(name TEXT PRIMARY KEY);`);
  function addColumn(table, name, definition) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
  addColumn('products', 'category_id', 'category_id INTEGER REFERENCES categories(id)');
  addColumn('order_items', 'category_name', "category_name TEXT NOT NULL DEFAULT ''");
  addColumn('orders', 'checkout_token', 'checkout_token TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS order_checkout_token ON orders(checkout_token) WHERE checkout_token IS NOT NULL');
  if (!db.prepare("SELECT 1 FROM shop_migrations WHERE name='categories-v1'").get()) {
    db.exec('BEGIN');
    try {
      for (const name of ['Donlar', 'Bluz və köynəklər', 'Ətəklər', 'Şalvarlar', 'Dəstlər', 'Trikotaj', 'Üst geyimləri', 'Tişört və toplar', 'Digər']) db.prepare('INSERT OR IGNORE INTO categories(name) VALUES(?)').run(name);
      db.prepare("UPDATE products SET category_id=(SELECT id FROM categories WHERE name='Digər') WHERE category_id IS NULL").run();
      db.prepare("INSERT INTO shop_migrations(name) VALUES('categories-v1')").run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const categories = () => db.prepare('SELECT * FROM categories ORDER BY name').all();
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const scriptData = data => JSON.stringify(data).replace(/</g, '\\u003c');
  const wantsJson = req => (req.headers.accept || '').includes('application/json');
  const shopHeader = () => '<header class="shop-header"><a href="/" class="shop-logo">AUREN <span>FASHION</span></a><a class="cart-link" href="/checkout">Səbət <b id="cart-count">0</b></a></header>';
  const scripts = () => '<script src="/shop-ui.js" defer></script>';
  const brandError = (res, status, message) => sendHtml(res, status, page('Məlumatları yoxlayın', `${shopHeader()}<main class="receipt-wrap"><section class="receipt-card"><p class="eyebrow">SİFARİŞ</p><h1>Məlumatları yoxlayın</h1><p>${h(message)}</p><a class="button primary" href="/checkout">Səbətə qayıt</a></section></main>${scripts()}`));
  function notify() { revision++; for (const client of events) client.res.write(`event: orders\ndata: ${revision}\n\n`); }
  function subscribe(req, res, session) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: orders\ndata: ${revision}\n\n`);
    const client = { res }; events.add(client);
    const token = parseCookies(req.headers.cookie).shop_session;
    const timer = setInterval(() => {
      if (!sessions.has(token) || session.expiresAt < Date.now()) return res.end();
      res.write(': heartbeat\n\n');
    }, 20000); timer.unref();
    res.on('close', () => { clearInterval(timer); events.delete(client); });
  }
  function normalizeItems(raw) {
    let input; try { input = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new Error('Səbət məlumatları düzgün deyil.'); }
    if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('Səbətə ən az bir məhsul əlavə edin.');
    const combined = new Map();
    for (const item of input) {
      if (!item || typeof item !== 'object') throw new Error('Məhsul məlumatları düzgün deyil.');
      const id = Number(item.productId), size = clean(item.size, 80), quantity = Number(item.quantity);
      if (!Number.isSafeInteger(id) || id < 1 || !size || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9999) throw new Error('Ədəd tam və müsbət rəqəm olmalıdır.');
      const key = JSON.stringify([id, size]);
      const prior = combined.get(key);
      const total = (prior?.quantity || 0) + quantity;
      if (total > 9999) throw new Error('Bir məhsul üçün ən çox 9999 ədəd seçilə bilər.');
      combined.set(key, { productId: id, size, quantity: total });
    }
    return [...combined.values()];
  }
  function quote(raw) {
    const rate = exchangeRate();
    const items = normalizeItems(raw).map(item => {
      const product = db.prepare('SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?').get(item.productId);
      const variant = db.prepare('SELECT stock FROM product_variants WHERE product_id=? AND size=?').get(item.productId, item.size);
      const available = !!(product?.is_active && product.price_azn > 0 && variant);
      const stock = available ? variant.stock : 0;
      const unitPrice = available ? product.price_azn : 0;
      return { ...item, name: product?.name || 'Məhsul mövcud deyil', image: product ? imagesFor(product.id)[0] || product.image_url : '',
        category: product?.category_name || 'Digər', available, stock, unitPrice,
        lineTotal: Math.round(unitPrice * 100) * item.quantity / 100,
        error: !available ? 'Bu məhsul və ya bədən artıq satışda deyil.' : item.quantity > stock ? `Stokda yalnız ${stock} ədəd var. Ədədi azaldın.` : '' };
    });
    const totalAzn = items.reduce((sum, item) => sum + Math.round(item.lineTotal * 100), 0) / 100;
    const signature = crypto.createHash('sha256').update(JSON.stringify({ rate, items: items.map(({productId,size,quantity,unitPrice,available}) => ({productId,size,quantity,unitPrice,available})) })).digest('hex');
    return { items, rate, totalAzn, totalUsd: Math.round(totalAzn / rate * 100) / 100, signature, valid: items.every(item => !item.error) };
  }
  async function cartQuote(req, res) {
    try { const body = await readBody(req); json(res, 200, quote(body.items)); }
    catch (error) { json(res, 400, { error: error.message }); }
  }
  function customerPage(res, url) {
    const categoryId = Number(url?.searchParams.get('category') || 0);
    const products = db.prepare(`SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.is_active=1 AND p.price_azn>0 ${categoryId ? 'AND p.category_id=?' : ''} ORDER BY p.id DESC`).all(...(categoryId ? [categoryId] : []));
    const availableCategories = db.prepare('SELECT c.*,COUNT(p.id) count FROM categories c JOIN products p ON p.category_id=c.id AND p.is_active=1 AND p.price_azn>0 GROUP BY c.id ORDER BY c.name').all();
    const nav = `<nav class="category-nav" aria-label="Məhsul kateqoriyaları"><a class="${!categoryId?'selected':''}" href="/">Hamısı</a>${availableCategories.map(c => `<a class="${categoryId===c.id?'selected':''}" href="/?category=${c.id}">${h(c.name)}</a>`).join('')}</nav>`;
    const cards = products.map(product => { const stock = variantsFor(product.id).reduce((sum,v)=>sum+v.stock,0);return `<a class="store-card" href="/product/${product.id}">${imageMarkup(imagesFor(product.id)[0]||product.image_url,product.name)}<div><span class="product-category">${h(product.category_name||'Digər')}</span><h3>${h(product.name)}</h3><p>${stock?'Stokda var':'Stokda yoxdur'}</p><strong>${money(product.price_azn)} AZN <small class="usd-price">≈ ${money(product.price_azn/exchangeRate())} USD</small></strong></div></a>`; }).join('');
    sendHtml(res,200,page('AUREN FASHION',`${shopHeader()}<main class="shop-main"><section class="shop-hero"><p>SEÇİLMİŞ QADIN KOLLEKSİYASI</p><h1>Zəriflik hər detalda.</h1></section>${nav}<div class="section-title"><h2>${h(availableCategories.find(c=>c.id===categoryId)?.name||'Kolleksiyamız')}</h2><span>${products.length} məhsul</span></div><section class="store-rail">${cards||'<p class="empty-state">Bu kateqoriyada hələ məhsul yoxdur.</p>'}</section><section class="auren-campaign"><img src="/auren-fashion-banner.png" alt="AUREN FASHION kolleksiyası" width="1774" height="887" loading="lazy"></section></main>${scripts()}`));
  }
  function productDetail(res, route) {
    const p=db.prepare('SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=? AND p.is_active=1 AND p.price_azn>0').get(Number(route.split('/')[2]));
    if(!p)return notFound(res);
    const images=imagesFor(p.id),variants=variantsFor(p.id);
    sendHtml(res,200,page(p.name,`${shopHeader()}<main class="detail" data-product-view><a class="back-link" href="/">← Kolleksiyaya qayıt</a><section class="product-detail"><div class="gallery"><div class="gallery-main">${images[0]?`<img id="main-image" src="${h(images[0])}" alt="${h(p.name)}">`:imageMarkup('',p.name)}</div><div class="gallery-thumbs">${images.map((src,i)=>`<button type="button" class="gallery-thumb ${i?'':'active'}" data-image="${h(src)}" aria-label="Şəkil ${i+1}"><img src="${h(src)}" alt=""></button>`).join('')}</div></div><div class="product-info"><p class="eyebrow">${h(p.category_name||'KOLLEKSİYA')}</p><h1>${h(p.name)}</h1><strong class="detail-price" id="detail-price">${money(p.price_azn)} AZN <small class="usd-price">≈ ${money(p.price_azn/exchangeRate())} USD</small></strong><p>${h(p.description)}</p><div><b>Bədən seçin</b><div class="size-choices">${variants.map(v=>`<button type="button" class="size-choice" data-size="${h(v.size)}" data-stock="${v.stock}" ${v.stock?'':'disabled'}>${h(v.size)}</button>`).join('')}</div><small id="stock-note">Bədən seçin</small></div><div class="buy-row"><label>Ədəd<input id="qty" type="number" inputmode="numeric" min="1" step="1" value="1" disabled></label><button type="button" id="add-cart" class="button primary" disabled>Səbətə əlavə et</button></div><p id="product-feedback" class="inline-feedback" role="status" aria-live="polite"></p><a class="text-link" href="/checkout">Səbətə bax →</a></div></section></main><script id="product-data" type="application/json">${scriptData({id:p.id,name:p.name})}</script>${scripts()}`));
  }
  function checkoutPage(res) {
    sendHtml(res,200,page('Səbətim',`${shopHeader()}<main class="checkout premium-checkout"><div class="checkout-heading"><p class="eyebrow">SEÇİMLƏRİNİZ</p><h1>Səbətim</h1><p>Sevdiyiniz parçalar, sizin üçün.</p></div><div class="checkout-layout"><section><div id="cart-notice" class="inline-feedback" role="status" aria-live="polite"></div><div id="cart-items" class="cart-items"><p>Qiymətlər yoxlanılır…</p></div><section class="cart-summary" id="cart-summary" aria-live="polite"><span>Ümumi məbləğ</span><strong id="cart-total-azn">— AZN</strong><small id="cart-total-usd"></small></section><a href="/" class="back-link">← Alış-verişə davam et</a></section><form class="card checkout-form" method="post" action="/checkout" id="checkout-form"><input type="hidden" name="items" id="checkout-items"><input type="hidden" name="quote_signature" id="quote-signature"><input type="hidden" name="checkout_token" value="${crypto.randomBytes(24).toString('hex')}"><p class="eyebrow">SON ADDIM</p><h2>Çatdırılma məlumatları</h2><label>Ad və soyad<input name="customer_name" required maxlength="100" autocomplete="name"></label><label>Telefon nömrəsi<input name="phone" required pattern="[0-9]{7,15}" maxlength="15" inputmode="tel" autocomplete="tel"></label><label>E-poçt ünvanı<input name="email" required type="email" maxlength="160" autocomplete="email" placeholder="ad@example.com"></label><label>Ünvan<textarea name="address" required maxlength="500" rows="3" autocomplete="street-address"></textarea></label><p id="checkout-error" class="inline-feedback error" role="alert"></p><button class="button primary submit" id="checkout-submit" disabled>Sifarişi tamamla</button><p class="checkout-note">Hesab yaratmağa ehtiyac yoxdur. Sifariş məlumatları e-poçtunuza göndəriləcək.</p></form></div></main>${scripts()}`));
  }
  async function checkout(req,res) {
    const body=await readBody(req);
    const fail=(status,message,extra={})=>wantsJson(req)?json(res,status,{error:message,...extra}):brandError(res,status,message);
    const name=clean(body.customer_name,100),phone=clean(body.phone,30),email=clean(body.email,160).toLowerCase(),address=clean(body.address,500);
    if(!name||!/^\d{7,15}$/.test(phone)||!validEmail(email)||!address)return fail(400,'Ad, düzgün telefon, e-poçt və ünvan daxil edin.');
    const token=String(body.checkout_token||'');
    if(token&&!/^[a-f0-9]{48}$/.test(token))return fail(400,'Səhifəni yeniləyib yenidən cəhd edin.');
    const finish=order=>{const location=`/thank-you?receipt=${order.checkout_token}`;return wantsJson(req)?json(res,200,{location,orderId:order.id}):redirect(res,location);};
    if(token){const existing=db.prepare('SELECT id,checkout_token FROM orders WHERE checkout_token=?').get(token);if(existing)return finish(existing);}
    db.exec('BEGIN');
    try {
      const current=quote(body.items);
      if(!current.valid){db.exec('ROLLBACK');return fail(409,current.items.find(item=>item.error).error,{quote:current});}
      if(body.quote_signature&&body.quote_signature!==current.signature){db.exec('ROLLBACK');return fail(409,'Qiymət yeniləndi. Yeni məbləği yoxlayıb sifarişi yenidən təsdiqləyin.',{quote:current});}
      for(const item of current.items){const changed=db.prepare('UPDATE product_variants SET stock=stock-? WHERE product_id=? AND size=? AND stock>=?').run(item.quantity,item.productId,item.size,item.quantity);if(!changed.changes)throw new Error('Stok dəyişdi. Səbəti yeniləyin.');}
      const time=now(),receipt=token||crypto.randomBytes(24).toString('hex');
      const id=Number(db.prepare("INSERT INTO orders(customer_name,phone,email,address,status,total_azn,exchange_rate,total_usd,created_at,updated_at,checkout_token)VALUES(?,?,?,?,'new',?,?,?,?,?,?)").run(name,phone,email,address,current.totalAzn,current.rate,current.totalUsd,time,time,receipt).lastInsertRowid);
      const insert=db.prepare('INSERT INTO order_items(order_id,product_id,product_name,unit_price_azn,quantity,selected_size,line_total_azn,category_name)VALUES(?,?,?,?,?,?,?,?)');
      for(const item of current.items)insert.run(id,item.productId,item.name,item.unitPrice,item.quantity,item.size,item.lineTotal,item.category);
      db.prepare("INSERT INTO order_status_history(order_id,old_status,new_status,actor,created_at)VALUES(?,NULL,'new','customer',?)").run(id,time);
      mailService.enqueue(id,'new',`order-${id}`);db.exec('COMMIT');notify();return finish({id,checkout_token:receipt});
    }catch(error){try{db.exec('ROLLBACK');}catch{}return fail(400,error.message);}
  }
  function thankYou(res,url) {
    const receipt=url.searchParams.get('receipt')||'';
    const order=db.prepare('SELECT id,total_azn,total_usd,email FROM orders WHERE checkout_token=?').get(receipt);
    if(!order)return notFound(res);
    sendHtml(res,200,page('Sifariş qəbul edildi',`${shopHeader()}<main class="receipt-wrap"><section class="receipt-card"><div class="receipt-seal" aria-hidden="true">✓</div><p class="eyebrow">AUREN FASHION</p><h1>Gözəl seçim etdiniz.</h1><p class="receipt-lead">Sifarişiniz qəbul edildi.</p><div class="receipt-reference"><span>Sifariş nömrəsi</span><strong>#${order.id}</strong></div><div class="receipt-total"><span>Ümumi məbləğ</span><strong>${money(order.total_azn)} <small>AZN</small></strong><span>≈ ${money(order.total_usd)} USD</span></div><p class="receipt-note">Sifariş təsdiqi və yeniliklər qeyd etdiyiniz e-poçt ünvanına göndəriləcək.</p><a class="button primary" href="/">Kolleksiyaya qayıt</a><p class="receipt-signature">Zəriflik hər detalda.</p></section></main><script>localStorage.removeItem('shop_cart')</script>${scripts()}`));
  }
  function orderDashboard(url,session) {
    const search=clean(url.searchParams.get('q'),100),status=url.searchParams.get('status')||'';
    let view=url.searchParams.get('view')||'active';if(!['active','delivered','cancelled'].includes(view))view='active';
    const clauses=[view==='active'?"o.status NOT IN ('delivered','cancelled')":'o.status=?'],args=view==='active'?[]:[view];
    if(search){clauses.push('(o.customer_name LIKE ? OR o.phone LIKE ? OR o.email LIKE ?)');args.push(...Array(3).fill(`%${search}%`));}
    if(view==='active'&&STATUSES.includes(status)&&!['delivered','cancelled'].includes(status)){clauses.push('o.status=?');args.push(status);}
    const orders=db.prepare(`SELECT o.* FROM orders o WHERE ${clauses.join(' AND ')} ORDER BY o.created_at DESC,o.id DESC`).all(...args);
    const counts=db.prepare("SELECT count(*) total,COALESCE(SUM(status NOT IN ('delivered','cancelled')),0) active,COALESCE(SUM(status='delivered'),0) delivered,COALESCE(SUM(status='cancelled'),0) cancelled,COALESCE(SUM(status='new'),0) fresh FROM orders").get();
    const viewNames={active:'Aktiv sifarişlər',delivered:'Çatdırılmış',cancelled:'Ləğv edilmiş'};
    const tabs=Object.entries(viewNames).map(([key,label])=>`<a href="/admin?${new URLSearchParams({view:key,...(search?{q:search}:{})})}" class="order-tab ${view===key?'selected':''}" ${view===key?'aria-current="page"':''}>${label}<b>${counts[key]}</b></a>`).join('');
    const cards=orders.map(order=>{
      const items=db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
      return `<article class="order-card" data-order-id="${order.id}"><div class="order-top"><div><span class="order-number">#${String(order.id).padStart(4,'0')}</span><small>${dateTime(order.created_at)}</small></div><span class="status-badge status-${h(order.status)}">${h(STATUS_LABELS[order.status]||order.status)}</span></div><div class="order-details"><div class="order-customer"><h3>${h(order.customer_name)}</h3><a href="tel:${h(order.phone)}">${h(order.phone)}</a>${order.email?`<a class="email-link" href="mailto:${h(order.email)}">${h(order.email)}</a>`:''}<p>${h(order.address)}</p></div><div class="ordered-items">${items.map(item=>`<div><span>${h(item.product_name)}<small>${h(item.selected_size)} · ${item.quantity} ədəd</small></span><b>${money(item.line_total_azn)} AZN</b></div>`).join('')}</div></div><div class="order-footer"><div><small>ÜMUMİ MƏBLƏĞ</small><strong>${money(order.total_azn)} AZN <small>≈ ${money(order.total_usd)} USD</small></strong></div><form method="post" action="/admin/orders/${order.id}/status" data-status-form><input type="hidden" name="csrf" value="${session.csrf}"><label class="sr-only" for="status-${order.id}">Sifariş vəziyyəti</label><select id="status-${order.id}" name="status">${STATUSES.map(s=>`<option value="${s}" ${s===order.status?'selected':''}>${h(STATUS_LABELS[s])}</option>`).join('')}</select><button class="button small primary" type="submit">Yadda saxla</button></form></div></article>`;
    }).join('');
    return `<section class="admin-metrics"><div><span>Yeni sifariş</span><strong>${counts.fresh}</strong><small>Diqqətinizi gözləyir</small></div><div><span>Aktiv sifariş</span><strong>${counts.active}</strong><small>Hazırda davam edir</small></div><div><span>Çatdırılmış</span><strong>${counts.delivered}</strong><small>Tamamlanmış sifarişlər</small></div></section><div class="orders-controls"><nav class="order-tabs" aria-label="Sifariş bölmələri">${tabs}</nav><a class="button secondary export-button" href="/admin/export.xlsx">Excel yüklə <small>.xlsx</small></a></div><form class="filters" data-order-filters><input type="hidden" name="view" value="${view}"><label class="sr-only" for="order-search">Sifariş axtar</label><input id="order-search" name="q" value="${h(search)}" placeholder="Ad, telefon və ya e-poçt ilə axtar…">${view==='active'?`<select name="status" aria-label="Vəziyyət filtri"><option value="">Bütün aktiv statuslar</option>${STATUSES.filter(s=>!['delivered','cancelled'].includes(s)).map(s=>`<option value="${s}" ${s===status?'selected':''}>${h(STATUS_LABELS[s])}</option>`).join('')}</select>`:''}<button class="button secondary">Axtar</button></form><div class="list-heading"><h2>${viewNames[view]}</h2><span>${orders.length} nəticə</span></div><section class="order-list">${cards||'<div class="empty-state"><span>◇</span><h2>Bu bölmədə sifariş yoxdur</h2><p>Yeni sifarişlər burada avtomatik görünəcək.</p></div>'}</section>`;
  }
  function adminOrders(res,url,session) {
    sendHtml(res,200,page('Admin · Sifarişlər',adminLayout('Sifarişlər','orders',`<div class="live-indicator" id="live-status" role="status"><i></i> Bağlantı qurulur…</div><p class="inline-feedback error" id="admin-error" role="alert"></p><div id="orders-dashboard">${orderDashboard(url,session)}</div><script src="/admin-live.js" defer></script>`,session)));
  }
  function orderFragment(res,url,session){json(res,200,{html:orderDashboard(url,session),revision});}
  async function changeStatus(req,res,route,session){
    const body=await readBody(req);if(!validCsrf(body,session))return forbidden(res);
    const id=Number(route.split('/')[3]),next=String(body.status||''),order=db.prepare('SELECT status FROM orders WHERE id=?').get(id);
    if(!order)return notFound(res);if(!STATUSES.includes(next))return json(res,400,{error:'Bu status tanınmır.'});
    if(order.status!==next){db.exec('BEGIN');try{const t=now();db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').run(next,t,id);const history=Number(db.prepare('INSERT INTO order_status_history(order_id,old_status,new_status,actor,created_at)VALUES(?,?,?,?,?)').run(id,order.status,next,'admin',t).lastInsertRowid);mailService.enqueue(id,next,`status-${history}`);db.exec('COMMIT');notify();}catch(error){db.exec('ROLLBACK');throw error;}}
    if(wantsJson(req))return json(res,200,{ok:true});redirect(res,'/admin');
  }
  function productsPage(res,url,session){
    const edit=Number(url.searchParams.get('edit')),current=edit?db.prepare('SELECT * FROM products WHERE id=?').get(edit):null;
    const list=categories(),selected=Number(url.searchParams.get('category')||0),products=db.prepare(`SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ${selected?'WHERE p.category_id=?':''} ORDER BY p.is_active DESC,p.id DESC`).all(...(selected?[selected]:[]));
    const variants=current?variantsFor(current.id):[{size:'S',stock:0},{size:'M',stock:0},{size:'L',stock:0}];
    const options=(chosen)=>list.map(c=>`<option value="${c.id}" ${c.id===chosen?'selected':''}>${h(c.name)}</option>`).join('');
    const cards=products.map(p=>`<article class="product-card">${imageMarkup(imagesFor(p.id)[0]||p.image_url,p.name)}<div class="product-card-body"><div class="product-tags"><span class="badge ${p.is_active?'active':'inactive'}">${p.is_active?'Aktiv':'Gizli'}</span><span class="product-category">${h(p.category_name||'Digər')}</span></div><h3>${h(p.name)}</h3><p>${variantsFor(p.id).map(v=>`${h(v.size)}: ${v.stock}`).join(' · ')}</p><strong>${money(p.price_azn)} AZN <small class="usd-price">≈ ${money(p.price_azn/exchangeRate())} USD</small></strong><div class="product-actions"><a class="button small primary" href="/admin/products?edit=${p.id}">Dəyiş</a><form method="post" action="/admin/products/${p.id}/toggle"><input type="hidden" name="csrf" value="${session.csrf}"><button class="button small secondary">${p.is_active?'Gizlət':'Aktiv et'}</button></form><form method="post" action="/admin/products/${p.id}/delete" onsubmit="return confirm('Məhsul silinsin? Keçmiş sifarişlər qorunacaq.')"><input type="hidden" name="csrf" value="${session.csrf}"><button class="button small danger">Sil</button></form></div></div></article>`).join('');
    sendHtml(res,200,page('Admin · Məhsullar',adminLayout('Məhsullar','products',`<div class="product-admin"><section class="card product-form"><p class="eyebrow">KOLLEKSİYA</p><h2>${current?'Məhsulu yenilə':'Yeni məhsul'}</h2>${current?'<a class="text-link" href="/admin/products">+ Yeni məhsul əlavə et</a>':''}${productImagesEditor(current,session)}<form method="post" enctype="multipart/form-data"><input name="csrf" type="hidden" value="${session.csrf}"><input name="id" type="hidden" value="${current?.id||''}"><label>Məhsulun adı<input name="name" required maxlength="100" value="${h(current?.name||'')}"></label><label>Kateqoriya<select name="category_id" required>${options(current?.category_id||list.find(c=>c.name==='Digər')?.id)}</select></label><label>Açıqlama<textarea name="description" maxlength="300">${h(current?.description||'')}</textarea></label><label>Bədənlər <small>Vergüllə ayırın</small><input id="sizes" name="sizes" value="${h(variants.map(v=>v.size).join(', '))}" required></label><b>Hər bədən üçün stok</b><div id="stock-inputs"></div><input id="stocks" name="stocks" type="hidden" value="${h(JSON.stringify(Object.fromEntries(variants.map(v=>[v.size,v.stock]))))}"><input name="stock_snapshot" type="hidden" value="${h(JSON.stringify(Object.fromEntries(variants.map(v=>[v.size,v.stock]))))}"><label>Şəkillər<input name="images" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label><label>Qiymət, AZN<input name="price_azn" type="number" min="0.01" step="0.01" required value="${current?.price_azn||''}"></label><button class="button primary submit">Yadda saxla</button></form></section><section><details class="card category-manager"><summary>Kateqoriyaları idarə et <span>${list.length} kateqoriya</span></summary><div class="category-manager-body">${list.map(c=>`<form method="post" action="/admin/categories"><input type="hidden" name="csrf" value="${session.csrf}"><input type="hidden" name="id" value="${c.id}"><input name="name" value="${h(c.name)}" maxlength="60" required aria-label="Kateqoriyanın adı"><button class="button small secondary">Yenilə</button></form>`).join('')}<form method="post" action="/admin/categories"><input type="hidden" name="csrf" value="${session.csrf}"><input name="name" placeholder="Yeni kateqoriyanın adı" maxlength="60" required aria-label="Yeni kateqoriya"><button class="button small primary">Əlavə et</button></form></div></details><form class="filters" method="get"><select name="category" aria-label="Kateqoriya filtri"><option value="">Bütün kateqoriyalar</option>${options(selected)}</select><button class="button secondary">Göstər</button></form><div class="section-title"><h2>Kolleksiya</h2><span>${products.length} məhsul</span></div><div class="product-grid admin-product-grid">${cards||'<p>Məhsul tapılmadı.</p>'}</div></section></div><script src="/product-editor.js" defer></script>`,session)));
  }
  async function saveCategory(req,res,session){
    const body=await readBody(req);if(!validCsrf(body,session))return forbidden(res);
    const name=clean(body.name,60),id=Number(body.id||0);if(!name)return brandError(res,400,'Kateqoriya adı daxil edin.');
    const exists=db.prepare('SELECT id FROM categories WHERE lower(name)=lower(?) AND id<>?').get(name,id);if(exists)return sendHtml(res,400,page('Kateqoriya mövcuddur',adminLayout('Kateqoriyalar','products','<section class="card"><p>Bu adda kateqoriya artıq mövcuddur.</p><a class="button primary" href="/admin/products">Geri qayıt</a></section>',session)));
    if(id)db.prepare('UPDATE categories SET name=? WHERE id=?').run(name,id);else db.prepare('INSERT INTO categories(name)VALUES(?)').run(name);
    redirect(res,'/admin/products');
  }
  async function saveProduct(req,res,session){
    const body=await readBody(req);if(!validCsrf(body,session))return forbidden(res);
    const id=Number(body.id||0),name=clean(body.name,100),description=clean(body.description,300),price=Number(body.price_azn),categoryId=Number(body.category_id);
    const sizes=[...new Set(String(body.sizes||'').split(',').map(s=>s.trim()).filter(Boolean))];let stocks={};try{stocks=JSON.parse(body.stocks||'{}')}catch{}
    const invalid=!name||!Number.isFinite(price)||price<=0||price>1000000||!sizes.length||sizes.length>30||sizes.some(s=>s.length>80)||!stocks||typeof stocks!=='object'||sizes.some(s=>!Number.isSafeInteger(Number(stocks[s]??0))||Number(stocks[s]??0)<0||Number(stocks[s]??0)>1000000)||!db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId);
    const errorView=message=>sendHtml(res,400,page('Məhsulu yoxlayın',adminLayout('Məhsullar','products',`<section class="card"><p>${h(message)}</p><a class="button primary" href="/admin/products${id?'?edit='+id:''}">Geri qayıt</a></section>`,session)));
    if(invalid)return errorView('Ad, kateqoriya, düzgün qiymət və hər bədən üçün tam stok sayı daxil edin.');
    if(id&&!db.prepare('SELECT 1 FROM products WHERE id=?').get(id))return notFound(res);
    // A price-only edit must not put stock sold since the form opened back on sale.
    if(id&&body.stock_snapshot){
      let original;try{original=JSON.parse(body.stock_snapshot);}catch{return errorView('Stok məlumatı dəyişdi. Məhsul formasını yenidən açın.');}
      if(!original||typeof original!=='object')return errorView('Stok məlumatı düzgün deyil.');
      const live=Object.fromEntries(variantsFor(id).map(v=>[v.size,v.stock]));
      for(const size of sizes){
        if(Object.hasOwn(original,size)&&Object.hasOwn(live,size)){
          if(Number(stocks[size]??0)===Number(original[size]))stocks[size]=live[size];
          else if(live[size]!==Number(original[size]))return errorView(`${size} bədəninin stoku bu arada dəyişdi. Formanı yeniləyib yeni stok sayını yoxlayın.`);
        }
      }
    }
    const files=Array.isArray(body.images)?body.images:body.images?[body.images]:[],uploaded=[];
    try{for(const file of files)if(file?.data)uploaded.push(saveImage(file));}catch(error){uploaded.forEach(removeStoredImage);return errorView(error.message);}
    db.exec('BEGIN');
    try{
      const t=now();let productId=id;
      if(id)db.prepare('UPDATE products SET name=?,description=?,sizes=?,price_azn=?,category_id=?,updated_at=? WHERE id=?').run(name,description,JSON.stringify(sizes),Math.round(price*100)/100,categoryId,t,id);
      else productId=Number(db.prepare('INSERT INTO products(name,description,sizes,image_url,price_azn,category_id,is_active,created_at,updated_at)VALUES(?,?,?,?,?,?,1,?,?)').run(name,description,JSON.stringify(sizes),uploaded[0]||'',Math.round(price*100)/100,categoryId,t,t).lastInsertRowid);
      const start=db.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM product_images WHERE product_id=?').get(productId).p;
      uploaded.forEach((url,i)=>db.prepare('INSERT INTO product_images(product_id,image_url,position)VALUES(?,?,?)').run(productId,url,start+i));
      if(uploaded.length)db.prepare('UPDATE products SET image_url=? WHERE id=?').run(imagesFor(productId)[0]||'',productId);
      db.prepare('DELETE FROM product_variants WHERE product_id=?').run(productId);
      for(const size of sizes)db.prepare('INSERT INTO product_variants(product_id,size,stock)VALUES(?,?,?)').run(productId,size,Number(stocks[size]??0));
      db.exec('COMMIT');redirect(res,`/admin/products?edit=${productId}&saved=1`);
    }catch(error){db.exec('ROLLBACK');uploaded.forEach(removeStoredImage);throw error;}
  }
  async function exportOrders(res){
    const orders=db.prepare('SELECT * FROM orders ORDER BY created_at DESC,id DESC').all();
    const items=db.prepare('SELECT oi.*,o.exchange_rate FROM order_items oi JOIN orders o ON o.id=oi.order_id ORDER BY oi.order_id DESC,oi.id').all();
    const buffer=await buildOrderWorkbook(orders,items,STATUS_LABELS);
    res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="auren-orders-${now().slice(0,10)}.xlsx"`,'Cache-Control':'no-store'});res.end(buffer);
  }
  return {customerPage,productDetail,checkoutPage,checkout,thankYou,adminOrders,orderFragment,changeStatus,productsPage,saveProduct,saveCategory,cartQuote,subscribe,exportOrders,quote};
}
module.exports={createShopFeatures};
