import { readFile } from 'node:fs/promises';
import { test, expect } from './support/extension-fixture.mjs';
import { makeRichMdx } from '../tests/helpers/rich-mdict-fixture.mjs';
import { makeMdd } from '../tests/helpers/mdd-fixture.mjs';
import { BACKGROUND_MESSAGES as MSG } from '../src/shared/constants.js';
import { RICH_MDICT_OPFS_ROOT, RICH_MDICT_STATE_KEY } from '../src/background/packs/rich-mdict-contract.js';
const image = await readFile(new URL('../tests/fixtures/mdd-linked-package/sample.png', import.meta.url));
const local = (name, buffer) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(buffer) });
const attachments = [local('Recovery.mdd', makeMdd([['one.png', image]])), local('Recovery.1.mdd', makeMdd([['two.png', image]])),
  local('recovery.css', '.entry{color:#123456}'), local('recovery.png', image), local('recovery.js', 'window.__dictionaryScriptExecuted=true')];
const mdx = local('Recovery.mdx', makeRichMdx([['recoveryfixture', '<link href="recovery.css"><div class="entry">RESTART SIX FILE SENTINEL<img src="recovery.png"></div>']], { title: 'Recovery Fixture' }));
async function optionsPage(harness) { const page=await harness.context.newPage(); await page.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`); return page; }

test('six files ignore scripts and restart clears only abandoned staging before full resource reselection', async ({ harness }) => {
  test.setTimeout(180000); await harness.reset(); const external=[];
  const observe=page=>page.on('request', request=>{if(/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl)external.push(request.url());});
  let options=await optionsPage(harness);observe(options);
  await options.locator('#localDictionaryFiles').setInputFiles([mdx,...attachments]);
  await expect(options.locator('[data-role="ignored-scripts"]')).toHaveText('脚本已忽略，不执行。');
  await expect(options.locator('#localDictionaryImportButton')).toBeEnabled();await options.locator('#localDictionaryImportButton').click();
  await expect(options.locator('#localDictionaryImportProgress')).toHaveText('完成 · 富文本词典已安装', {timeout:60000});
  let row=options.locator('#richMdictInstalledList [data-dictionary-id]').filter({hasText:'Recovery Fixture'});
  await expect(row.locator('[data-role="resource-recovery"]')).toHaveCount(0);
  const listed=await options.evaluate(message=>chrome.runtime.sendMessage(message),{type:MSG.RICH_MDICT_LIST});
  const dictionary=listed.dictionaries.find(item=>item.title==='Recovery Fixture');expect(dictionary.resourceCount).toBe(2);expect(dictionary.sidecarCount).toBe(2);
  const resourceVersion='import-abandoned-12345678',requestId='browser-recovery-abandoned';
  const reserved=await options.evaluate(message=>chrome.runtime.sendMessage(message),{type:MSG.RICH_MDD_RESOURCE_PREFLIGHT,dictionaryId:dictionary.id,requestId,resourceVersion,
    mdxFileName:dictionary.fileName,mdxSourceBytes:dictionary.sourceSize,expectedMdxVersion:dictionary.packVersion,files:[{fileName:'Recovery.mdd',size:attachments[0].buffer.length}],sidecars:[]});
  expect(reserved.ok).toBe(true);
  await options.evaluate(async ({rootName,id,version})=>{const root=await navigator.storage.getDirectory();const packs=await root.getDirectoryHandle(rootName);
    const pack=await packs.getDirectoryHandle(id);const staged=await pack.getDirectoryHandle(version,{create:true});const file=await staged.getFileHandle('staged.bin',{create:true});const writer=await file.createWritable();await writer.write(Uint8Array.of(1));await writer.close();}, {rootName:RICH_MDICT_OPFS_ROOT,id:dictionary.id,version:resourceVersion});
  await harness.restartBrowser();options=await optionsPage(harness);observe(options);row=options.locator('#richMdictInstalledList [data-dictionary-id]').filter({hasText:'Recovery Fixture'});
  await expect(row.locator('[data-role="resource-recovery"]')).toContainText('本次更新未完成，原附件仍可用');
  const evidence=await options.evaluate(async ({stateKey,rootName,id,version})=>{const stored=(await chrome.storage.local.get(stateKey))[stateKey];let exists=true;
    try{const root=await navigator.storage.getDirectory();const packs=await root.getDirectoryHandle(rootName);const pack=await packs.getDirectoryHandle(id);await pack.getDirectoryHandle(version);}catch(error){if(error.name!=='NotFoundError')throw error;exists=false;}
    return {exists,reservations:Object.keys(stored.resourceReservations || {}),active:stored.packs[id].active};}, {stateKey:RICH_MDICT_STATE_KEY,rootName:RICH_MDICT_OPFS_ROOT,id:dictionary.id,version:resourceVersion});
  expect(evidence.exists).toBe(false);expect(evidence.reservations).toEqual([]);expect(evidence.active.resources.sources).toHaveLength(2);
  expect(JSON.stringify(evidence.active)).not.toContain('recovery.js');
  await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles(attachments);
  await expect(row.locator('[data-role="mdd-resource-progress"]')).toContainText('脚本已忽略，不执行', {timeout:60000});
  await expect(row.locator('[data-role="resource-recovery"]')).toHaveCount(0);await options.close();
  await harness.restartBrowser();const page=await harness.open('/selection');observe(page);await harness.inject(page);
  await page.evaluate(()=>{const node=document.createElement('p');node.id='recovery-word';node.textContent='recoveryfixture';document.body.append(node);});
  await page.locator('#recovery-word').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,view:window}));});
  await expect(page.locator('.tf-selection-chip')).toBeVisible();await page.locator('.tf-selection-chip').click();
  const card=page.locator('.tf-selection-rich-record').filter({hasText:'Recovery Fixture'});if(!await card.evaluate(node=>node.open))await card.locator('summary').first().click();
  await expect(card).toHaveAttribute('data-state','success',{timeout:30000});await expect(card.locator('.entry')).toContainText('RESTART SIX FILE SENTINEL');
  await expect(card.locator('img[src^="blob:"]')).toHaveCount(1);
  expect(await page.evaluate(()=>Boolean(window.__dictionaryScriptExecuted))).toBe(false);expect(external).toEqual([]);expect(harness.server.calls).toHaveLength(0);
});
