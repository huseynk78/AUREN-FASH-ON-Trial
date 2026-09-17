(() => {
  'use strict';
  const $=selector=>document.querySelector(selector);
  const money=value=>Number(value).toFixed(2);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function cart(){try{const items=JSON.parse(localStorage.getItem('shop_cart')||'[]');return Array.isArray(items)?items.filter(x=>x&&Number.isSafeInteger(Number(x.productId))&&typeof x.size==='string'&&Number.isSafeInteger(Number(x.quantity))&&Number(x.quantity)>0):[];}catch{return[];}}
  function save(items){localStorage.setItem('shop_cart',JSON.stringify(items));count();}
  function count(){const el=$('#cart-count');if(el)el.textContent=cart().reduce((s,x)=>s+Number(x.quantity),0);}
  async function quote(items){const res=await fetch('/api/cart',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams({items:JSON.stringify(items)}),signal:AbortSignal.timeout(10000)});const data=await res.json();if(!res.ok)throw Error(data.error||'Səbət yenilənmədi.');return data;}
  count();
  if($('[data-product-view]')){
    const product=JSON.parse($('#product-data').textContent),input=$('#qty'),button=$('#add-cart'),feedback=$('#product-feedback');let selected=null;
    document.querySelectorAll('.size-choice').forEach(el=>el.addEventListener('click',()=>{document.querySelectorAll('.size-choice').forEach(x=>x.classList.remove('selected'));el.classList.add('selected');selected={size:el.dataset.size,stock:Number(el.dataset.stock)};input.disabled=false;input.value=1;button.disabled=false;$('#stock-note').textContent=`${selected.stock} ədəd stokda`;feedback.textContent='';}));
    input.addEventListener('input',()=>{if(selected)feedback.textContent=Number(input.value)>selected.stock?`Stokda yalnız ${selected.stock} ədəd var.`:'';});
    button.addEventListener('click',async()=>{
      if(!selected)return;const quantity=Number(input.value);
      if(!Number.isSafeInteger(quantity)||quantity<1){feedback.textContent='Ədəd tam və müsbət rəqəm olmalıdır.';return;}
      const items=cart(),old=items.find(x=>Number(x.productId)===product.id&&x.size===selected.size);
      if(old)old.quantity=Number(old.quantity)+quantity;else items.push({productId:product.id,size:selected.size,quantity});
      button.disabled=true;
      try{const current=await quote(items),line=current.items.find(x=>x.productId===product.id&&x.size===selected.size);selected.stock=line.stock;$('#stock-note').textContent=`${line.stock} ədəd stokda`;if(line.error){feedback.textContent=line.error;return;}save(current.items.map(x=>({...x,price:x.unitPrice})));$('#detail-price').innerHTML=`${money(line.unitPrice)} AZN <small class="usd-price">≈ ${money(line.unitPrice/current.rate)} USD</small>`;feedback.textContent='Səbətə əlavə edildi.';}
      catch(error){feedback.textContent=error.message||'Bağlantını yoxlayıb yenidən cəhd edin.';}finally{button.disabled=false;}
    });
  }
  const form=$('#checkout-form');if(!form)return;
  const box=$('#cart-items'),notice=$('#cart-notice'),button=$('#checkout-submit'),error=$('#checkout-error');
  let latest=null,requestId=0,submitting=false,lastRender='',cartRevision=0,quantityTimer;
  function empty(){box.innerHTML='<section class="empty-state"><span>◇</span><h2>Səbətiniz boşdur</h2><p>Kolleksiyadan sevdiyiniz parçaları seçin.</p><a class="button primary" href="/">Kolleksiyaya bax</a></section>';form.hidden=true;$('#cart-summary').hidden=true;latest=null;}
  function apply(data){
    const changed=latest&&latest.signature!==data.signature&&latest.items.some(old=>{const item=data.items.find(x=>x.productId===old.productId&&x.size===old.size);return item&&item.unitPrice!==old.unitPrice;});
    if(changed)notice.textContent='Məhsulun qiyməti yeniləndi. Səbət aktual qiymətlə hesablandı.';
    latest=data;form.hidden=false;$('#cart-summary').hidden=false;
    const key=JSON.stringify(data.items);
    if(key!==lastRender){
      const focus=document.activeElement?.dataset.cartQty;lastRender=key;
      box.innerHTML=data.items.map((x,i)=>`<article class="cart-item ${x.error?'cart-item-invalid':''}">${x.image?`<img src="${escape(x.image)}" alt="${escape(x.name)}">`:'<div class="cart-image">◇</div>'}<div class="cart-item-info"><span class="product-category">${escape(x.category)}</span><b>${escape(x.name)}</b><small>Bədən: ${escape(x.size)}</small><div class="quantity-control"><button type="button" data-delta="-1" data-index="${i}" aria-label="Ədədi azalt" ${x.quantity<=1?'disabled':''}>−</button><input type="number" min="1" step="1" inputmode="numeric" value="${x.quantity}" data-cart-qty="${i}" aria-label="${escape(x.name)} üçün ədəd"><button type="button" data-delta="1" data-index="${i}" aria-label="Ədədi artır">+</button></div>${x.error?`<p class="stock-warning" role="alert">${escape(x.error)}</p>`:''}</div><div class="cart-item-price"><strong>${money(x.lineTotal)} AZN</strong><small>≈ ${money(x.lineTotal/data.rate)} USD</small><button class="remove-item" type="button" data-remove="${i}">Sil</button></div></article>`).join('');
      if(focus!==undefined)box.querySelector(`[data-cart-qty="${focus}"]`)?.focus({preventScroll:true});
    }
    $('#cart-total-azn').textContent=`${money(data.totalAzn)} AZN`;$('#cart-total-usd').textContent=`≈ ${money(data.totalUsd)} USD`;
    $('#checkout-items').value=JSON.stringify(data.items.map(({productId,size,quantity})=>({productId,size,quantity})));
    $('#quote-signature').value=data.signature;button.disabled=!data.valid||submitting;
    save(data.items.map(x=>({...x,price:x.unitPrice})));
  }
  async function refresh(){
    const items=cart();let edited=false;
    // Read the visible quantities too: some mobile keyboards defer change events
    // until blur, while the shopper may immediately press the checkout button.
    for(const input of box.querySelectorAll('[data-cart-qty]')){
      const old=latest?.items[Number(input.dataset.cartQty)],value=Number(input.value);
      if(!old||value===old.quantity)continue;
      if(!Number.isSafeInteger(value)||value<1){error.textContent='Ədəd tam və müsbət rəqəm olmalıdır.';button.disabled=true;return null;}
      const item=items.find(x=>Number(x.productId)===old.productId&&x.size===old.size);
      if(item){item.quantity=value;edited=true;}
    }
    if(edited){cartRevision++;save(items);}
    const id=++requestId,rev=cartRevision;
    if(!items.length){empty();count();return null;}
    try{const data=await quote(items);if(id!==requestId||rev!==cartRevision)return null;apply(data);return data;}
    catch(e){if(id===requestId){notice.textContent='Qiymətlər yoxlanılmadı. İnternet bağlantısını yoxlayın.';button.disabled=true;}return null;}
  }
  function quantity(index,value){const items=cart();if(!Number.isSafeInteger(value)||value<1){error.textContent='Ədəd tam və müsbət rəqəm olmalıdır.';button.disabled=true;return;}if(!items[index])return;items[index].quantity=value;cartRevision++;save(items);button.disabled=true;error.textContent='';refresh();}
  box.addEventListener('click',event=>{
    const delta=event.target.closest('[data-delta]');if(delta){const i=Number(delta.dataset.index);quantity(i,Number(cart()[i]?.quantity)+Number(delta.dataset.delta));return;}
    const remove=event.target.closest('[data-remove]');if(remove){const items=cart();items.splice(Number(remove.dataset.remove),1);cartRevision++;save(items);refresh();}
  });
  box.addEventListener('input',event=>{
    if(!event.target.matches('[data-cart-qty]'))return;
    button.disabled=true;clearTimeout(quantityTimer);
    const index=Number(event.target.dataset.cartQty),value=Number(event.target.value);
    quantityTimer=setTimeout(()=>quantity(index,value),250);
  });
  box.addEventListener('change',event=>{if(event.target.matches('[data-cart-qty]')){clearTimeout(quantityTimer);quantity(Number(event.target.dataset.cartQty),Number(event.target.value));}});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(submitting||!form.reportValidity())return;
    submitting=true;button.disabled=true;error.textContent='';const before=latest?.signature;
    try{
      const current=await refresh();
      if(!current||!current.valid){error.textContent=current?.items.find(x=>x.error)?.error||'Səbəti yoxlayıb yenidən cəhd edin.';return;}
      if(before!==current.signature){error.textContent='Məbləğ yeniləndi. Yeni qiyməti yoxlayıb yenidən təsdiqləyin.';return;}
      const response=await fetch('/checkout',{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(form)),signal:AbortSignal.timeout(20000)});
      const result=await response.json();if(!response.ok){if(result.quote)apply(result.quote);error.textContent=result.error||'Sifariş tamamlanmadı.';return;}
      localStorage.removeItem('shop_cart');location.assign(result.location);
    }catch(e){error.textContent='Bağlantı kəsildi. Yenidən cəhd edə bilərsiniz; eyni sifariş iki dəfə qeydə alınmayacaq.';}
    finally{submitting=false;button.disabled=!latest?.valid;}
  });
  refresh();setInterval(()=>{if(!document.hidden&&!submitting&&!document.activeElement?.matches('[data-cart-qty]'))refresh();},5000);
  window.addEventListener('focus',()=>{if(!submitting)refresh();});
  window.addEventListener('storage',event=>{if(event.key==='shop_cart'){cartRevision++;refresh();}});
})();
