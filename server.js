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
const MATCH_DURATION = 600000; // default
const TICK_MS        = 50;     // 20 Hz
const MAPS           = ['forest','city','warehouse','desert','arctic','rooftop'];
const KILL_REWARD    = 150;
const ASSIST_REWARD  = 50;
const HEADSHOT_MULT  = 2;

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

const EYE_Y = 1.52;
const HEAD_Y = 1.55;
const BODY_Y = 0.95;

const BARREL_DAMAGE = 80;
const BARREL_BLAST_R = 6.0;

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
let nextMapVote = null; // voted map for next match
const voteData = new Map(); // matchId -> { choices, votes, playerVotes, timer }

const MODES = ['ffa','tdm','lms'];

const BARREL_POS = {
  forest:   [[-22,-6],[22,6],[-10,18],[10,-18],[-30,18],[30,-18],[0,26],[0,-26]],
  city:     [[-18,-18],[18,18],[-18,18],[18,-18],[0,-26],[0,26],[-26,0],[26,0]],
  warehouse:[[ -8,-14],[ 8,14],[-14,8],[14,-8],[-18,0],[18,0],[0,-18],[0,18]],
  desert:   [[-24,0],[24,0],[0,-24],[0,24],[-18,-18],[18,18],[-18,18],[18,-18]],
  arctic:   [[-20,10],[20,-10],[-10,-20],[10,20],[-26,0],[26,0],[0,-26],[0,26]],
  rooftop:  [[-18,-8],[18,8],[-8,18],[8,-18],[-26,0],[26,0],[0,-26],[0,26]],
};

function mkBarrels(mapName) {
  const pos = BARREL_POS[mapName] || BARREL_POS.forest;
  let id = 1;
  return pos.map(p => ({ id: id++, x:p[0], z:p[1], alive:true }));
}

function randDropPos() {
  // Keep it roughly inside playable ring
  for (let t=0;t<80;t++) {
    const x=(Math.random()-.5)*88, z=(Math.random()-.5)*88;
    if (Math.hypot(x,z) > 48) continue;
    if (Math.abs(x)<10 && Math.abs(z)<10) continue;
    return { x, z };
  }
  return { x: 0, z: 32 };
}

function spawnSupplyDrop(match) {
  const { x, z } = randDropPos();
  const id = 50000 + Math.floor(Math.random()*900000) + (Date.now() % 10000);
  const pk = { id, type:'supply', x, z, active:true };
  match.pickups.push(pk);
  io.to(match.id.toString()).emit('pickupBack', { id, type: pk.type, x: pk.x, z: pk.z });
  io.to(match.id.toString()).emit('supplyDrop', { x: pk.x, z: pk.z });
}

function createMatch() {
  const id = ++matchCtr;
  const mapName = nextMapVote || MAPS[(id-1) % MAPS.length];
  nextMapVote = null;
  const mode = MODES[(id-1) % MODES.length];
  const startTime = Date.now();
  const durationMs = (mode === 'ffa') ? 180000 : MATCH_DURATION; // FFA = 3 min timer rush
  const m = {
    id, mapName, mode,
    active:true,
    players:new Map(),
    bullets:[], rockets:[], bulletId:0,
    pickups:mkPickups(mapName),
    barrels: mkBarrels(mapName),
    supply: null, // {id,x,z,active}
    nextSupplyAt: startTime + 120000,
    zoneR: 52, // LMS only
    startTime,
    durationMs,
  };
  matches.set(id, m);
  console.log(`[Match ${id}] Created on ${mapName.toUpperCase()} mode=${mode.toUpperCase()}`);
  setTimeout(() => endMatch(id), durationMs);
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
  const lives = match.mode === 'lms' ? 1 : 3;
  let team = null;
  if (match.mode === 'tdm') {
    let r=0,b=0;
    for (const [,p] of match.players) { if (p.team==='r') r++; else if (p.team==='b') b++; }
    team = r<=b ? 'r' : 'b';
  }
  return {
    id:sid, name:(name||'').trim().slice(0,20)||`Player${~~(Math.random()*9000+1000)}`,
    x, z, angle:0, spawnX:x, spawnZ:z,
    hp:100, lives, dead:false, invincible:0,
    kills:0, deaths:0, assists:0, money:200,
    streak:0,
    team,
    streakSpeedEnd: 0,
    airstrikeReady: false,
    minigunEnd: 0,
    upgrades:{ armor:false, heavy_armor:false, speed:false, radar:false },
    speedMult:1.0, stimEnd:0, lastDamager:null,
    inventory:[{key:'fists',ammo:Infinity},{key:'knife',ammo:Infinity},{key:'grenade',ammo:2}],
    weaponIdx:0, lastShot:0, lastMelee:0,
  };
}

// ─── DAMAGE ──────────────────────────────────────────────────
function damage(match, victimId, rawDmg, killerId, meta={}) {
  const v = match.players.get(victimId);
  if (!v || v.dead || v.invincible > 0) return;
  if (match.mode === 'tdm' && killerId) {
    const k = match.players.get(killerId);
    if (k && v.team && k.team && v.team === k.team) return; // no friendly fire
  }
  v.lastDamager = killerId;
  let dmg = rawDmg;
  const headshot = !!meta.headshot;
  if (headshot) dmg = Math.round(dmg * HEADSHOT_MULT);
  if (v.upgrades.heavy_armor) dmg = Math.round(dmg*0.5);
  else if (v.upgrades.armor)  dmg = Math.round(dmg*0.75);
  v.hp = Math.max(0, v.hp - dmg);
  io.to(victimId).emit('hit', { hp:v.hp, dmg, headshot });
  // Notify the attacker so the client can show a hit marker
  if (killerId && killerId !== victimId) {
    io.to(killerId).emit('hitMarker', { hp:v.hp, headshot });
  }
  if (v.hp <= 0) onKill(match, v, killerId, { headshot });
  else io.to(match.id.toString()).emit('pHurt', { id:victimId, hp:v.hp });
}

function onKill(match, v, killerId, meta={}) {
  v.dead=true; v.hp=0; v.lives--; v.deaths++;
  v.streak = 0;
  v.streakSpeedEnd = 0;
  v.airstrikeReady = false;
  const k = killerId ? match.players.get(killerId) : null;
  if (k) {
    k.kills++; k.money += KILL_REWARD;
    k.streak = (k.streak||0) + 1;
    io.to(killerId).emit('earnMoney', { amount:KILL_REWARD, total:k.money, reason:'KILL' });
    if (v.lastDamager && v.lastDamager !== killerId) {
      const ass = match.players.get(v.lastDamager);
      if (ass) { ass.money += ASSIST_REWARD; io.to(v.lastDamager).emit('earnMoney', { amount:ASSIST_REWARD, total:ass.money, reason:'ASSIST' }); }
    }
    io.to(match.id.toString()).emit('kill', { kn:k.name, vn:v.name, ki:killerId, vi:v.id, hs:!!meta.headshot });

    // Killstreak rewards
    if (k.streak === 3) {
      k.streakSpeedEnd = Date.now() + 12000;
      io.to(killerId).emit('streakReward', { type:'speed', ms:12000, streak:k.streak });
    } else if (k.streak === 5) {
      k.airstrikeReady = true;
      io.to(killerId).emit('streakReward', { type:'airstrike', streak:k.streak });
    } else if (k.streak === 7) {
      k.minigunEnd = Date.now() + 15000;
      k.streakMinigun = true;
      const ex = k.inventory.find(w => w.key === 'minigun');
      if (ex) ex.ammo = Math.max(ex.ammo||0, 240);
      else k.inventory.push({ key:'minigun', ammo:240 });
      k.weaponIdx = Math.min(k.weaponIdx, k.inventory.length-1);
      io.to(killerId).emit('streakReward', { type:'minigun', ms:15000, streak:k.streak });
      io.to(killerId).emit('pickupOK', { id:null, inventory:k.inventory, msg:'MINIGUN UNLOCKED (15s)' });
    }
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

    // Supply drops
    if (now >= m.nextSupplyAt) {
      m.nextSupplyAt = now + 120000;
      spawnSupplyDrop(m);
    }

    // LMS shrinking zone
    if (m.mode === 'lms') {
      const shrinkMs = 180000;
      const t = Math.max(0, Math.min(1, (now - m.startTime) / shrinkMs));
      m.zoneR = 52 - (52-16) * t;
    } else {
      m.zoneR = 52;
    }

    for (const [,p] of m.players) {
      if (p.invincible>0) p.invincible = Math.max(0,p.invincible-TICK_MS);
      if (p.stimEnd>now && !p.dead) p.hp = Math.min(100, p.hp+0.15);

      // LMS zone damage
      if (m.mode === 'lms' && !p.dead && Math.hypot(p.x,p.z) > m.zoneR) {
        damage(m, p.id, 1, null);
      }

      // Killstreak minigun expiry
      if (p.minigunEnd && now >= p.minigunEnd) {
        p.minigunEnd = 0;
        if (p.streakMinigun) {
          p.streakMinigun = false;
          const idx = p.inventory.findIndex(w => w.key === 'minigun');
          if (idx !== -1) p.inventory.splice(idx, 1);
          if (p.weaponIdx >= p.inventory.length) p.weaponIdx = Math.max(0, p.inventory.length - 1);
          io.to(p.id).emit('pickupOK', { id:null, inventory:p.inventory, msg:'MINIGUN EXPIRED' });
        }
      }
    }
    // Bullets
    for (let i=m.bullets.length-1;i>=0;i--) {
      const b=m.bullets[i];
      // Gravity only for sniper (bullet drop)
      if (b.wk === 'sniper') b.vy -= 0.0022 * (TICK_MS/50);
      b.x+=b.vx; b.y+=b.vy; b.z+=b.vz;
      b.traveled+=Math.hypot(b.vx,b.vz,b.vy);
      if (b.traveled>b.maxDist || Math.abs(b.x)>72 || Math.abs(b.z)>72 || b.y<0 || b.y>6) { m.bullets.splice(i,1); continue; }
      let hit=false;

      // Explosive barrels
      for (const br of m.barrels) {
        if (!br.alive) continue;
        if ((b.x-br.x)**2 + (b.z-br.z)**2 < 1.0) {
          br.alive = false;
          io.to(m.id.toString()).emit('explosion', { x:br.x, z:br.z, big:false });
          io.to(m.id.toString()).emit('barrelGone', { id: br.id });
          for (const [pid,p] of m.players) {
            const d2=Math.hypot(p.x-br.x,p.z-br.z);
            if (d2 < BARREL_BLAST_R) damage(m,pid,Math.round(BARREL_DAMAGE*(1-d2/BARREL_BLAST_R)), b.owner);
          }
          m.bullets.splice(i,1); hit=true;
          break;
        }
      }
      if (hit) continue;

      for (const [pid,p] of m.players) {
        if (pid===b.owner||p.dead||p.invincible>0) continue;
        const dx=b.x-p.x, dz=b.z-p.z;
        if (dx*dx+dz*dz < 0.9) {
          const headshot = b.y > HEAD_Y;
          damage(m,pid,b.damage,b.owner,{ headshot });
          m.bullets.splice(i,1); hit=true; break;
        }
      }
      if (hit) continue;
    }
    // Rockets
    for (let i=m.rockets.length-1;i>=0;i--) {
      const r=m.rockets[i];
      r.vy -= 0.0018 * (TICK_MS/50);
      r.x+=r.vx; r.y+=r.vy; r.z+=r.vz; r.traveled+=Math.hypot(r.vx,r.vz,r.vy);
      let boom = r.traveled>WDEF.rocket.maxDist || Math.abs(r.x)>72 || Math.abs(r.z)>72 || r.y<0;
      for (const [pid,p] of m.players) { if (pid!==r.owner&&!p.dead&&(r.x-p.x)**2+(r.z-p.z)**2<1.4) { boom=true; break; } }
      if (boom) {
        io.to(m.id.toString()).emit('explosion', { x:r.x, z:r.z, big:true });
        for (const [pid,p] of m.players) { const d2=Math.hypot(p.x-r.x,p.z-r.z); if (d2<WDEF.rocket.blastR) damage(m,pid,Math.round(WDEF.rocket.damage*(1-d2/WDEF.rocket.blastR)),r.owner); }
        for (const br of m.barrels) {
          if (!br.alive) continue;
          if (Math.hypot(br.x-r.x, br.z-r.z) < BARREL_BLAST_R) {
            br.alive=false;
            io.to(m.id.toString()).emit('barrelGone', { id: br.id });
          }
        }
        m.rockets.splice(i,1);
      }
    }
    const T=Math.max(0,Math.floor((m.startTime+(m.durationMs||MATCH_DURATION)-now)/1000));
    const LB=[...m.players.values()].sort((a,b)=>b.kills-a.kills).slice(0,10).map(p=>({n:p.name,k:p.kills,d:p.deaths,m:p.money}));
    io.to(m.id.toString()).emit('S', {
      P:[...m.players.values()].map(p=>({i:p.id,n:p.name,x:+(p.x.toFixed(2)),z:+(p.z.toFixed(2)),a:+(p.angle.toFixed(2)),h:p.hp,l:p.lives,k:p.kills,d:p.dead,w:p.weaponIdx,ar:p.upgrades.heavy_armor?2:p.upgrades.armor?1:0,t:p.team,s:p.streak||0,sb:(p.streakSpeedEnd&&now<p.streakSpeedEnd)?1:0,as:!!p.airstrikeReady})),
      B:m.bullets.map(b=>({i:b.id,x:+(b.x.toFixed(2)),y:+(b.y.toFixed(2)),z:+(b.z.toFixed(2)),c:b.color})),
      R:m.rockets.map(r=>({i:r.id,x:+(r.x.toFixed(2)),y:+(r.y.toFixed(2)),z:+(r.z.toFixed(2))})),
      BR:m.barrels.filter(b=>b.alive).map(b=>({id:b.id,x:+(b.x.toFixed(1)),z:+(b.z.toFixed(1))})),
      MO:m.mode,
      ZR:+(m.zoneR.toFixed(2)),
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
  // Start map vote after a short delay
  setTimeout(() => startVote(id), 2000);
}

function startVote(matchId) {
  const shuffled = [...MAPS].sort(() => Math.random() - 0.5);
  const choices = shuffled.slice(0, 3);
  const votes = {};
  choices.forEach(m => votes[m] = 0);
  const v = { choices, votes, playerVotes: new Map() };
  voteData.set(matchId, v);
  io.to(matchId.toString()).emit('voteStart', { choices, seconds: 20 });
  v.timer = setTimeout(() => endVote(matchId), 20000);
}

function endVote(matchId) {
  const v = voteData.get(matchId); if (!v) return;
  clearTimeout(v.timer);
  let winner = v.choices[0], maxVotes = -1;
  for (const [map, count] of Object.entries(v.votes)) {
    if (count > maxVotes) { maxVotes = count; winner = map; }
  }
  voteData.delete(matchId);
  nextMapVote = winner;
  io.to(matchId.toString()).emit('voteEnd', { winner, votes: v.votes });
  console.log(`[Vote] Match ${matchId} → next map: ${winner}`);
}

io.on('connection', socket => {
  let match=null, player=null;
  socket.on('join', ({name}) => {
    match=getMatch(); player=mkPlayer(socket.id,name,match); match.players.set(socket.id,player); socket.join(match.id.toString());
    socket.emit('joined',{
      playerId:socket.id,
      mapName:match.mapName,
      mode:match.mode,
      team:player.team,
      spawnX:player.x,spawnZ:player.z,
      pickups:match.pickups,
      barrels:match.barrels,
      timeLeft:Math.max(0,Math.floor((match.startTime+(match.durationMs||MATCH_DURATION)-Date.now())/1000)),
      matchId:match.id,
      inventory:player.inventory,
      money:player.money,
      playerCount:match.players.size
    });
    socket.to(match.id.toString()).emit('pJoin',{id:socket.id,name:player.name});
    console.log(`+ ${player.name} → match ${match.id} [${match.players.size}/${MAX_PLAYERS}] ${match.mapName}`);
  });
  socket.on('move',data=>{
    if(!player||player.dead) return;
    const now=Date.now();
    const streakBoost = (player.streakSpeedEnd && now < player.streakSpeedEnd) ? 1.35 : 1.0;
    const permBoost = player.speedMult || 1.0;
    const maxStep = 2.5 * permBoost * streakBoost;
    if(Math.hypot(data.x-player.x,data.z-player.z) > maxStep) return;
    player.x=data.x;player.z=data.z;player.angle=data.a;
  });
  socket.on('shoot',data=>{
    if (!player||player.dead||!match) return;
    const wd=WDEF[data.wk]; if (!wd||wd.type==='melee'||wd.type==='throw') return;
    const now=Date.now(); if (now-player.lastShot<(wd.cdMs-30)) return; player.lastShot=now;
    if (wd.type==='rocket') {
      const pitch = Number.isFinite(data.p) ? data.p : 0;
      const ca=Math.cos(data.a), sa=Math.sin(data.a), cp=Math.cos(pitch), sp=Math.sin(pitch);
      const vx=sa*cp*wd.speed, vz=ca*cp*wd.speed, vy=-sp*wd.speed;
      match.rockets.push({id:++match.bulletId,x:player.x+sa*0.9,y:EYE_Y,z:player.z+ca*0.9,vx,vy,vz,owner:socket.id,traveled:0,maxDist:wd.maxDist});
    } else {
      const pitch = Number.isFinite(data.p) ? data.p : 0;
      for (let i=0;i<(wd.pellets||1);i++) {
        const spr=(wd.spread||0.025)*(Math.random()-0.5)*2;
        const ang=data.a+spr;
        const ca=Math.cos(ang), sa=Math.sin(ang);
        const cp=Math.cos(pitch), sp=Math.sin(pitch);
        const vx=sa*cp*wd.speed, vz=ca*cp*wd.speed, vy=-sp*wd.speed;
        match.bullets.push({id:++match.bulletId,x:player.x+sa*0.9,y:EYE_Y,z:player.z+ca*0.9,vx,vy,vz,owner:socket.id,damage:wd.damage,color:wd.bColor,traveled:0,maxDist:wd.maxDist,wk:data.wk});
      }
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
  socket.on('airstrike', data => {
    if (!player || !match || player.dead) return;
    if (!player.airstrikeReady) return;
    const x = +data?.x, z = +data?.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (Math.abs(x) > 70 || Math.abs(z) > 70) return;
    player.airstrikeReady = false;
    io.to(match.id.toString()).emit('airstrike', { x, z, by: player.name });
    const blastR = 7.5;
    const dmg = 90;
    for (let i=0;i<7;i++) {
      setTimeout(() => {
        if (!match.active) return;
        const ox = x + (Math.random() - 0.5) * 16;
        const oz = z + (Math.random() - 0.5) * 16;
        io.to(match.id.toString()).emit('explosion', { x: ox, z: oz, big:true });
        for (const [pid,p] of match.players) {
          const d2=Math.hypot(p.x-ox,p.z-oz);
          if (d2 < blastR) damage(match, pid, Math.round(dmg*(1-d2/blastR)), player.id);
        }
      }, 650 + i*140);
    }
  });
  socket.on('pickup',data=>{
    if (!player||!match) return;
    const pk=match.pickups.find(p=>p.id===data.id&&p.active); if (!pk) return;
    if (Math.hypot(player.x-pk.x,player.z-pk.z)>3.5) return;
    if (player.inventory.length >= 7) {
      socket.emit('pickupOK',{id:null,inventory:player.inventory,msg:'SLOTS FULL!'});
      return;
    }
    pk.active=false;
    const AMMO={pistol:12,shotgun:8,rifle:30,smg:45,sniper:5,minigun:120,crossbow:8,rocket:4,flamethrower:80};
    let msg='';
    if (pk.type==='supply') {
      const rare = ['sniper','rocket','crossbow','minigun'][Math.floor(Math.random()*4)];
      const ex=player.inventory.find(w=>w.key===rare);
      if(ex) ex.ammo = Math.min((ex.ammo||0) + AMMO[rare], AMMO[rare]*2);
      else player.inventory.push({ key: rare, ammo: AMMO[rare] });
      msg = 'SUPPLY DROP: ' + rare.toUpperCase();
      socket.emit('pickupOK',{id:pk.id,inventory:player.inventory,msg});
      io.to(match.id.toString()).emit('pickupGone',{id:pk.id});
      const idx = match.pickups.indexOf(pk);
      if (idx !== -1) match.pickups.splice(idx, 1);
      return;
    }
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
  socket.on('vote', ({ map }) => {
    if (!match || !player) return;
    const v = voteData.get(match.id);
    if (!v || v.playerVotes.has(socket.id)) return;
    if (!v.choices.includes(map)) return;
    v.playerVotes.set(socket.id, map);
    v.votes[map] = (v.votes[map] || 0) + 1;
    // Broadcast updated vote counts
    io.to(match.id.toString()).emit('voteUpdate', { votes: v.votes });
  });
  socket.on('disconnect',()=>{
    if (match&&player){match.players.delete(socket.id);socket.to(match.id.toString()).emit('pLeave',{id:socket.id,name:player.name});console.log(`- ${player.name} left match ${match.id}`);if(match.players.size===0&&match.active){match.active=false;matches.delete(match.id);}}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🎮  Forest Deathmatch Online  →  http://localhost:${PORT}\n`));

