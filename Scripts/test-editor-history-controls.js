const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../Editor/public/editor.js'),'utf8');
const names = ['snapshotKey','resetHistory','pushHistorySnapshot','undoEdit','redoEdit'];
const context = vm.createContext({console,Map});
vm.runInContext(`let historyStack=[],redoStack=[],historySetId=null,activeSetId='set',activeSlideId='first';const slideBaselines=new Map();let current={setId:'set',slideId:'first',captionText:'Original'};let shouldFail=false;const calls=[];function currentSnapshot(){return {...current};}function activeSet(){return {editable:true};}function updateHistoryButtons(){}function setBusy(){}function showToast(message){calls.push(message);}async function applySnapshot(snapshot){if(shouldFail)throw new Error('failed');current={...snapshot};slideBaselines.set(current.slideId,currentSnapshot());calls.push(snapshot.captionText);}async function applyStructureHistory(entry,redo){if(shouldFail)throw new Error('failed');calls.push(redo?'redo structure':'undo structure');}`,context);
for (const name of names) {
 const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
 const remainder=source.slice(start+1);const offset=remainder.search(/\n(?:async )?function /);
 vm.runInContext(source.slice(start,offset<0?source.length:start+1+offset),context);
}
const run=code=>vm.runInContext(code,context);
(async()=>{
 run(`resetHistory();current.captionText='Edited';pushHistorySnapshot(currentSnapshot());activeSlideId='second';current={setId:'set',slideId:'second',captionText:'Second'};resetHistory();current.captionText='Changed second';pushHistorySnapshot(currentSnapshot());`);
 await run('undoEdit()');assert.equal(run('current.captionText'),'Second');
 await run('undoEdit()');assert.equal(run('current.captionText'),'Original');
 await run('redoEdit()');assert.equal(run('current.captionText'),'Edited');
 run(`historyStack.push({...currentSnapshot(),structureChange:{token:'test',present:true}});redoStack=[];`);
 await run('undoEdit()');assert.equal(run('calls.at(-1)'),'undo structure');
 await run('redoEdit()');assert.equal(run('calls.at(-1)'),'redo structure');
 run('shouldFail=true');const length=run('historyStack.length');
 await run('undoEdit()');assert.equal(run('historyStack.length'),length,'Failed undo must remain retryable');
 run('shouldFail=false');await run('undoEdit()');
 run(`current.captionText='New branch';pushHistorySnapshot(currentSnapshot());`);
 assert.equal(run('redoStack.length'),0);
 console.log('History controls: edits across slides, duplicate/delete dispatch, retryable failure and redo invalidation passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
