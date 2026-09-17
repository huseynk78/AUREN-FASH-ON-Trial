(() => {
  const field=document.querySelector('#sizes'),out=document.querySelector('#stock-inputs'),hidden=document.querySelector('#stocks');if(!field)return;
  let stocks=JSON.parse(hidden.value||'{}');
  function render(){
    const sizes=[...new Set(field.value.split(',').map(s=>s.trim()).filter(Boolean))];out.replaceChildren();
    for(const size of sizes){const label=document.createElement('label');label.className='stock-field';label.append(document.createTextNode(size));const input=document.createElement('input');input.type='number';input.min='0';input.max='1000000';input.step='1';input.value=stocks[size]??0;input.required=true;input.addEventListener('input',()=>{stocks[size]=Number(input.value);hidden.value=JSON.stringify(stocks);});label.append(input);out.append(label);if(stocks[size]===undefined)stocks[size]=0;}
    hidden.value=JSON.stringify(stocks);
  }
  field.addEventListener('change',render);render();
})();
