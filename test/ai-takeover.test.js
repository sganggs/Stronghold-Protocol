import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {TestClient} from './helpers/wsClient.js';
async function fixture(t){
 const srv=await startServer({port:0,host:'127.0.0.1',quiet:true,botRehearsal:0}),clients=[];
 t.after(async()=>{for(const c of clients)await c.terminate().catch(()=>{});await srv.close();});
 const player=async(name,token)=>{const c=await TestClient.connect(srv.url.replace('http','ws')+'/ws');clients.push(c);const w=await c.hello(name,token);c.id=w.playerId;c.token=w.token;return c;};
 const host=await player('Host');assert.equal((await host.request({t:'room.create',mode:'coop',difficulty:'NORMAL'})).t,'ok');const room=[...srv.lobby.rooms.values()][0];
 const mate=await player('Mate');await mate.request({t:'room.join',code:room.code});await mate.request({t:'room.ready',ready:true});
 for(let i=0;i<2;i++)await host.request({t:'room.addBot'});assert.equal((await host.request({t:'room.start'})).t,'ok');
 const m=room.match;m.startRound(1);m.phase='PREP';m.setDeadline(0);for(const p of m.order)p._botPrepToken=(p._botPrepToken||0)+1;
 const late=await player('Late');assert.equal((await late.request({t:'room.spectate',code:room.code})).t,'ok');return {srv,room,m,host,mate,late,player};
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
