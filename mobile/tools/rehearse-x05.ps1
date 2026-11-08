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
const owner=await browser.newPage({viewport:{width:1280,height:900}});
watch(owner);
await owner.goto(portal,{waitUntil:'domcontentloaded'});
await owner.getByLabel('Account ID',{exact:true}).fill('transport-owner');
await owner.getByLabel('Password',{exact:true}).fill('Transport-Fixture-Owner-Password!');
const ownerLogin=owner.waitForResponse(r=>r.url().endsWith('/api/v1/auth/admin')&&r.request().method()==='POST');
await button(owner,'Sign in').click();
assert.equal((await ownerLogin).status(),200);

const ingredientId='beans-x05';
const productId='cold-brew-x05';
await owner.getByRole('navigation').getByRole('button',{name:'Setup & recovery',exact:true}).click();
await owner.getByRole('heading',{name:'Setup & recovery',exact:true,level:1}).waitFor();

const csvText=[
  'Handle,Item name,Price,IngredientId,IngredientName,Unit,RecipeQuantityMilli',
  `${productId},Cold Brew X05,180.00,${ingredientId},Coffee Beans X05,g,25000`,
].join('\n');
await owner.getByLabel('CSV content',{exact:true}).fill(csvText);
const previewedCsv=owner.waitForResponse(r=>r.url().endsWith('/api/v1/csv/preview')&&r.request().method()==='POST');
await button(owner,'Preview CSV import').click();
assert.equal((await previewedCsv).status(),200);
await button(owner,'Execute confirmed CSV import').waitFor();
const importedCsv=owner.waitForResponse(r=>r.url().endsWith('/api/v1/csv/import')&&r.request().method()==='POST');
await button(owner,'Execute confirmed CSV import').click();
assert.equal((await importedCsv).status(),200);
await owner.getByText('Loyverse catalog CSV import executed.',{exact:true}).waitFor();

const setOfflineResp=owner.waitForResponse(r=>r.url().endsWith('/api/v1/sync/mode')&&r.request().method()==='POST');
await button(owner,'Cloud mode: offline').click();
assert.equal((await setOfflineResp).status(),200);
await owner.getByText('Cloud sync mode set to offline.',{exact:true}).waitFor();

const setPrinterTimeout=owner.waitForResponse(r=>r.url().endsWith('/api/v1/printers/mode')&&r.request().method()==='POST');
await button(owner,'Set receipt unknown').click();
assert.equal((await setPrinterTimeout).status(),200);
await owner.getByText('Receipt printer mode set to Timeout (unknown).',{exact:true}).waitFor();

await owner.getByRole('navigation').getByRole('button',{name:'Inventory',exact:true}).click();
await owner.getByRole('heading',{name:'Inventory',exact:true,level:1}).waitFor();
await owner.locator('section.panel').filter({hasText:'Receive stock'}).locator('select[name=ingredient]').selectOption(ingredientId);
await owner.getByLabel('Quantity in ingredient units',{exact:true}).fill('5000');
await owner.getByLabel('Total received cost (PHP)',{exact:true}).fill('1000.00');
await owner.getByLabel('Receipt reference',{exact:true}).fill('SYNTHETIC-X05-RECEIPT');
const createdRec=owner.waitForResponse(r=>r.url().endsWith('/api/v1/inventory/receipts')&&r.request().method()==='POST');
await button(owner,'Save stock receipt').click();
assert.equal((await createdRec).status(),200);
await owner.getByText('Stock receipt saved.',{exact:true}).waitFor();

const cashier=await staff('cashier','4826');
const barista=await staff('barista','5937');
await button(cashier,'Open shift').click();
await enter(cashier,'Opening cash (PHP)','1000');
const openedShift=cashier.waitForResponse(r=>r.url().endsWith('/api/v1/shifts/open')&&r.request().method()==='POST');
await button(cashier,'Open shift').last().click();
assert.equal((await openedShift).status(),200);

await cashier.getByRole('button',{name:/Cold Brew X05.*Add/}).click();
await button(cashier,'Add to order').click();
const createdO1=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders'&&r.request().method()==='POST');
await button(cashier,'Create order').click();
const order1=(await (await createdO1).json()).order;

const sentO1=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/send'&&r.request().method()==='POST');
await button(cashier,'Send to bar').click();
assert.equal((await sentO1).status(),200);

await button(cashier,'Take payment').click();
await enter(cashier,'Cash received (PHP)','100');
const paidCash=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/payments'&&r.request().method()==='POST');
await button(cashier,'Confirm payment').click();
assert.equal((await paidCash).status(),200);

await button(cashier,'Payment method Cash').click();
await cashier.getByRole('menuitem',{name:'GCash',exact:true})
  .or(cashier.getByRole('button',{name:'GCash',exact:true})).first().click();
await enter(cashier,'Payment amount (PHP)','80');
await enter(cashier,'Merchant reference','GCASH-X05-SPLIT');
await cashier.getByRole('checkbox',{name:'I verified success in the merchant app or terminal'}).click();
const paidGcash=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/payments'&&r.request().method()==='POST');
await button(cashier,'Confirm payment').click();
assert.equal((await paidGcash).status(),200);

const firstPrintResp=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/receipt'&&r.request().method()==='POST');
await button(cashier,'Print receipt').click();
const firstPrintJob=(await (await firstPrintResp).json()).job;
assert.equal(firstPrintJob.status,'unknown');
await text(cashier,'Printer timed out (status unknown). Check printer before retrying.').waitFor();

await owner.getByRole('navigation').getByRole('button',{name:'Setup & recovery',exact:true}).click();
await owner.getByRole('heading',{name:'Setup & recovery',exact:true,level:1}).waitFor();
const setPrinterOk=owner.waitForResponse(r=>r.url().endsWith('/api/v1/printers/mode')&&r.request().method()==='POST');
await button(owner,'Set receipt confirmed').click();
assert.equal((await setPrinterOk).status(),200);
await owner.getByText('Receipt printer mode set to Confirmed (simulated).',{exact:true}).waitFor();

const retryPrintResp=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/print-jobs/'+firstPrintJob.id+'/retry'&&r.request().method()==='POST');
await button(cashier,'Retry receipt print').click();
const retryPrintJob=(await (await retryPrintResp).json()).job;
assert.equal(retryPrintJob.status,'confirmed');
assert.equal(retryPrintJob.attempts,2);
assert.equal(retryPrintJob.originalJobId,firstPrintJob.id);
await text(cashier,'Receipt print confirmed (simulated).').waitFor();
await button(cashier,'Return to cashier').click();
await responsive(cashier,'x05-cashier');

await button(barista,'Refresh').click();
const ready1Resp=barista.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/ready'&&r.request().method()==='POST');
await button(barista,'Mark ready').click();
assert.equal((await ready1Resp).status(),200);

await button(barista,'Station history').click();
await button(barista,'Complete handover').waitFor();
const handover1Resp=barista.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/handover'&&r.request().method()==='POST');
await button(barista,'Complete handover').click();
assert.equal((await handover1Resp).status(),200);
await text(barista,'Order handed over saved by the hub.').waitFor();

const recallResp=barista.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/recall'&&r.request().method()==='POST');
await button(barista,'Recall order').click();
assert.equal((await recallResp).status(),200);
await button(barista,'Complete handover').waitFor();

const handover2Resp=barista.waitForResponse(r=>r.url()===hub+'/api/v1/orders/'+order1.id+'/handover'&&r.request().method()==='POST');
await button(barista,'Complete handover').click();
assert.equal((await handover2Resp).status(),200);
await text(barista,'Order handed over saved by the hub.').waitFor();
await responsive(barista,'x05-barista');

const setOnlineResp=owner.waitForResponse(r=>r.url().endsWith('/api/v1/sync/mode')&&r.request().method()==='POST');
await button(owner,'Cloud mode: online').click();
assert.equal((await setOnlineResp).status(),200);
await owner.getByText('Cloud sync mode set to online.',{exact:true}).waitFor();

const pushedOutbox=owner.waitForResponse(r=>r.url().endsWith('/api/v1/sync/push')&&r.request().method()==='POST');
await button(owner,'Push cloud outbox').click();
assert.equal((await pushedOutbox).status(),200);
await owner.getByText('Cloud outbox sync executed.',{exact:true}).waitFor();

const exportedBackup=owner.waitForResponse(r=>r.url().endsWith('/api/v1/admin/backup')&&r.request().method()==='GET');
await button(owner,'Export branch backup').click();
assert.equal((await exportedBackup).status(),200);

const restoredBackup=owner.waitForResponse(r=>r.url().endsWith('/api/v1/admin/restore')&&r.request().method()==='POST');
await button(owner,'Restore verified backup').click();
assert.equal((await restoredBackup).status(),200);
await owner.getByText('Database backup restored and verified.',{exact:true}).waitFor();
await responsive(owner,'x05-admin-setup');

await button(owner,'Sign out').click();
await button(cashier,'Sign out').click();
await button(barista,'Sign out').click();
assert.deepEqual(errors,[]);
console.log('PASS X05 Loyverse CSV import, offline outbox sync, printer timeout retry, barista recall/handover, and backup/restore '+JSON.stringify({
  orderId:order1.id,
  productId,
  ingredientId,
  printJobId:firstPrintJob.id,
}));
'@
  $ending=@'
} catch(error) {
  for(const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()) {
    console.log('DIAGNOSTIC '+index+' '+await page.locator('body').ariaSnapshot());
    await page.screenshot({path:'scratch/x05-failure-'+index+'.png'});
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
