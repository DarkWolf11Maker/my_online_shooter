const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── CONFIG ──────────────────────────────────────────────────
const MAX_PLAYERS    = 50;
const MATCH_DURATION = 600000; // 10 min
const TICK_MS        = 50;     // 20 Hz
const MAPS           = ['forest','city','warehouse','desert','arctic','rooftop'];
const KILL_REWARD    = 150;
const ASSIST_REWARD  = 50;

// ─── WEAPON DEFINITIONS ──────────────────────────────────────
const WDEF = {
  fists:       { type:'melee',  damage:15,  range:2.0,  cdMs:450 },
  knife:       { type:'melee',  damage:45,  range:2.2,  cdMs:380 },
  grenade:     { type:'throw',  damage:95,  blastR:5.5, cdMs:800 },
  pistol:      { type:'gun',    damage:28,  speed:0.80, maxDist:35, maxAmmo:12,  cdMs:340, bColor:0xffee00 },
  shotgun:     { type:'gun',    damage:22,  speed:0.76, maxDist:22, maxAmmo:8,   cdMs:680, bColor:0xff8800, pellets:6, spread:0.22 },
  rifle:       { type:'gun',    damage:18,  speed:1.20, maxDist:55, maxAmmo:30,  cdMs:120, bColor:0x00ffcc },
  smg:         { type:'gun',    damage:10,  speed:1.00, maxDist:28, maxAmmo:45,  cdMs:75,  bColor:0xcc88ff },
  sniper:      { type:'gun',    damage:90,  speed:1.60, maxDist:90, maxAmmo:5,   cdMs:900, bColor:0xffffff },
  minigun:     { type:'gun',    damage:7,   speed:1.05, maxDist:30, maxAmmo:120, cdMs:45,  bColor:0xffaa00, spread:0.18 },
  crossbow:    { type:'gun',    damage:65,  speed:0.85, maxDist:50, maxAmmo:8,   cdMs:950, bColor:0x88ff44 },
  rocket:      { type:'rocket', damage:100, speed:0.55, maxDist:60, maxAmmo:4,   cdMs:2200,bColor:0xff4400, blastR:6 },
  flamethrower:{ type:'gun',    damage:5,   speed:0.55, maxDist:14, maxAmmo:80,  cdMs:60,  bColor:0xff6600, pellets:4, spread:0.4 },
};

// ─── SHOP ────────────────────────────────────────────────────
const SHOP = {
  armor:       { price:200, name:'Armor Vest',   desc:'Absorbs 25% damage',         type:'upgrade' },
  heavy_armor: { price:400, name:'Heavy Armor',  desc:'Absorbs 50% damage',         type:'upgrade', requires:'armor' },
  speed:       { price:150, name:'Speed Boost',  desc:'Move 25% faster',            type:'upgrade' },
  health_kit:  { price:80,  name:'Health Kit',   desc:'Restore 50 HP',              type:'consumable' },
  gren_pack:   { price:100, name:'Grenade Pack', desc:'+2 Grenades',                type:'consumable' },
  ammo_crate:  { price:120, name:'Ammo Crate',   desc:'Refill all gun ammo',        type:'consumable' },
  stimpack:    { price:180, name:'Stimpack',     desc:'Regen HP for 12 seconds',    type:'consumable' },
  radar:       { price:250, name:'Radar',        desc:'Enemies on minimap always',  type:'upgrade' },
};

// ─── PICKUPS ─────────────────────────────────────────────────
const PICKUP_POS = {
  forest:   [[-20,0],[20,0],[0,20],[0,-20],[-14,14],[14,14],[-14,-14],[14,-14],[-24,8],[24,8],[8,24],[-8,-24],[-10,22],[10,-22],[22,-10],[-22,10],[0,0]],
  city:     [[-16,0],[16,0],[0,16],[0,-16],[-22,-22],[22,22],[-22,22],[22,-22],[-8,8],[8,-8],[8,8],[-8,-8],[0,28],[0,-28],[28,0],[-28,0],[0,0]],
  warehouse:[[-10,0],[10,0],[0,10],[0,-10],[-6,6],[6,-6],[6,6],[-6,-6],[-16,0],[16,0],[0,16],[0,-16],[-12,12],[12,-12],[-12,-12],[12,12],[0,0]],
  desert:   [[-18,0],[18,0],[0,18],[0,-18],[-12,12],[12,-12],[12,12],[-12,-12],[-24,6],[24,-6],[6,-24],[-6,24],[-18,-18],[18,18],[-18,18],[18,-18],[0,0]],
  arctic:   [[-15,0],[15,0],[0,15],[0,-15],[-10,10],[10,-10],[-10,-10],[10,10],[-20,5],[20,-5],[5,-20],[-5,20],[-16,-16],[16,16],[-20,0],[20,0],[0,0]],
  rooftop:  [[-14,0],[14,0],[0,14],[0,-14],[-10,10],[10,-10],[10,10],[-10,-10],[-18,0],[18,0],[0,-18],[0,18],[-14,-14],[14,14],[-8,0],[8,0],[0,0]],
};
const PGUNS = ['pistol','shotgun','rifle','smg','sniper','minigun','crossbow','rocket','flamethrower','pistol','ammo','ammo'];

function mkPickups(mapName) {
  const pos = PICKUP_POS[mapName] || PICKUP_POS.forest;
  return pos.map((p,i) => ({ id:i, type:PGUNS[i % PGUNS.length], x:p[0], z:p[1], active:true }));
}

// ─── MATCH MANAGEMENT ────────────────────────────────────────
let matchCtr = 0;
const matches = new Map();
let globalLB = [];

function createMatch() {
  const id = ++matchCtr;
  const mapName = MAPS[(id-1) % MAPS.length];
  const m = { id, mapName, active:true, players:new Map(), bullets:[], rockets:[], bulletId:0, pickups:mkPickups(mapName), startTime:Date.now() };
  matches.set(id, m);
  console.log(`[Match ${id}] Created on ${mapName.toUpperCase()}`);
  setTimeout(() => endMatch(id), MATCH_DURATION);
  return m;
}

function getMatch() {
  for (const [,m] of matches) if (m.active && m.players.size < MAX_PLAYERS) return m;
  return createMatch();
}

// ─── PLAYER ──────────────────────────────────────────────────
function mkPlayer(sid, name, match) {
  const a = Math.random()*Math.PI*2, r = 6+Math.random()*20;
  const x = Math.cos(a)*r, z = Math.sin(a)*r;
  return {
    id:sid, name:(name||'').trim().slice(0,20)||`Player${~~(Math.random()*9000+1000)}`,
    x, z, angle:0, spawnX:x, spawnZ:z,
    hp:100, lives:3, dead:false, invincible:0,
    kills:0, deaths:0, assists:0, money:200,
    upgrades:{ armor:false, heavy_armor:false, speed:false, radar:false },
    speedMult:1.0, stimEnd:0, lastDamager:null,
    inventory:[{key:'fists',ammo:Infinity},{key:'knife',ammo:Infinity},{key:'grenade',ammo:2}],
    weaponIdx:0, lastShot:0, lastMelee:0,
  };
}

// ─── DAMAGE ──────────────────────────────────────────────────
function damage(match, victimId, rawDmg, killerId) {
  const v = match.players.get(victimId);
  if (!v || v.dead || v.invincible > 0) return;
  v.lastDamager = killerId;
  let dmg = rawDmg;
  if (v.upgrades.heavy_armor) dmg = Math.round(dmg*0.5);
  else if (v.upgrades.armor)  dmg = Math.round(dmg*0.75);
  v.hp = Math.max(0, v.hp - dmg);
  io.to(victimId).emit('hit', { hp:v.hp, dmg });
  if (v.hp <= 0) onKill(match, v, killerId);
  else io.to(match.id.toString()).emit('pHurt', { id:victimId, hp:v.hp });
}

function onKill(match, v, killerId) {
  v.dead=true; v.hp=0; v.lives--; v.deaths++;
  const k = killerId ? match.players.get(killerId) : null;
  if (k) {
    k.kills++; k.money += KILL_REWARD;
    io.to(killerId).emit('earnMoney', { amount:KILL_REWARD, total:k.money, reason:'KILL' });
    if (v.lastDamager && v.lastDamager !== killerId) {
      const ass = match.players.get(v.lastDamager);
      if (ass) { ass.money += ASSIST_REWARD; io.to(v.lastDamager).emit('earnMoney', { amount:ASSIST_REWARD, total:ass.money, reason:'ASSIST' }); }
    }
    io.to(match.id.toString()).emit('kill', { kn:k.name, vn:v.name, ki:killerId, vi:v.id });
  }
  io.to(v.id).emit('youDied', { lives:v.lives, money:v.money });
  if (v.lives > 0) {
    setTimeout(() => {
      if (!match.active) return;
      const a2=Math.random()*Math.PI*2, r2=6+Math.random()*20;
      Object.assign(v, { x:Math.cos(a2)*r2, z:Math.sin(a2)*r2, hp:100, dead:false, invincible:3500 });
      const g=v.inventory.find(w=>w.key==='grenade'); if (g&&g.ammo<2) g.ammo++;
      io.to(v.id).emit('respawned', { x:v.x, z:v.z, inventory:v.inventory, money:v.money });
    }, 3000);
  } else {
    setTimeout(() => io.to(v.id).emit('eliminated', { kills:v.kills, deaths:v.deaths }), 600);
  }
}

// ─── SHOP ────────────────────────────────────────────────────
function buyItem(match, player, key) {
  const item = SHOP[key];
  if (!item) return { ok:false, reason:'Unknown item' };
  if (player.money < item.price) return { ok:false, reason:'Not enough money' };
  if (item.requires && !player.upgrades[item.requires]) return { ok:false, reason:'Requires '+item.requires };
  player.money -= item.price;
  if (item.type === 'upgrade') {
    player.upgrades[key] = true;
    if (key==='speed') player.speedMult = 1.25;
    return { ok:true, money:player.money, upgrade:key };
  }
  const AMMO={pistol:12,shotgun:8,rifle:30,smg:45,sniper:5,minigun:120,crossbow:8,rocket:4,flamethrower:80};
  if (key==='health_kit') player.hp = Math.min(100, player.hp+50);
  else if (key==='gren_pack') { const g=player.inventory.find(w=>w.key==='grenade'); if (g) g.ammo+=2; else player.inventory.push({key:'grenade',ammo:2}); }
  else if (key==='ammo_crate') { for (const w of player.inventory) if (AMMO[w.key]) w.ammo=AMMO[w.key]; }
  else if (key==='stimpack') { player.stimEnd = Date.now()+12000; }
  return { ok:true, money:player.money, inventory:player.inventory, hp:player.hp };
}

// ─── TICK ────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [,m] of matches) {
    if (!m.active) continue;
    for (const [,p] of m.players) {
      if (p.invincible>0) p.invincible = Math.max(0,p.invincible-TICK_MS);
      if (p.stimEnd>now && !p.dead) p.hp = Math.min(100, p.hp+0.15);
    }
    // Bullets
    for (let i=m.bullets.length-1;i>=0;i--) {
      const b=m.bullets[i];
      b.x+=b.vx; b.z+=b.vz; b.traveled+=Math.hypot(b.vx,b.vz);
      if (b.traveled>b.maxDist || Math.abs(b.x)>72 || Math.abs(b.z)>72) { m.bullets.splice(i,1); continue; }
      let hit=false;
      for (const [pid,p] of m.players) {
        if (pid===b.owner||p.dead||p.invincible>0) continue;
        if ((b.x-p.x)**2+(b.z-p.z)**2 < 0.9) { damage(m,pid,b.damage,b.owner); m.bullets.splice(i,1); hit=true; break; }
      }
      if (hit) continue;
    }
    // Rockets
    for (let i=m.rockets.length-1;i>=0;i--) {
      const r=m.rockets[i];
      r.x+=r.vx; r.z+=r.vz; r.traveled+=Math.hypot(r.vx,r.vz);
      let boom = r.traveled>WDEF.rocket.maxDist || Math.abs(r.x)>72 || Math.abs(r.z)>72;
      for (const [pid,p] of m.players) { if (pid!==r.owner&&!p.dead&&(r.x-p.x)**2+(r.z-p.z)**2<1.4) { boom=true; break; } }
      if (boom) {
        io.to(m.id.toString()).emit('explosion', { x:r.x, z:r.z, big:true });
        for (const [pid,p] of m.players) { const d2=Math.hypot(p.x-r.x,p.z-r.z); if (d2<WDEF.rocket.blastR) damage(m,pid,Math.round(WDEF.rocket.damage*(1-d2/WDEF.rocket.blastR)),r.owner); }
        m.rockets.splice(i,1);
      }
    }
    const T=Math.max(0,Math.floor((m.startTime+MATCH_DURATION-now)/1000));
    const LB=[...m.players.values()].sort((a,b)=>b.kills-a.kills).slice(0,10).map(p=>({n:p.name,k:p.kills,d:p.deaths,m:p.money}));
    io.to(m.id.toString()).emit('S', {
      P:[...m.players.values()].map(p=>({i:p.id,n:p.name,x:+(p.x.toFixed(2)),z:+(p.z.toFixed(2)),a:+(p.angle.toFixed(2)),h:p.hp,l:p.lives,k:p.kills,d:p.dead,w:p.weaponIdx,ar:p.upgrades.heavy_armor?2:p.upgrades.armor?1:0})),
      B:m.bullets.map(b=>({i:b.id,x:+(b.x.toFixed(2)),z:+(b.z.toFixed(2)),c:b.color})),
      R:m.rockets.map(r=>({i:r.id,x:+(r.x.toFixed(2)),z:+(r.z.toFixed(2))})),
      T, LB, PC:m.players.size,
    });
  }
}, TICK_MS);

function endMatch(id) {
  const m=matches.get(id); if (!m||!m.active) return;
  m.active=false;
  const res=[...m.players.values()].sort((a,b)=>b.kills-a.kills).map(p=>({name:p.name,kills:p.kills,deaths:p.deaths,money:p.money}));
  io.to(id.toString()).emit('matchEnd', { results:res, winner:res[0]?.name });
  for (const r of res) { const ex=globalLB.find(g=>g.name===r.name); if (ex){ex.kills+=r.kills;ex.matches++;}else globalLB.push({name:r.name,kills:r.kills,matches:1}); }
  globalLB.sort((a,b)=>b.kills-a.kills); globalLB=globalLB.slice(0,10);
  setTimeout(()=>matches.delete(id),60000);
}

io.on('connection', socket => {
  let match=null, player=null;
  socket.on('join', ({name}) => {
    match=getMatch(); player=mkPlayer(socket.id,name,match); match.players.set(socket.id,player); socket.join(match.id.toString());
    socket.emit('joined',{playerId:socket.id,mapName:match.mapName,spawnX:player.x,spawnZ:player.z,pickups:match.pickups,timeLeft:Math.max(0,Math.floor((match.startTime+MATCH_DURATION-Date.now())/1000)),matchId:match.id,inventory:player.inventory,money:player.money,playerCount:match.players.size});
    socket.to(match.id.toString()).emit('pJoin',{id:socket.id,name:player.name});
    console.log(`+ ${player.name} → match ${match.id} [${match.players.size}/${MAX_PLAYERS}] ${match.mapName}`);
  });
  socket.on('move',data=>{ if(!player||player.dead) return; if(Math.hypot(data.x-player.x,data.z-player.z)>2.5) return; player.x=data.x;player.z=data.z;player.angle=data.a; });
  socket.on('shoot',data=>{
    if (!player||player.dead||!match) return;
    const wd=WDEF[data.wk]; if (!wd||wd.type==='melee'||wd.type==='throw') return;
    const now=Date.now(); if (now-player.lastShot<(wd.cdMs-30)) return; player.lastShot=now;
    if (wd.type==='rocket') {
      match.rockets.push({id:++match.bulletId,x:player.x+Math.sin(data.a)*0.9,z:player.z+Math.cos(data.a)*0.9,vx:Math.sin(data.a)*wd.speed,vz:Math.cos(data.a)*wd.speed,owner:socket.id,traveled:0,maxDist:wd.maxDist});
    } else {
      for (let i=0;i<(wd.pellets||1);i++) { const spr=(wd.spread||0.025)*(Math.random()-0.5)*2,ang=data.a+spr; match.bullets.push({id:++match.bulletId,x:player.x+Math.sin(ang)*0.9,z:player.z+Math.cos(ang)*0.9,vx:Math.sin(ang)*wd.speed,vz:Math.cos(ang)*wd.speed,owner:socket.id,damage:wd.damage,color:wd.bColor,traveled:0,maxDist:wd.maxDist}); }
    }
  });
  socket.on('melee',()=>{
    if (!player||player.dead||!match) return;
    const now=Date.now(); if (now-player.lastMelee<380) return; player.lastMelee=now;
    const wd=WDEF[player.inventory[player.weaponIdx]?.key]||WDEF.fists;
    for (const [pid,p] of match.players) { if (pid===socket.id||p.dead) continue; if (Math.hypot(p.x-player.x,p.z-player.z)<(wd.range||2.0)) { damage(match,pid,wd.damage||15,socket.id); break; } }
  });
  socket.on('grenade',data=>{
    if (!player||player.dead||!match) return;
    setTimeout(()=>{ if(!match.active)return; io.to(match.id.toString()).emit('explosion',{x:data.x,z:data.z,big:false}); for (const [pid,p] of match.players){const d2=Math.hypot(p.x-data.x,p.z-data.z);if(d2<WDEF.grenade.blastR)damage(match,pid,Math.round(WDEF.grenade.damage*(1-d2/WDEF.grenade.blastR)),socket.id);}},2600);
    io.to(match.id.toString()).emit('grenadeFly',{ox:player.x,oz:player.z,vx:data.vx,vy:data.vy||0.18,vz:data.vz});
  });
  socket.on('pickup',data=>{
    if (!player||!match) return;
    const pk=match.pickups.find(p=>p.id===data.id&&p.active); if (!pk) return;
    if (Math.hypot(player.x-pk.x,player.z-pk.z)>3.5) return;
    pk.active=false;
    const AMMO={pistol:12,shotgun:8,rifle:30,smg:45,sniper:5,minigun:120,crossbow:8,rocket:4,flamethrower:80};
    let msg='';
    if (pk.type==='ammo'){for(const w of player.inventory)if(AMMO[w.key])w.ammo=Math.min((w.ammo||0)+Math.ceil(AMMO[w.key]*0.6),AMMO[w.key]*2);msg='AMMO CRATE';}
    else{const ex=player.inventory.find(w=>w.key===pk.type);if(ex)ex.ammo=Math.min((ex.ammo||0)+AMMO[pk.type],AMMO[pk.type]*2);else player.inventory.push({key:pk.type,ammo:AMMO[pk.type]});msg=pk.type.toUpperCase()+' PICKED UP';}
    socket.emit('pickupOK',{id:pk.id,inventory:player.inventory,msg});
    io.to(match.id.toString()).emit('pickupGone',{id:pk.id});
    setTimeout(()=>{if(!match.active)return;pk.active=true;io.to(match.id.toString()).emit('pickupBack',{id:pk.id,type:pk.type,x:pk.x,z:pk.z});},20000);
  });
  socket.on('switchWeapon',({idx})=>{ if(player&&idx>=0&&idx<player.inventory.length){player.weaponIdx=idx;} });
  socket.on('dropWeapon', data => {
    if (!player || !match || player.dead) return;
    const idx = data.idx;
    const wep = player.inventory[idx];
    if (!wep || ['fists','knife','grenade'].includes(wep.key)) return;
    // Create a pickup at the player's current position
    const newId = 10000 + Date.now() % 100000 + Math.floor(Math.random()*1000);
    const pk = { id: newId, type: wep.key, x: player.x + (Math.random()-.5)*1.5, z: player.z + (Math.random()-.5)*1.5, active: true };
    match.pickups.push(pk);
    // Remove from player inventory
    player.inventory.splice(idx, 1);
    if (player.weaponIdx >= player.inventory.length) player.weaponIdx = Math.max(0, player.inventory.length - 1);
    // Tell all players about the new pickup
    io.to(match.id.toString()).emit('pickupBack', { id: newId, type: pk.type, x: pk.x, z: pk.z });
    // Tell the dropping player their updated inventory
    socket.emit('pickupOK', { id: null, inventory: player.inventory, msg: wep.key.toUpperCase() + ' DROPPED' });
    // Auto-despawn the dropped pickup after 30s
    setTimeout(() => {
      if (!match.active) return;
      const i = match.pickups.indexOf(pk);
      if (i !== -1 && pk.active) { match.pickups.splice(i, 1); io.to(match.id.toString()).emit('pickupGone', { id: newId }); }
    }, 30000);
  });
  socket.on('buyItem',({itemKey})=>{ if(!player||!match)return; socket.emit('shopResult',{itemKey,...buyItem(match,player,itemKey)}); });
  socket.on('disconnect',()=>{
    if (match&&player){match.players.delete(socket.id);socket.to(match.id.toString()).emit('pLeave',{id:socket.id,name:player.name});console.log(`- ${player.name} left match ${match.id}`);if(match.players.size===0&&match.active){match.active=false;matches.delete(match.id);}}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🎮  Forest Deathmatch Online  →  http://localhost:${PORT}\n`));
