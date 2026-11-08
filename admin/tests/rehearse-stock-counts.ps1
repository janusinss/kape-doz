param(
    [Parameter(Mandatory)][uri]$PortalUrl,
    [Parameter(Mandatory)][uri]$FixtureHubUrl
)
$ErrorActionPreference = 'Stop'
if (-not $PortalUrl.IsLoopback -or -not $FixtureHubUrl.IsLoopback) {
    throw 'Use a local portal and a fresh synthetic inventory hub.'
}
$previousTarget = $env:URL
$previousHub = $env:KAPE_DOZ_COUNT_TEST_HUB
Push-Location (Join-Path $PSScriptRoot '..\..')
try {
    $env:URL = $PortalUrl.AbsoluteUri
    $env:KAPE_DOZ_COUNT_TEST_HUB = $FixtureHubUrl.GetLeftPart([UriPartial]::Authority)
    $audit = @'
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const target=await helpers.resolveTargetUrl();
assert.ok(target);
const hub=process.env.KAPE_DOZ_COUNT_TEST_HUB;
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:800}});
const page=await context.newPage();
page.setDefaultTimeout(15000);
const errors=[],commands={},countIds={},orderIds=[];
let manager,dropPath=null,droppedId=null;
const countsPath='/api/v1/inventory/counts';
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{
  const controlled=m.type()==='error' && m.location().url.includes(countsPath) &&
    (m.text().includes('409 (Conflict)') || m.text().includes('net::ERR_FAILED'));
  if(m.type()==='error' && !controlled) errors.push(m.text()+' '+m.location().url);
});
await page.route('**/api/v1/inventory/counts/**',async route=>{
  const request=route.request();
  if(request.method()==='POST' && new URL(request.url()).pathname===dropPath) {
    assert.equal(droppedId,null,'cost confirmation must not be transmitted twice');
    droppedId=request.postDataJSON().commandId;
    const response=await route.fetch();
    assert.equal(response.status(),200,'commit before dropping acknowledgment');
    return route.abort('failed');
  }
  return route.continue();
});
async function call(path,{token,data,status=200}={}) {
  const response=await context.request.fetch(hub+path,{method:data===undefined?'GET':'POST',data,
    headers:token?{Authorization:'Bearer '+token}:undefined});
  assert.equal(response.status(),status,path);
  return status===204?null:await response.json();
}
async function mutate(key,token,path,data) {
  const commandId=randomUUID();
  commands[key]=commandId;
  return call(path,{token,data:{commandId,...data}});
}
const button=name=>page.getByRole('button',{name,exact:true});
const field=name=>page.getByLabel(name,{exact:true});
const details=()=>page.getByRole('region',{name:'Selected stock count',exact:true});
const shown=locator=>locator.waitFor({state:'visible'});
async function settled() {
  await page.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(el=>el.textContent?.trim()==='Loading workspace…'));
  await page.getByRole('region',{name:'Stock counts',exact:true}).waitFor();
}
async function nav(name) {
  await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();
  await page.getByRole('heading',{name,exact:true,level:1}).waitFor();
  if(name==='Inventory') await settled();
}
async function signIn() {
  await page.getByRole('heading',{name:'Administrator sign-in',exact:true}).waitFor();
  await field('Account ID').fill('transport-manager');
  await field('Password').fill('Transport-Fixture-Manager-Password!');
  const incoming=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/admin' && r.request().method()==='POST');
  await button('Sign in').click();
  const response=await incoming;
  assert.equal(response.status(),200);
  manager=(await response.json()).token;
  await page.getByRole('navigation').waitFor();
}
async function ui(key,path,action,status=200) {
  const incoming=page.waitForResponse(r=>new URL(r.url()).pathname===path && r.request().method()==='POST');
  await action();
  const response=await incoming;
  assert.equal(response.status(),status,path);
  commands[key]=response.request().postDataJSON().commandId;
  const result=status===200?await response.json():null;
  if(status===409) {
    await shown(page.getByText('Previous command was not applied to the hub. Current records refreshed. Review before trying again.',{exact:true}));
  }
  await page.waitForFunction(()=>{
    const signOut=[...document.querySelectorAll('button')].find(b=>b.textContent==='Sign out');
    return signOut && !signOut.disabled && !document.querySelector('div.notice.pending');
  });
  if(status===409) await refresh();
  await settled();
  if(result?.count) {
    const names={open:'Open',submitted:'Awaiting review',approved:'Approved',discarded:'Discarded'};
    await shown(details().getByRole('heading',{name:names[result.count.status],exact:true}));
  }
  return result;
}
async function start(key) {
  await page.getByRole('combobox',{name:'Count ingredient',exact:true}).selectOption('beans');
  const result=await ui(key,countsPath,()=>button('Start count').click());
  countIds[key]=result.count.id;
  await shown(details().getByText(result.count.id,{exact:true}));
  return result.count;
}
async function observe(key,count,amount,status=200) {
  await field('Counted quantity (g)').fill(amount);
  return ui(key,countsPath+'/'+count.id+'/observe',()=>button('Submit count').click(),status);
}
async function decide(key,count,reason,approve=true) {
  await field('Stock count reason').fill(reason);
  return ui(key,countsPath+'/'+count.id+'/decide',()=>button(approve?'Approve adjustment':'Discard count').click());
}
async function refresh() {
  const incoming=page.waitForResponse(r=>new URL(r.url()).pathname===countsPath && r.request().method()==='GET');
  await button('Refresh').click();
  assert.equal((await incoming).status(),200);
  await settled();
}
async function layout(name) {
  for(const [width,height] of [[375,667],[768,1024],[1280,800]]) {
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,name+' '+width+' overflow');
    await page.screenshot({path:'scratch/stock-count-'+name+'-'+width+'.png'});
  }
  console.log('PASS stock count '+name+' layout 375/768/1280');
}
const secret='Transport-Fixture-Device-Secret-32!';
async function staff(role,pin) {
  return (await call('/api/v1/auth/staff',{data:{accountId:'transport-'+role,pin,deviceId:'transport-'+role+'-tablet',deviceSecret:secret}})).token;
}
async function receipt(key,quantityMilli,totalCostCentavos) {
  return mutate(key,manager,'/api/v1/inventory/receipts',{ingredientId:'beans',quantityMilli,totalCostCentavos,reference:'Synthetic stock count rehearsal '+key});
}
async function waste(key,token,quantityMilli) {
  return mutate(key,token,'/api/v1/waste',{ingredientId:'beans',quantityMilli,reason:'Synthetic inventory rehearsal',note:key});
}
async function order(key,token) {
  const created=await mutate(key+'Create',token,'/api/v1/orders',{dineIn:true,table:'T1',items:[{productId:'fixture-latte',quantity:1,note:'Synthetic count rehearsal'}]});
  orderIds.push(created.order.id);
  const sent=await mutate(key+'Send',token,'/api/v1/orders/'+created.order.id+'/send',{expectedVersion:created.order.version});
  return (await mutate(key+'Pay',token,'/api/v1/orders/'+created.order.id+'/payments',{
    expectedVersion:sent.order.version,method:'cash',verified:true,amountCentavos:16500,cashReceivedCentavos:20000,
  })).order;
}
async function ready(key,token,order) {
  return mutate(key,token,'/api/v1/orders/'+order.id+'/ready',{expectedVersion:order.version});
}
try {
  await page.goto(target,{waitUntil:'domcontentloaded'});
  await signIn();
  const cashier=await staff('cashier','4826');
  const barista=await staff('barista','5937');
  await call(countsPath,{token:cashier,status:403});
  await call(countsPath,{token:barista,status:403});
  await mutate('openShift',cashier,'/api/v1/shifts/open',{openingCashCentavos:100000});
  await nav('Inventory');
  const stale=await start('staleCount');
  await waste('staleWaste',barista,1000);
  await receipt('staleReceipt',1000,80);
  await observe('staleObserve',stale,'999',409);
  await shown(details().getByText('Stock changed before this count was submitted. Discard it and start a fresh count.',{exact:true}));
  await layout('stale');
  await decide('discard',stale,'Stock moved during the measurement',false);
  const negative=await start('negativeCount');
  const first=await order('first',cashier);
  await observe('negativeObserve',negative,'990');
  await ready('firstReady',barista,first);
  await receipt('concurrentReceipt',200000,16000);
  await refresh();
  await shown(details().locator('.cash-lines > div').filter({has:page.getByText('On hand after approval',{exact:true})}).getByText('1,172 g',{exact:true}));
  await layout('negative-review');
  await decide('negativeApprove',negative,'Physical count variance confirmed');
  assert.equal((await call('/api/v1/ingredients',{token:manager})).ingredients.find(i=>i.id==='beans').onHandMilli,1172000);
  console.log('PASS accepted count preserved post-observation receipt, preparation and reservations');
  const positive=await start('positiveCount');
  await observe('positiveObserve',positive,'1182');
  await decide('positiveApprove',positive,'Extra stock found in storage');
  await shown(page.getByText('Additional stock cost pending',{exact:true}));
  await layout('cost-pending');
  const unknown=await order('unknown',cashier);
  await ready('unknownReady',barista,unknown);
  await waste('unknownWaste',barista,2000);
  await refresh();
  await field('Additional stock cost (PHP)').fill('8');
  await field('Cost reference').fill('Synthetic gain cost evidence');
  dropPath=countsPath+'/'+positive.id+'/confirm-cost';
  await button('Confirm count cost').click();
  await shown(button('Retry previous command'));
  assert.ok(droppedId);
  commands.confirmCost=droppedId;
  await layout('uncertain-cost');
  await page.reload({waitUntil:'domcontentloaded'});
  await signIn();
  await shown(page.getByText('Previous command confirmed by the hub. Current records refreshed.',{exact:true}));
  assert.equal(await button('Retry previous command').count(),0);
  await nav('Inventory');
  await page.getByRole('listitem',{name:'Stock count '+positive.id,exact:true}).getByRole('button',{name:'View count',exact:true}).click();
  await shown(field('Current stock value (PHP)'));
  await field('Current stock value (PHP)').fill('929.60');
  await field('Valuation reference').fill('Synthetic stale whole balance');
  await receipt('beforeRevalue',20000,1600);
  await ui('staleRevalue',countsPath+'/'+positive.id+'/revalue',()=>button('Confirm current stock value').click(),409);
  await shown(details().locator('.cash-lines > div').filter({has:page.getByText('Current on hand',{exact:true})}).getByText('1,182 g',{exact:true}));
  await field('Current stock value (PHP)').fill('945.60');
  await field('Valuation reference').fill('Synthetic current whole balance evidence');
  await ui('revalue',countsPath+'/'+positive.id+'/revalue',()=>button('Confirm current stock value').click());
  await shown(details().getByText('₱945.60',{exact:true}));
  await layout('confirmed-value');
  const known=await order('known',cashier);
  await ready('knownReady',barista,known);
  await refresh();
  await nav('Sales & margin');
  await shown(page.getByRole('region',{name:'Sales by day',exact:true}));
  await shown(page.getByText('₱495.00',{exact:true}).first());
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const sales=await call('/api/v1/admin/sales?from='+day+'&through='+day,{token:manager});
  assert.equal(sales.ordersWithUnknownIngredientCost,1);
  assert.equal(sales.wasteEntriesWithUnknownCost,1);
  assert.equal(sales.stockLossCostCentavos,800);
  assert.equal(sales.stockLossEntriesWithUnknownCost,0);
  await shown(page.getByText('Stock loss cost',{exact:true}));
  await layout('historic-cost-flags');
  const shift=(await call('/api/v1/shifts/current',{token:cashier})).shift;
  await mutate('countShift',cashier,'/api/v1/shifts/'+shift.id+'/submit-count',{expectedVersion:shift.version,countedCashCentavos:149500,note:'Synthetic count rehearsal closed'});
  await nav('Shift review');
  await shown(page.getByText('₱1,495.00',{exact:true}).first());
  const incoming=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/shifts/'+shift.id+'/review' && r.request().method()==='POST');
  await button('Approve close').click();
  const closed=await incoming;
  assert.equal(closed.status(),200);
  commands.closeShift=closed.request().postDataJSON().commandId;
  assert.equal((await closed.json()).varianceCentavos,0);
  const outgoing=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/logout' && r.request().method()==='POST');
  await button('Sign out').click();
  assert.equal((await outgoing).status(),204);
  await call(countsPath,{token:manager,status:401});
  await call('/api/v1/auth/logout',{token:cashier,data:{},status:204});
  await call('/api/v1/auth/logout',{token:barista,data:{},status:204});
  assert.deepEqual(errors,[]);
  console.log('PASS F04-03 admin count, conflict, preserved movement, pending-cost recovery, prospective revaluation and closure',
    JSON.stringify({countIds,orderIds,shiftId:shift.id,commands}));
} catch(error) {
  await page.screenshot({path:'scratch/stock-count-browser-failure.png',fullPage:true});
  console.log('COUNT BROWSER FAILURE',error.message);
  console.log((await page.locator('body').innerText()).slice(0,12000));
  throw error;
} finally { await browser.close(); }
'@
    node .agents/skills/playwright-skill/run.js -e $audit
    $auditExit = $LASTEXITCODE
} finally {
    $env:URL = $previousTarget
    $env:KAPE_DOZ_COUNT_TEST_HUB = $previousHub
    Pop-Location
}
exit $auditExit
