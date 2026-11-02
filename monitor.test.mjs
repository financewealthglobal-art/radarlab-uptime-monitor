import test from "node:test";
import assert from "node:assert/strict";
import { checkMonitor } from "./monitor.mjs";
const webhook = "https://discord.com/api/webhooks/000000000000000001/fictional-token";
const now = new Date("2026-11-02T12:00:00Z");

test("initial healthy check records state without posting", async () => {
  const saved = []; let calls = 0;
  const result = await checkMonitor({ webhook, now, previous: null, save: async s => saved.push(s), fetchImpl: async () => { calls++; return Response.json({ ready: true, healthy: true }); } });
  assert.equal(calls, 2); assert.equal(result.delivery, "not_needed"); assert.equal(saved.length, 1);
});
test("down transition persists intent before one restricted post", async () => {
  const saved = []; let posts = 0;
  const result = await checkMonitor({ webhook, now, previous: { health: "healthy" }, save: async s => saved.push(s), fetchImpl: async (_url, init) => {
    if (!init.method) throw Error("fictional outage");
    posts++; assert.equal(saved[0].delivery, "intent");
    assert.deepEqual(JSON.parse(init.body).allowed_mentions, { parse: [] });
    return Response.json({ id: "000000000000000002" });
  } });
  assert.equal(posts, 1); assert.equal(result.delivery, "confirmed"); assert.equal(saved.length, 2);
});
test("ambiguous sends are recorded and never repeated on unchanged health", async () => {
  const saved = []; let posts = 0;
  const result = await checkMonitor({ webhook, now, previous: { health: "healthy" }, save: async s => saved.push(s), fetchImpl: async (_url, init) => {
    if (!init.method) throw Error("fictional outage"); posts++; throw Error("fictional send timeout");
  } });
  assert.equal(result.delivery, "unknown");
  await checkMonitor({ webhook, now, previous: result, save: async () => assert.fail("no duplicate state write"), fetchImpl: async (_url, init) => { assert.equal(init.method, undefined); throw Error("still down"); } });
  assert.equal(posts, 1); assert.equal(saved.length, 2);
});
test("recovery posts once even if the preceding down alert was uncertain", async () => {
  const result = await checkMonitor({ webhook, now, previous: { health: "unavailable", delivery: "intent" }, save: async () => {}, fetchImpl: async (_url, init) => Response.json(init.method ? { id: "000000000000000003" } : { ready: true, healthy: true }) });
  assert.equal(result.health, "healthy"); assert.equal(result.delivery, "confirmed");
});
test("live web app with stale worker posts once and recovers independently", async () => {
  let posts=0;
  const down=await checkMonitor({webhook,now,previous:{health:'healthy'},save:async()=>{},fetchImpl:async(url,init)=>{
    if(init.method){posts++;assert.match(JSON.parse(init.body).content,/background worker/);return Response.json({id:'000000000000000005'});}
    return Response.json(url.endsWith('/api/ready')?{ready:true}:{healthy:false},{status:url.endsWith('/api/ready')?200:503});
  }});
  assert.equal(down.health,'worker_unavailable');assert.equal(posts,1);
  await checkMonitor({webhook,now,previous:down,save:async()=>assert.fail('unchanged'),fetchImpl:async(url,init)=>{
    assert.equal(init.method,undefined);return Response.json(url.endsWith('/api/ready')?{ready:true}:{healthy:false});
  }});
  const up=await checkMonitor({webhook,now,previous:down,save:async()=>{},fetchImpl:async(_url,init)=>Response.json(init.method?{id:'000000000000000006'}:{ready:true,healthy:true})});
  assert.equal(up.health,'healthy');assert.equal(up.delivery,'confirmed');
});
test("failure to persist intent prevents any Discord send", async () => {
  let posts = 0;
  await assert.rejects(checkMonitor({ webhook, now, previous: { health: "healthy" }, save: async () => { throw Error("fictional push failure"); }, fetchImpl: async (_url, init) => { if (init.method) posts++; throw Error("fictional outage"); } }));
  assert.equal(posts, 0);
});
test("malformed readiness does not expose its body in an alert", async () => {
  await checkMonitor({ webhook, now, previous: { health: "healthy" }, save: async () => {}, fetchImpl: async (_url, init) => {
    if (!init.method) return new Response("fictional-private-response", { status: 503 });
    assert.equal(init.body.includes("fictional-private-response"), false);
    return Response.json({ id: "000000000000000004" });
  } });
});
