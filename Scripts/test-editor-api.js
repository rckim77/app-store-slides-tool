const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../Editor/public/editor.js"), "utf8");
const apiSource = source.slice(source.indexOf("async function api("), source.indexOf("\nfunction setBusy("));
const context = vm.createContext({window:{location:{port:"4323"}}});
vm.runInContext(apiSource, context);
async function main() {
  let calls = 0;
  context.fetch = async () => { calls += 1; throw new TypeError("Failed to fetch"); };
  await assert.rejects(vm.runInContext("api('/api/preview',{method:'POST'})",context), /Cannot reach the local editor server on port 4323\. Restart it, then try again/);
  assert.equal(calls,1,"Failed writes must not be retried automatically");
  context.fetch = async () => ({ok:false,status:400,json:async()=>({error:"captionPosition must be top or bottom"})});
  await assert.rejects(vm.runInContext("api('/api/preview')",context), /captionPosition must be top or bottom/);
  context.fetch = async (_, options) => {
    assert.equal(options.method,"POST");
    assert.equal(options.headers["Content-Type"],"application/json");
    return {ok:true,json:async()=>({captionPosition:"bottom"})};
  };
  const result = await vm.runInContext("api('/api/preview',{method:'POST'})",context);
  assert.equal(result.captionPosition,"bottom","Requests must recover once the server is reachable");
  console.log("Editor API checks passed: connection guidance, server errors and reconnection");
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
