param([Parameter(Mandatory)][uri]$StaffUrl,[Parameter(Mandatory)][uri]$PortalUrl,[Parameter(Mandatory)][uri]$FixtureHubUrl)
$ErrorActionPreference='Stop'
if (-not $StaffUrl.IsLoopback -or -not $PortalUrl.IsLoopback -or -not $FixtureHubUrl.IsLoopback) { throw 'Use isolated loopback fixtures.' }
$previous=@($env:URL,$env:KAPE_DOZ_TEST_APPROVAL_HUB,$env:KAPE_DOZ_TEST_APPROVAL_PORTAL)
Push-Location (Join-Path $PSScriptRoot '..\..')
try {
  $env:URL=$StaffUrl.AbsoluteUri
  $env:KAPE_DOZ_TEST_APPROVAL_HUB=$FixtureHubUrl.GetLeftPart([UriPartial]::Authority)
  $env:KAPE_DOZ_TEST_APPROVAL_PORTAL=$PortalUrl.AbsoluteUri
  $source=Get-Content -LiteralPath 'mobile/tools/rehearse-approvals.ps1' -Raw
  $match=[regex]::Match($source,'(?s)\$common=@''\r?\n(.*?)\r?\n''@')
  if (!$match.Success) { throw 'The shared staff rehearsal helpers could not be loaded.' }
  $common=$match.Groups[1].Value
  $scenario=@'
const manager=await browser.newPage({viewport:{width:1280,height:900}});
watch(manager);
await manager.goto(portal,{waitUntil:'domcontentloaded'});
await manager.getByLabel('Account ID',{exact:true}).fill('transport-manager');
await manager.getByLabel('Password',{exact:true}).fill('Transport-Fixture-Manager-Password!');
const logged=manager.waitForResponse(r=>r.url().endsWith('/api/v1/auth/admin')&&r.request().method()==='POST');
await button(manager,'Sign in').click();
const login=await logged;
assert.equal(login.status(),200);
const managerToken=(await login.json()).token;
await manager.getByRole('navigation').getByRole('button',{name:'Inventory',exact:true}).click();
const thresholds=manager.getByRole('region',{name:'Stock thresholds',exact:true});
await thresholds.waitFor();
await thresholds.getByLabel('Disable low-stock threshold',{exact:true}).uncheck();
await thresholds.getByLabel('Low stock threshold (g)',{exact:true}).fill('1000');
await thresholds.getByLabel('Threshold change reason',{exact:true}).fill('Synthetic alert threshold');
const thresholdResponse=manager.waitForResponse(r=>r.url().endsWith('/api/v1/inventory/thresholds/beans')&&r.request().method()==='POST');
await button(manager,'Save threshold').click();
assert.equal((await thresholdResponse).status(),200);
await manager.getByText('Low-stock threshold saved. Current conditions have been evaluated.',{exact:true}).waitFor();
await manager.getByRole('heading',{name:'Fixture espresso beans · Low stock',exact:true}).waitFor();
await manager.getByLabel('Acknowledgment note',{exact:true}).fill('Synthetic receiving follow-up');
const acknowledged=manager.waitForResponse(r=>r.url().endsWith('/acknowledge')&&r.request().method()==='POST');
await button(manager,'Acknowledge alert').click();
const ack=await acknowledged;
assert.equal(ack.status(),200);
const alert=(await ack.json()).alert;
assert.equal(alert.status,'acknowledged');
await manager.getByText('Acknowledged · Still active',{exact:true}).first().waitFor();
const api=manager.request;
const send=async(path,token,data)=>{
  const response=await api.post(hub+path,{headers:{Authorization:'Bearer '+token},data:{commandId:randomUUID(),...data}});
  assert.equal(response.status(),200,path+' '+await response.text());
  return response.json();
};
const staffAuth=await api.post(hub+'/api/v1/auth/staff',{data:{accountId:'transport-barista',pin:'5937',deviceId:'transport-barista-tablet',deviceSecret:'Transport-Fixture-Device-Secret-32!'}});
assert.equal(staffAuth.status(),200);
const baristaToken=(await staffAuth.json()).token;
await send('/api/v1/waste',baristaToken,{ingredientId:'beans',quantityMilli:990000,reason:'Synthetic alert rehearsal',note:'Create shortage fixture'});
const cashier=await staff('cashier','4826');
await button(cashier,'Open shift').click();
await enter(cashier,'Opening cash (PHP)','1000');
await button(cashier,'Open shift').last().click();
await cashier.getByRole('button',{name:/Fixture Latte.*Add/}).click();
await button(cashier,'Add to order').click();
await text(cashier,'Recorded stock is short').waitFor();
await text(cashier,'Fixture espresso beans: short 8 g').waitFor();
const created=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
await button(cashier,'Create order').click();
const order=(await (await created).json()).order;
assert.equal(order.shortages[0].shortfallMilli,8000);
const sent=cashier.waitForResponse(r=>r.url().endsWith('/orders/'+order.id+'/send')&&r.request().method()==='POST');
await button(cashier,'Send to bar').click();
assert.equal((await sent).status(),200);
const barista=await staff('barista','5937');
await text(barista,'Active orders · 1').waitFor();
await text(barista,'Fixture espresso beans: short 8 g').waitFor();
await responsive(barista,'barista-shortage');
const ready=barista.waitForResponse(r=>r.url().endsWith('/orders/'+order.id+'/ready')&&r.request().method()==='POST');
await button(barista,'Mark ready').click();
assert.equal((await ready).status(),200);
await text(barista,'Active orders · 0').waitFor();
await button(cashier,'Refresh').click();
await button(cashier,'Take payment').click();
await enter(cashier,'Cash received (PHP)','200');
const payment=cashier.waitForResponse(r=>r.url().endsWith('/orders/'+order.id+'/payments')&&r.request().method()==='POST');
await button(cashier,'Confirm payment').click();
assert.equal((await payment).status(),200);
await button(cashier,'Return to cashier').click();
await button(manager,'Refresh alerts').click();
await manager.getByText('Acknowledged · Still active',{exact:true}).first().waitFor();
const listing=await api.get(hub+'/api/v1/inventory/alerts?status=active',{headers:{Authorization:'Bearer '+managerToken}});
const active=(await listing.json()).alerts;
assert.equal(active.filter(a=>a.kind==='shortage').length,1);
assert.equal(active.find(a=>a.id===alert.id).status,'acknowledged');
await send('/api/v1/inventory/receipts',managerToken,{ingredientId:'beans',quantityMilli:100000,totalCostCentavos:8000,reference:'Synthetic replenishment'});
await button(manager,'Refresh alerts').click();
await manager.getByRole('combobox',{name:'Alert status',exact:true}).selectOption('resolved');
await manager.getByText('Stock recovered',{exact:true}).first().waitFor();
await thresholds.getByLabel('Disable low-stock threshold',{exact:true}).check();
await thresholds.getByLabel('Threshold change reason',{exact:true}).fill('Synthetic threshold cleared');
const cleared=manager.waitForResponse(r=>r.url().endsWith('/api/v1/inventory/thresholds/beans')&&r.request().method()==='POST');
await button(manager,'Save threshold').click();
assert.equal((await cleared).status(),200);
await manager.getByText('Low-stock threshold cleared. Shortage monitoring remains active.',{exact:true}).waitFor();
const thresholdHistory=manager.getByRole('region',{name:'Threshold change history',exact:true});
await thresholdHistory.getByText('Synthetic threshold cleared',{exact:true}).waitFor();
await thresholdHistory.getByText('Synthetic alert threshold',{exact:true}).waitFor();
const history=await api.get(hub+'/api/v1/inventory/thresholds/beans/history',{headers:{Authorization:'Bearer '+managerToken}});
const changes=(await history.json()).events;
assert.deepEqual(changes.map(item=>[item.previousMilli,item.thresholdMilli,item.reason]),[
  [1000000,null,'Synthetic threshold cleared'],[null,1000000,'Synthetic alert threshold'],
]);
await responsive(manager,'manager-alerts');
await button(cashier,'Shift closing').click();
await enter(cashier,'Counted cash (PHP)','1165');
await button(cashier,'Submit count').click();
await manager.getByRole('navigation').getByRole('button',{name:'Shift review',exact:true}).click();
await button(manager,'Approve close').click();
await manager.getByText('Shift closed.',{exact:true}).waitFor();
await button(manager,'Sign out').click();
await button(cashier,'Sign out').click();
await button(barista,'Sign out').click();
assert.deepEqual(errors,[]);
console.log('PASS inventory alerts and nonblocking shortage across manager, cashier and barista',JSON.stringify({orderId:order.id,alertId:alert.id}));
'@
  $ending=@'
} catch(error) {
  for(const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()) {
    console.log('DIAGNOSTIC '+index+' '+await page.locator('body').ariaSnapshot());
    await page.screenshot({path:'scratch/inventory-alert-failure-'+index+'.png'});
  }
  throw error;
} finally { await browser.close(); }
'@
  $audit=@($common,'try {',$scenario,$ending) -join "`n"
  node .agents/skills/playwright-skill/run.js -e $audit
  $status=$LASTEXITCODE
} finally {
  $env:URL=$previous[0]; $env:KAPE_DOZ_TEST_APPROVAL_HUB=$previous[1]; $env:KAPE_DOZ_TEST_APPROVAL_PORTAL=$previous[2]
  Pop-Location
}
exit $status
