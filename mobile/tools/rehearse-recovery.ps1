param(
    [Parameter(Mandatory)][uri]$StaffUrl,
    [Parameter(Mandatory)][uri]$FixtureHubUrl,
    [switch]$Terminal
)

$ErrorActionPreference = 'Stop'
if (-not $StaffUrl.IsLoopback -or -not $FixtureHubUrl.IsLoopback) {
    throw 'Use a local staff preview and a fresh synthetic fixture hub.'
}
$previousTarget = $env:URL
$previousHub = $env:KAPE_DOZ_TEST_RECOVERY_HUB
$previousTerminal = $env:KAPE_DOZ_TEST_TERMINAL_RECOVERY
Push-Location (Join-Path $PSScriptRoot '..\..')
try {
    $env:URL = $StaffUrl.AbsoluteUri
    $env:KAPE_DOZ_TEST_RECOVERY_HUB = $FixtureHubUrl.GetLeftPart([UriPartial]::Authority)
    $env:KAPE_DOZ_TEST_TERMINAL_RECOVERY = if ($Terminal) { '1' } else { '0' }
    $audit = @'
const assert = require('node:assert/strict');
const target = await helpers.resolveTargetUrl();
assert.ok(target);
const hub = process.env.KAPE_DOZ_TEST_RECOVERY_HUB;
const terminal=process.env.KAPE_DOZ_TEST_TERMINAL_RECOVERY==='1';
const {randomUUID}=require('node:crypto');
const browser = await chromium.launch({channel:'chrome',headless:true});
const unexpected=[];
const expectedRejections=[];
const audit = async (page, role) => {
  for (const [width,height] of [[375,667],[768,1024],[1280,800]]) {
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,role+' overflow '+width);
    await page.screenshot({path:'scratch/recovery-'+role+'-'+width+'.png'});
    console.log('PASS '+role+' layout '+width);
  }
};
const button=(p,name)=>p.getByRole('button',{name,exact:true});
const field=(p,name)=>p.getByRole('textbox',{name,exact:true});
async function enter(page,name,value) {
  await field(page,name).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(value);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function login(page,role,pin) {
  await enter(page,'Account ID','transport-'+role);
  await enter(page,'PIN',pin);
  await button(page,'Sign in').click();
}
async function setup(role,pin) {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>unexpected.push(error.message));
  page.on('console',message=>{
    const location=message.location().url;
    if(message.type()==='error' && terminal && location===hub+'/api/v1/shifts/open' && message.text().includes('409')) {
      expectedRejections.push(message.text());
    } else if (message.type()==='error' && !(message.text().includes('net::ERR_FAILED') && location===hub+'/api/v1/shifts/open')) {
      unexpected.push(message.text()+' '+location);
    }
  });
  await page.goto(target,{waitUntil:'domcontentloaded'});
  const toggle=page.locator('flt-semantics-placeholder');
  await toggle.waitFor({state:'attached',timeout:45000});
  await toggle.dispatchEvent('click');
  await enter(page,'Hub address',hub);
  await enter(page,'Enrolled device ID','transport-'+role+'-tablet');
  await enter(page,'Device key','Transport-Fixture-Device-Secret-32!');
  await button(page,'Connect').click();
  await login(page,role,pin);
  return page;
}
try {
  const cashier=await setup('cashier','4826');
  await button(cashier,'Open shift').waitFor();
  let postCount=0;
  let accepted;
  let original;
  let authorization;
  const endpoint=hub+'/api/v1/shifts/open';
  await cashier.route(endpoint,async route=>{
    if(route.request().method()!=='POST') return route.continue();
    postCount++;
    authorization=route.request().headers().authorization;
    if(terminal && postCount>1) return route.continue();
    original=route.request().postDataJSON();
    const response=await route.fetch(terminal ? {postData:JSON.stringify({...original,commandId:randomUUID()})} : {});
    assert.equal(response.status(),200);
    accepted=await response.json();
    await route.abort('failed');
  });
  await button(cashier,'Open shift').click();
  await enter(cashier,'Opening cash (PHP)','1000');
  await button(cashier,'Open shift').last().click();
  await button(cashier,'Back').click();
  await button(cashier,'Retry previous action').waitFor();
  assert.equal(postCount,1);
  assert.equal(accepted.shift.openingCashCentavos,100000);
  await audit(cashier,'pending');
  await button(cashier,'Sign out').click();
  await cashier.getByText('Sign in with the original account to resolve a saved operation.',{exact:true}).waitFor();
  const savedId=terminal ? original.commandId : accepted.commandId;
  const status=cashier.waitForResponse(r=>r.url()===hub+'/api/v1/commands/'+savedId);
  await login(cashier,'cashier','4826');
  const lookup=await status;
  assert.equal(lookup.status(),200);
  assert.equal((await lookup.json()).status,terminal?'unrecorded':'accepted');
  if(terminal) {
    const rejected=cashier.waitForResponse(async r=>r.url()===hub+'/api/v1/commands/'+savedId && r.request().method()==='GET' && (await r.json()).status==='rejected');
    await button(cashier,'Retry previous action').click();
    const rejection=await rejected;
    const body=await rejection.json();
    assert.equal(rejection.status(),200);
    assert.equal(body.status,'rejected');
    assert.equal(body.action,'shift.open');
    assert.equal(body.error.code,'conflict');
    await cashier.getByText(/Previous operation was not applied/).waitFor();
    const delayed=await cashier.request.post(endpoint,{headers:{authorization},data:original});
    assert.equal(delayed.status(),409);
    const repeated=await cashier.request.get(hub+'/api/v1/commands/'+savedId,{headers:{authorization}});
    assert.deepEqual(await repeated.json(),body);
    assert.equal(postCount,2);
    assert.equal(expectedRejections.length,1);
    console.log('PASS terminal stale command recovered with delayed retry fenced '+JSON.stringify({commandId:savedId,acceptedCommandId:accepted.commandId,shiftId:accepted.shift.id,rejection:body}));
  }
  await button(cashier,'Shift closing').waitFor();
  await button(cashier,'Retry previous action').waitFor({state:'hidden'});
  assert.equal(postCount,terminal?2:1);
  if(!terminal) console.log('PASS rendered cashier recovered committed shift without duplicate POST '+JSON.stringify({commandId:accepted.commandId,shiftId:accepted.shift.id}));
  await audit(cashier,'cashier');
  const barista=await setup('barista','5937');
  await barista.getByText('Active orders · 0',{exact:true}).waitFor();
  assert.equal(await button(barista,'Shift closing').count(),0);
  await audit(barista,'barista');
  await button(barista,'Sign out').click();
  await button(barista,'Sign in').waitFor();
  await button(cashier,'Sign out').click();
  await button(cashier,'Sign in').waitFor();
  assert.deepEqual(unexpected,[]);
  console.log('PASS separate roles, sign-out and zero unexpected page or console errors');
} finally {await browser.close();}
'@
    node .agents/skills/playwright-skill/run.js -e $audit
    $auditExit = $LASTEXITCODE
} finally {
    $env:URL = $previousTarget
    $env:KAPE_DOZ_TEST_RECOVERY_HUB = $previousHub
    $env:KAPE_DOZ_TEST_TERMINAL_RECOVERY = $previousTerminal
    Pop-Location
}
exit $auditExit
