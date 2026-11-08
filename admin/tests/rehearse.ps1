param(
    [Parameter(Mandatory)][uri]$PortalUrl,
    [Parameter(Mandatory)][uri]$FixtureHubUrl
)

$ErrorActionPreference = 'Stop'
if (-not $PortalUrl.IsLoopback -or -not $FixtureHubUrl.IsLoopback) {
    throw 'The portal rehearsal requires a fresh local test hub and a loopback portal.'
}

$previousTarget = $env:URL
$previousHub = $env:KAPE_DOZ_BROWSER_TEST_HUB
Push-Location (Join-Path $PSScriptRoot '..\..')
try {
    $env:URL = $PortalUrl.AbsoluteUri
    $env:KAPE_DOZ_BROWSER_TEST_HUB = $FixtureHubUrl.GetLeftPart([System.UriPartial]::Authority)
    $audit = @'
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const target = await helpers.resolveTargetUrl();
assert.ok(target);
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext({viewport:{width:1280,height:800}});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', e=>errors.push(e.message));
page.on('console', m=>{if(m.type()==='error') errors.push(m.text()+' '+m.location().url);});
const api = context.request;
const hub = process.env.KAPE_DOZ_BROWSER_TEST_HUB;
async function call(path, {token, data, status=200}={}) {
  const response=await api.fetch(hub+path,{method:data===undefined?'GET':'POST',headers:token?{Authorization:'Bearer '+token}:undefined,data});
  assert.equal(response.status(),status,path);
  return status===200?await response.json():null;
}
const mutate=(token,path,data)=>call(path,{token,data:{commandId:randomUUID(),...data}});
const secret='Transport-Fixture-Device-Secret-32!';
const staff=(role,pin)=>call('/api/v1/auth/staff',{data:{accountId:'transport-'+role,pin,deviceId:'transport-'+role+'-tablet',deviceSecret:secret}});
const label=name=>page.getByLabel(name,{exact:true});
const button=name=>page.getByRole('button',{name,exact:true});
const nav=name=>page.getByRole('navigation').getByRole('button',{name,exact:true});
const visible=locator=>locator.waitFor({state:'visible',timeout:12000});
const h=name=>page.getByRole('heading',{name,exact:true,level:1});
const tag=randomUUID().slice(0,8);
const loginPortal=async (accountId,password)=>{
  await visible(h('Administrator sign-in'));
  await label('Account ID').fill(accountId);
  await label('Password').fill(password);
  const incoming=page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/admin')&&r.request().method()==='POST');
  await button('Sign in').click();
  const response=await incoming;
  assert.equal(response.status(),200);
  await visible(h('Shift review'));
  return (await response.json()).token;
};
const signOutPortal=async token=>{
  const outgoing=page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/logout')&&r.request().method()==='POST');
  await button('Sign out').click();
  assert.equal((await outgoing).status(),204);
  await visible(h('Administrator sign-in'));
  await call('/api/v1/admin/shifts',{token,status:401});
};
const responsive=async (name,save)=>{
  await visible(h(name));
  await page.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(el=>el.textContent?.trim()==='Loading workspace…'));
  for(const [width,height] of [[375,667],[768,1024],[1280,800]]) {
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,name+' '+width+' overflow');
    if(save) await page.screenshot({path:'scratch/admin-'+name.toLowerCase().replace(' ','-')+'-'+width+'.png'});
  }
  console.log('PASS responsive '+name+' 375/768/1280');
};
try {
  await page.goto(target,{waitUntil:'domcontentloaded'});
  const owner=await loginPortal('transport-owner','Transport-Fixture-Owner-Password!');
  await nav('Inventory').click();
  const iid='oat-'+tag, item='Oat drink '+tag;
  await label('Ingredient ID').fill(iid);
  await label('Ingredient name').fill(item);
  await page.locator('select[name=unit]').selectOption('ml');
  await button('Add ingredient').click();
  await visible(page.getByText('Ingredient created.',{exact:true}));
  await visible(label('Quantity in ingredient units'));
  await label('Quantity in ingredient units').locator('..').locator('..').locator('select[name=ingredient]').selectOption(iid);
  await label('Quantity in ingredient units').fill('1000');
  await label('Total received cost (PHP)').fill('120.50');
  await label('Receipt reference').fill('Synthetic portal intake '+tag);
  await button('Save stock receipt').click();
  await visible(page.getByText('Stock receipt saved.',{exact:true}));
  await nav('Recipes').click();
  const pid='latte-'+tag, product='Oat latte '+tag;
  await label('Product ID').fill(pid);
  await label('Product name').fill(product);
  await label('Retail price (PHP)').fill('165');
  await page.locator('select[name=ingredient-1]').selectOption(iid);
  await label('Quantity').fill('150');
  await button('Create recipe').click();
  await visible(page.getByText('Recipe created.',{exact:true}));
  console.log('PASS portal creates ingredient, receives 1000 mL, publishes 150 mL recipe');
  await nav('Expenses').click();
  const expense=async (description,amount,start,end)=>{
    await label('Category').fill('Occupancy');
    await label('Description').fill(description);
    await label('Expense amount (PHP)').fill(amount);
    await label('Expense start date').fill(start);
    await label('Expense end date').fill(end);
    const saved=page.waitForResponse(r=>r.url().endsWith('/api/v1/admin/expenses')&&r.request().method()==='POST');
    await button('Save expense').click();
    assert.equal((await saved).status(),200);
    await visible(page.getByText('Operating expense saved.',{exact:true}));
  };
  const report=async(from,through,amount)=>{
    await label('Report start date').fill(from);
    await label('Report end date').fill(through);
    await button('Apply date range').click();
    await visible(page.getByText(from+' through '+through,{exact:true}));
    assert.equal(await page.locator('.expense-total dd').textContent(),amount);
  };
  const rent='Synthetic November rent '+tag;
  await expense(rent,'300.01','2031-11-01','2031-11-30');
  await expense('Synthetic key cutting '+tag,'1.01','2031-11-16','2031-11-16');
  await report('2031-11-01','2031-11-15','₱150.00');
  await report('2031-11-16','2031-11-30','₱151.02');
  await visible(page.getByText(rent,{exact:true}));
  await responsive('Expenses',true);
  await nav('Devices').click();
  await visible(page.getByText('transport-barista-tablet',{exact:true}));
  await responsive('Devices',false);
  await signOutPortal(owner);
  const manager=await loginPortal('transport-manager','Transport-Fixture-Manager-Password!');
  await nav('Sales & margin').click();
  await visible(page.getByText('No dated sales settled in this period.',{exact:true}));
  await responsive('Sales & margin',false);
  await nav('Shift review').click();
  assert.equal(await nav('Devices').count(),0);
  await call('/api/v1/devices',{token:manager,status:403});
  assert.equal((await call('/api/v1/admin/expenses?from=2031-11-01&through=2031-11-30',{token:manager})).allocatedCentavos,30102);
  console.log('PASS owner enters recurring and one-time expenses; exact half-month reports; manager reads ledger and cannot list devices');
  const cashier=(await staff('cashier','4826')).token;
  const barista=(await staff('barista','5937')).token;
  await call('/api/v1/admin/shifts',{token:cashier,status:403});
  await call('/api/v1/admin/expenses?from=2031-11-01&through=2031-11-30',{token:cashier,status:403});
  await call('/api/v1/admin/expenses?from=2031-11-01&through=2031-11-30',{token:barista,status:403});
  await call('/api/v1/admin/expenses?from=2031-11-01&through=2031-11-30',{status:401});
  await call('/api/v1/admin/shifts',{token:barista,status:403});
  let shift=(await mutate(cashier,'/api/v1/shifts/open',{openingCashCentavos:100000})).shift;
  const start=(await mutate(cashier,'/api/v1/orders',{dineIn:true,table:'04',items:[{productId:pid,quantity:1,note:'Less sweet'}]})).order;
  const path='/api/v1/orders/'+start.id;
  let order=(await mutate(cashier,path+'/send',{expectedVersion:start.version})).order;
  const queue=(await call('/api/v1/orders',{token:barista})).orders;
  assert.equal(queue[0].id,order.id);
  assert.equal(queue[0].lines[0].note,'Less sweet');
  assert.equal(queue[0].totalCentavos,undefined);
  const ready={commandId:randomUUID(),expectedVersion:queue[0].version};
  const prep=await call(path+'/ready',{token:barista,data:ready});
  assert.equal(prep.order.ready,true);
  assert.deepEqual(await call(path+'/ready',{token:barista,data:ready}),prep);
  order=(await call(path,{token:cashier})).order;
  order=(await mutate(cashier,path+'/payments',{expectedVersion:order.version,method:'cash',amountCentavos:10000,cashReceivedCentavos:20000,verified:true})).order;
  await call(path+'/receipt',{token:cashier,data:{commandId:randomUUID(),expectedVersion:order.version},status:409});
  order=(await mutate(cashier,path+'/payments',{expectedVersion:order.version,method:'gcash',amountCentavos:6500,verified:true,reference:'Synthetic portal tender '+tag})).order;
  assert.equal(order.paidCentavos,16500);
  const receipt={commandId:randomUUID(),expectedVersion:order.version};
  const printed=await call(path+'/receipt',{token:cashier,data:receipt});
  assert.equal(printed.job.status,'unconfigured');
  assert.deepEqual(await call(path+'/receipt',{token:cashier,data:receipt}),printed);
  const stock=(await call('/api/v1/ingredients',{token:cashier})).ingredients.find(x=>x.id===iid);
  assert.equal(stock.onHandMilli,850000);
  assert.equal(stock.reservedMilli,0);
  shift=(await call('/api/v1/shifts/current',{token:cashier})).shift;
  const count=(shift,countedCashCentavos,note)=>mutate(cashier,'/api/v1/shifts/'+shift.id+'/submit-count',{expectedVersion:shift.version,countedCashCentavos,note});
  await count(shift,109900,'Initial synthetic count');
  await button('Refresh').click();
  const details=page.getByRole('complementary',{name:'Selected shift'});
  await visible(details.getByText('Initial synthetic count',{exact:true}));
  assert.match(await details.innerText(),/Expected cash\s+₱1,100\.00/);
  await button('Request recount').click();
  await visible(details.getByText('Recount requested',{exact:true}));
  shift=(await call('/api/v1/shifts/current',{token:cashier})).shift;
  await count(shift,110000,'Corrected synthetic count');
  await button('Refresh').click();
  await visible(details.getByText('Corrected synthetic count',{exact:true}));
  await button('Approve close').click();
  await visible(details.getByText('Closed',{exact:true}));
  const closed=(await call('/api/v1/admin/shifts',{token:manager})).shifts.find(x=>x.id===shift.id);
  assert.equal(closed.expectedCashCentavos,110000);
  assert.equal(closed.countedCashCentavos,110000);
  assert.equal(closed.varianceCentavos,0);
  console.log('PASS dine-in prep once, split settlement, optional unconfigured receipt, recount and closed drawer',JSON.stringify({orderId:order.id,shiftId:shift.id,readyCommand:ready.commandId,receiptCommand:receipt.commandId}));
  const todayParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const today=['year','month','day'].map(type=>todayParts.find(part=>part.type===type).value).join('-');
  await mutate(barista,'/api/v1/waste',{ingredientId:iid,quantityMilli:10000,reason:'Synthetic dial-in'});
  await nav('Expenses').click();
  await expense('Synthetic daily utilities '+tag,'10.00',today,today);
  const salesPeriod=async()=>{
    await label('Report start date').fill(today);
    await label('Report end date').fill(today);
    const incoming=page.waitForResponse(response=>{
      const url=new URL(response.url());
      return url.pathname==='/api/v1/admin/sales' && url.searchParams.get('from')===today && url.searchParams.get('through')===today;
    });
    await button('Apply date range').click();
    assert.equal((await incoming).status(),200);
    await page.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(el=>el.textContent?.trim()==='Loading workspace…'));
    await visible(page.getByRole('heading',{name:'Sales by day',exact:true}));
  };
  const metric=name=>page.getByText(name,{exact:true}).locator('..').locator('dd');
  const assertReport=async()=>{
    await visible(page.getByText('₱165.00',{exact:true}).first());
    assert.equal(await metric('Final ingredient cost').textContent(),'₱18.08');
    assert.equal(await metric('Estimated pending ingredient cost').textContent(),'₱0.00');
    assert.equal(await metric('Waste and dial-in cost').textContent(),'₱1.21');
    assert.equal(await metric('Entered expenses').textContent(),'₱10.00');
    assert.equal(await metric('Estimated gross profit').textContent(),'₱146.92');
  };
  await nav('Sales & margin').click();
  await salesPeriod();
  await assertReport();
  assert.equal(await metric('Estimated operating profit').textContent(),'Unavailable');
  await page.getByRole('checkbox').check();
  await button('Confirm expense coverage').click();
  await visible(page.getByText('Expenses are confirmed for this exact date range.',{exact:true}));
  assert.equal(await metric('Estimated operating profit').textContent(),'₱135.71');
  await page.getByText('Daily sales figures',{exact:true}).click();
  await visible(page.getByRole('cell',{name:today,exact:true}));
  await responsive('Sales & margin',true);
  await mutate(manager,'/api/v1/inventory/receipts',{ingredientId:iid,quantityMilli:1000000,totalCostCentavos:30000,reference:'Synthetic higher cost '+tag});
  await button('Refresh').click();
  await visible(page.getByRole('heading',{name:'Cost and profit',exact:true}));
  await assertReport();
  assert.equal(await metric('Estimated operating profit').textContent(),'₱135.71');
  await nav('Expenses').click();
  await expense('Synthetic late utilities '+tag,'5.00',today,today);
  await nav('Sales & margin').click();
  await salesPeriod();
  assert.equal(await metric('Entered expenses').textContent(),'₱15.00');
  assert.equal(await metric('Estimated operating profit').textContent(),'Unavailable');
  await page.getByRole('checkbox').check();
  await button('Confirm expense coverage').click();
  await visible(page.getByText('Expenses are confirmed for this exact date range.',{exact:true}));
  assert.equal(await metric('Estimated operating profit').textContent(),'₱130.71');
  await call('/api/v1/admin/sales?from='+today+'&through='+today,{token:cashier,status:403});
  await call('/api/v1/admin/sales?from='+today+'&through='+today,{token:barista,status:403});
  console.log('PASS dated sales graph, immutable ingredient cost, separate dial-in deduction, coverage invalidation and reconciled operating profit');
  for(const name of ['Shift review','Recipes','Inventory']) {
    await nav(name).click();
    await responsive(name,name==='Shift review'||name==='Inventory');
  }
  await signOutPortal(manager);
  const finalOwner=await loginPortal('transport-owner','Transport-Fixture-Owner-Password!');
  await nav('Devices').click();
  const row=page.getByRole('row').filter({hasText:'transport-barista-tablet'});
  await row.getByRole('button',{name:'Revoke device'}).click();
  await button('Confirm revoke').click();
  await visible(row.getByText('Revoked',{exact:true}));
  await call('/api/v1/me',{token:barista,status:401});
  await signOutPortal(finalOwner);
  console.log('PASS owner revokes barista device and active session');
  await page.reload({waitUntil:'domcontentloaded'});
  await visible(h('Administrator sign-in'));
  assert.equal(await page.getByText('Corrected synthetic count',{exact:true}).count(),0);
  assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
  assert.deepEqual(errors,[]);
  console.log('PASS logout revokes hub session; reload contains no privileged data; 0 page/console errors');
} finally { await browser.close(); }
'@
    node .agents/skills/playwright-skill/run.js -e $audit
    $auditExit = $LASTEXITCODE
} finally {
    $env:URL = $previousTarget
    $env:KAPE_DOZ_BROWSER_TEST_HUB = $previousHub
    Pop-Location
}
exit $auditExit
