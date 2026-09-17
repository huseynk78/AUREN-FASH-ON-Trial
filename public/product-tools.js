(() => {
  const picker = document.querySelector('input[name="images"][multiple]');
  if (picker) {
    let files = [];
    const previews = document.createElement('div');
    previews.className = 'pending-images';
    const note = document.createElement('p');
    note.className = 'muted';
    note.setAttribute('role', 'status');
    picker.closest('label').after(note, previews);
    const urls = [];
    function draw() {
      const transfer = new DataTransfer();
      files.forEach(file => transfer.items.add(file));
      picker.files = transfer.files;
      urls.splice(0).forEach(url => URL.revokeObjectURL(url));
      previews.replaceChildren();
      files.forEach((file, index) => {
        const card = document.createElement('div');
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file); urls.push(img.src); img.alt = file.name;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'button small danger'; button.textContent = 'Seçimdən çıxar';
        button.onclick = () => { files.splice(index, 1); draw(); };
        card.append(img, button); previews.append(card);
      });
      note.textContent = files.length ? files.length + ' şəkil seçilib. Yükləmək üçün “Yadda saxla” düyməsini basın.' : 'Şəkilləri bir dəfəyə və ya ayrı-ayrı seçə bilərsiniz.';
    }
    picker.addEventListener('change', () => {
      let error = '';
      for (const file of picker.files) {
        if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 5*1024*1024) { error = 'Yalnız 5 MB-dan kiçik JPG, PNG, WEBP və GIF şəkilləri seçin.'; continue; }
        if (files.some(old => old.name===file.name && old.size===file.size && old.lastModified===file.lastModified)) continue;
        if(files.reduce((total,item)=>total+item.size,0)+file.size>25*1024*1024){error='Bir dəfəyə ən çox 25 MB şəkil seçə bilərsiniz.';continue;}
        files.push(file);
      }
      draw(); if (error) note.textContent += ' ' + error;
    });
    draw();
  }
  const main = document.querySelector('#main-image');
  if (!main) return;
  const thumbs = [...document.querySelectorAll('.gallery-thumb')];
  const sources = thumbs.map(button => button.dataset.image);
  if (!sources.length) sources.push(main.src);
  const gallery = main.closest('.gallery-main');
  gallery.tabIndex = 0; gallery.setAttribute('aria-label','Məhsul şəkilləri. Sağ və sol oxlarla dəyişin.');
  let index = Math.max(0, sources.findIndex(src => new URL(src, location.href).href === main.src));
  let modal = null, zoomImage = null, zoomCount = null;
  const counter = document.createElement('span'); counter.className='gallery-counter'; counter.setAttribute('aria-live','polite'); gallery.append(counter);
  function show(next) {
    index=(next+sources.length)%sources.length; main.src=sources[index];
    thumbs.forEach((button,i)=>{button.classList.toggle('active',i===index);button.setAttribute('aria-pressed',String(i===index));});
    counter.textContent=(index+1)+' / '+sources.length;
    if(zoomImage) zoomImage.src=main.src;
    if(zoomCount) zoomCount.textContent=counter.textContent;
  }
  function arrows(parent) {
    for (const [step,label,icon] of [[-1,'Əvvəlki şəkil','‹'],[1,'Növbəti şəkil','›']]) {
      const button=document.createElement('button');button.type='button';button.className='gallery-arrow '+(step<0?'previous':'next');button.textContent=icon;button.setAttribute('aria-label',label);button.hidden=sources.length<2;
      button.onclick=event=>{event.stopPropagation();show(index+step)};parent.append(button);
    }
  }
  function swipe(element) {
    let start=null,dragged=false;
    element.addEventListener('pointerdown',event=>{if(event.target.closest('button'))return;start={x:event.clientX,y:event.clientY};dragged=false;});
    element.addEventListener('pointerup',event=>{if(!start)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;start=null;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)){dragged=true;show(index+(dx<0?1:-1));}});
    element.addEventListener('pointercancel',()=>{start=null;});
    element.addEventListener('click',event=>{if(dragged){event.preventDefault();event.stopImmediatePropagation();dragged=false;}},true);
    element.addEventListener('dragstart',event=>event.preventDefault());
  }
  arrows(gallery);swipe(gallery);
  thumbs.forEach((button,i)=>{button.onclick=()=>show(i);button.setAttribute('aria-label','Şəkil '+(i+1));});
  gallery.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();show(index+(event.key==='ArrowRight'?1:-1));}});
  main.tabIndex=0; main.setAttribute('role','button');main.setAttribute('aria-label','Şəkli böyüt');
  let oldFocus;
  function close(){if(!modal)return;modal.remove();modal=null;zoomImage=null;zoomCount=null;oldFocus?.focus();}
  function open(){
    if(modal)return;oldFocus=document.activeElement;
    modal=document.createElement('div');modal.className='image-modal gallery-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Məhsul şəkilləri');
    zoomImage=document.createElement('img');zoomImage.src=main.src;zoomImage.alt=main.alt;
    const exit=document.createElement('button');exit.className='gallery-close';exit.textContent='×';exit.setAttribute('aria-label','Bağla');exit.onclick=close;
    zoomCount=document.createElement('span');zoomCount.className='gallery-counter';zoomCount.textContent=counter.textContent;
    modal.append(zoomImage,exit,zoomCount);arrows(modal);swipe(modal);
    modal.addEventListener('click',event=>{if(event.target===modal)close();});
    modal.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close();}
      else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();show(index+(event.key==='ArrowRight'?1:-1));}
      else if(event.key==='Tab'){const buttons=[...modal.querySelectorAll('button:not([hidden])')];const current=buttons.indexOf(document.activeElement);event.preventDefault();buttons[(current+(event.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}
    });
    document.body.append(modal);exit.focus();
  }
  main.onclick=open;main.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});show(index);
})();
