import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {TestClient} from './helpers/wsClient.js';
async function fixture(t,testRoom=false){
 const srv=await startServer({port:0,host:'127.0.0.1',quiet:true,botRehearsal:0}),clients=[];
 t.after(async()=>{for(const c of clients)await c.terminate().catch(()=>{});await srv.close();});
 if(testRoom){srv.lobby.testMode='local';srv.lobby.setTestHost('127.0.0.1');}
 const player=async(name,token)=>{const c=await TestClient.connect(srv.url.replace('http','ws')+'/ws');clients.push(c);const w=await c.hello(name,token);c.id=w.playerId;c.token=w.token;return c;};
 const host=await player('Host');assert.equal((await host.request({t:'room.create',mode:'coop',difficulty:'NORMAL',...(testRoom?{test:true}:{})})).t,'ok');const room=[...srv.lobby.rooms.values()][0];
 const mate=await player('Mate');await mate.request({t:'room.join',code:room.code,testAck:true});await mate.request({t:'room.ready',ready:true});
 for(let i=0;i<2;i++)await host.request({t:'room.addBot'});assert.equal((await host.request({t:'room.start'})).t,'ok');
 const m=room.match;m.startRound(1);m.phase='PREP';m.setDeadline(0);for(const p of m.order)p._botPrepToken=(p._botPrepToken||0)+1;
 const late=await player('Late');if(testRoom)assert.equal((await late.request({t:'room.spectate',code:room.code})).t,'error','test-room admission requires acknowledgement');assert.equal((await late.request({t:'room.spectate',code:room.code,testAck:true})).t,'ok');return {srv,room,m,host,mate,late,player};
}
test('spectator AI handover needs a strict majority and retains inventory, identity and reconnect token',async t=>{
 const {srv,room,m,host,mate,late,player}=await fixture(t),bot=m.order[2],old=late.id,id=bot.playerId,token=late.token;bot.funds=71;const piece=bot.acquireChess('chess_char_1_01_a',{fromPool:false});
 assert.equal((await host.request({t:'room.aiRequest',botId:id})).t,'error','a player cannot replace another seat');
 assert.equal((await late.request({t:'room.aiRequest',botId:id})).t,'ok');const v=room.aiTakeoverVotes[0];assert.equal(v.eligible.length,2);
 assert.equal((await late.request({t:'room.aiVote',voteId:v.id,approve:true})).t,'error','the applicant cannot vote');
 await host.request({t:'room.aiVote',voteId:v.id,approve:true});await host.request({t:'room.aiVote',voteId:v.id,approve:true});assert.equal(bot.isBot,true,'duplicate vote and a tied vote do not pass');
 late.clearInbox();const result=await mate.request({t:'room.aiVote',voteId:v.id,approve:true});assert.equal(result.t,'ok',JSON.stringify(result));await late.waitFor('welcome',w=>w.playerId===id);
 assert.equal(bot.isBot,false);assert.equal(bot.funds,71);assert.ok(bot.hand.some(x=>x?.uid===piece.uid));assert.equal(room.spectatorOf(old),null);assert.equal(srv.registry.byId(old),null);assert.equal(srv.registry.byToken(token).playerId,id);
 assert.equal((await late.request({t:'g.refresh'})).t,'ok');await late.terminate();const resumed=await player('Late',token);assert.equal(resumed.id,id);
});
test('reject majority closes a request; combat and a stale vote cannot perform a handover',async t=>{
 const {room,m,host,mate,late}=await fixture(t),bot=m.order[2];m.phase='COMBAT';assert.equal((await late.request({t:'room.aiRequest',botId:bot.playerId})).t,'error');m.phase='PREP';await late.request({t:'room.aiRequest',botId:bot.playerId});const v=room.aiTakeoverVotes[0];
 await host.request({t:'room.aiVote',voteId:v.id,approve:false});assert.equal(room.aiTakeoverVotes.length,1);await mate.request({t:'room.aiVote',voteId:v.id,approve:false});assert.equal(room.aiTakeoverVotes.length,0);assert.equal(bot.isBot,true);
 assert.equal((await host.request({t:'room.aiVote',voteId:v.id,approve:true})).t,'error');
});

test('0.3.1 test-room acknowledgement and host-only controls survive AI handover',async t=>{
 const {room,m,host,mate,late}=await fixture(t,true),bot=m.order[2];
 assert.equal(room.test,true);assert.equal(m.test,true);
 assert.equal((await late.request({t:'room.aiRequest',botId:bot.playerId})).t,'ok');
 const vote=room.aiTakeoverVotes[0];
 await host.request({t:'room.aiVote',voteId:vote.id,approve:true});
 late.clearInbox();assert.equal((await mate.request({t:'room.aiVote',voteId:vote.id,approve:true})).t,'ok');
 await late.waitFor('welcome',w=>w.playerId===bot.playerId);
 assert.equal(room.test,true);assert.equal(m.test,true);assert.equal(room.hostId,host.id);
 assert.equal((await late.request({t:'g.test',cmd:'funds',args:{amount:99}})).t,'error','new teammate does not acquire host privileges');
 assert.equal((await late.request({t:'g.refresh'})).t,'ok');
});

for (const change of ['applicant leaves', 'applicant disconnects', 'voter disconnects', 'voter enables autoplay', 'phase changes', 'round changes', 'AI eliminated', 'expires']) {
 test(`pending AI request is cancelled when ${change}`,async t=>{
  const {srv,room,m,host,mate,late}=await fixture(t),bot=m.order[2];
  await late.request({t:'room.aiRequest',botId:bot.playerId});const vote=room.aiTakeoverVotes[0];
  await host.request({t:'room.aiVote',voteId:vote.id,approve:true});
  switch(change){
   case 'applicant leaves': await late.request({t:'room.leave'});break;
   case 'applicant disconnects': await late.terminate();break;
   case 'voter disconnects': await mate.terminate();break;
   case 'voter enables autoplay': assert.equal((await mate.request({t:'g.autoplay',on:true})).t,'ok');break;
   case 'phase changes': m.phase='COMBAT';m.markPublic();m.flush(true);break;
   case 'round changes': m.round++;m.markPublic();m.flush(true);break;
   case 'AI eliminated': bot.alive=false;m.markPublic();m.flush(true);break;
   case 'expires': t.mock.method(Date,'now',()=>vote.expiresAt+1);srv.lobby.broadcastState(room);break;
  }
  // Socket closes reach the server asynchronously; no extra room action is needed to clear the request.
  for(let i=0;i<50&&room.aiTakeoverVotes.length;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(room.aiTakeoverVotes.length,0,change);assert.equal(bot.isBot,true);
  assert.equal((await host.request({t:'room.aiVote',voteId:vote.id,approve:true})).t,'error');
  if(change==='phase changes'){m.phase='PREP';assert.equal((await mate.request({t:'room.aiVote',voteId:vote.id,approve:true})).t,'error');}
 });
}

test('no eligible teammates falls back to the online host, without borrowing earlier votes',async t=>{
 const {room,m,host,mate,late}=await fixture(t),bot=m.order[2];
 await host.request({t:'g.autoplay',on:true});await mate.request({t:'g.autoplay',on:true});
 await late.request({t:'room.aiRequest',botId:bot.playerId});const vote=room.aiTakeoverVotes[0];
 assert.deepEqual(vote.eligible,[host.id]);assert.equal((await mate.request({t:'room.aiVote',voteId:vote.id,approve:true})).t,'error');
 late.clearInbox();assert.equal((await host.request({t:'room.aiVote',voteId:vote.id,approve:true})).t,'ok');
 await late.waitFor('welcome',w=>w.playerId===bot.playerId);assert.equal(bot.isBot,false);
});

test('handover keeps seat results distinct from personal achievements and preserves reconnect/replay identity',async t=>{
 const {srv,room,m,host,mate,late,player}=await fixture(t),bot=m.order[2],oldId=late.id,token=late.token;
 bot.stats.kills=123;bot.stats.dmgDealt=456;const stock=m.pool;
 await late.request({t:'room.aiRequest',botId:bot.playerId});const vote=room.aiTakeoverVotes[0];
 await host.request({t:'room.aiVote',voteId:vote.id,approve:true});late.clearInbox();
 await mate.request({t:'room.aiVote',voteId:vote.id,approve:true});await late.waitFor('welcome',w=>w.playerId===bot.playerId);
 assert.equal(m.pool,stock);assert.equal(m.spectators.has(oldId),false);assert.equal(bot.aiTakeoverRound,1);
 assert.equal(srv.network.conns.get(srv.registry.byToken(token).ws).session.playerId,bot.playerId);
 assert.equal(bot.privateView().aiTakeoverRound,1);assert.equal(bot.stats.kills,123);
 const {buildResult}=await import('../server/match/results.js');
 const result=buildResult(m,{victory:true,hiddenReached:true,hiddenCleared:true,reason:'hidden_cleared'});
 const row=result.players.find(p=>p.playerId===bot.playerId);
 assert.equal(row.name,'Late');assert.equal(row.stats.kills,123);assert.equal(row.aiTakeoverRound,1);
 assert.equal(row.title,null);assert.equal(row.trophies,0);assert.equal(row.reward,0);
 const {buildRecord,buildQuitRecord,compactRecord,countsTowardStats,recordToResult,normalizeRecord}=await import('../public/js/ui/stats.js');
 const rec=normalizeRecord(buildRecord(result,{myId:bot.playerId,roomMode:'coop',now:1}));
 assert.equal(countsTowardStats(rec),false);assert.equal(countsTowardStats(normalizeRecord(compactRecord(rec))),false);
 const quit=buildQuitRecord({me:{playerId:bot.playerId},room:{mode:'coop'},match:{public:m.publicView()}},{live:{active:true,startedAt:0,sawStart:true,aliveRound:1},now:10});assert.equal(quit.players[0].aiTakeoverRound,1);assert.equal(countsTowardStats(quit),false);
 assert.equal(recordToResult(rec).players.find(p=>p.playerId===bot.playerId).aiTakeoverRound,1);
 const hostRec=buildRecord(result,{myId:host.id,roomMode:'coop',now:1});assert.equal(countsTowardStats(hostRec),true);
 const foreign=await player('Stranger');assert.notEqual(foreign.id,bot.playerId);
 await late.terminate();const resumed=await player('Late',token);assert.equal(resumed.id,bot.playerId);
 m.finish({victory:false,reason:'test'});const replay=await resumed.waitFor('m.result');
 assert.equal(replay.playerId,bot.playerId);assert.equal(replay.players.find(p=>p.playerId===bot.playerId).aiTakeoverRound,1);
 await resumed.terminate();const again=await player('Late',token);assert.equal(again.id,bot.playerId);
 const replayed=await again.waitFor('m.result');assert.equal(replayed.playerId,bot.playerId);
});
