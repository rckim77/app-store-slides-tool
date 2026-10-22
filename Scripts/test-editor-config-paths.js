const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../Editor/server.js'),'utf8');
const context=vm.createContext({require,process:{argv:['node','server.js'],env:{}},__dirname:path.join(__dirname,'../Editor'),console,Buffer,URL});
vm.runInContext(source.slice(0,source.lastIndexOf('\ntry {\n')),context);
const run=s=>vm.runInContext(s,context);
assert.equal(run(`resolveFromConfig('/tmp/project/configs/iphone.json','~/Desktop/Screenshots')`),path.join(os.homedir(),'Desktop/Screenshots'));
assert.equal(run(`resolveFromConfig('/tmp/project/configs/iphone.json','../inputs')`),'/tmp/project/inputs');
assert.equal(run(`resolveFromConfig('/tmp/project/configs/iphone.json','/tmp/exports')`),'/tmp/exports');
run(`readConfig=()=>({defaultLocale:'en_US',slides:[{captions:{en_US:'Hello',fr:'Bonjour'}}]});`);
assert.equal(run(`localeFromConfigPath('/tmp/configs/iphone-en_US.json')`),'en_US');
assert.equal(run(`localeFromConfigPath('/tmp/configs/fr.json')`),'fr');
assert.equal(run(`localeFromConfigPath('/tmp/configs/en_US.json')`),'en_US');
console.log('Editor config compatibility: home, relative and absolute paths; device-prefixed and locale-only config names passed');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'configured-slides-'));
try {
 fs.writeFileSync(path.join(temp,'old.png'),'old');
 fs.writeFileSync(path.join(temp,'current.png'),'current');
 context.fixtureConfig={defaultLocale:'en_US',background:{color:'#fff'},devices:{iphone:{}},slides:[{id:'current',captions:{en_US:'Current'}}]};
 context.fixtureDir=temp;
 run("slideEntry=(_,slide)=>({id:slide.id});");
 assert.equal(run("slidesForDeviceDir(fixtureConfig,fixtureDir,'en_US','iphone',true).length"),1);
 assert.equal(run("slidesForDeviceDir(fixtureConfig,fixtureDir,'en_US','iphone',false).length"),2);
} finally {fs.rmSync(temp,{recursive:true,force:true});}
