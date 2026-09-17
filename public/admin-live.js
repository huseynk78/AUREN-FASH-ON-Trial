(() => {
  const dashboard=document.querySelector('#orders-dashboard'),indicator=document.querySelector('#live-status'),error=document.querySelector('#admin-error');
  if(!dashboard)return;
  let timer,sequence=0,busy=false,pending=false;
  async function refresh(force=false){
    if(busy&&!force){pending=true;return;}
    const focused=dashboard.contains(document.activeElement)&&document.activeElement.matches('input,select');
    if(focused&&!force){pending=true;return;}
    const id=++sequence;
    try{const response=await fetch('/admin/orders-fragment'+location.search,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});if(response.redirected){location.assign('/admin/login');return;}if(!response.ok)throw Error();const result=await response.json();if(id===sequence){dashboard.innerHTML=result.html;pending=false;}}
    catch{indicator.innerHTML='<i></i> Bağlantı yenidən qurulur…';}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>refresh(),120);}
  const stream=new EventSource('/admin/events');
  stream.addEventListener('open',()=>{indicator.innerHTML='<i></i> Canlı yenilənir';});
  stream.addEventListener('orders',schedule);
  stream.addEventListener('error',()=>{indicator.innerHTML='<i></i> Yenidən qoşulur…';});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  dashboard.addEventListener('focusout',()=>{if(pending)schedule();});
  dashboard.addEventListener('click',event=>{const tab=event.target.closest('.order-tab');if(!tab)return;event.preventDefault();history.pushState({},'',tab.href);refresh(true);});
  dashboard.addEventListener('submit',async event=>{
    const form=event.target;
    if(form.matches('[data-order-filters]')){event.preventDefault();history.pushState({},'','/admin?'+new URLSearchParams(new FormData(form)));refresh(true);return;}
    if(!form.matches('[data-status-form]'))return;
    event.preventDefault();if(busy)return;busy=true;const button=form.querySelector('button');button.disabled=true;error.textContent='';
    try{const response=await fetch(form.action,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(form)),signal:AbortSignal.timeout(10000)});if(response.redirected){location.assign('/admin/login');return;}if(!response.ok)throw Error('Vəziyyət dəyişmədi. Yenidən cəhd edin.');await refresh(true);}
    catch(e){error.textContent=e.message;}finally{busy=false;button.disabled=false;if(pending)schedule();}
  });
  window.addEventListener('popstate',()=>refresh(true));
  setInterval(()=>{if(!document.hidden)refresh();},15000);
  window.addEventListener('pagehide',()=>stream.close());
})();
