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
const TICK_MS        = 50;
const MAPS           = ['forest','city','warehouse','desert','arctic','rooftop'];
const KILL_REWARD    = 150;
const ASSIST_REWARD  = 50;
const HEADSHOT_MULT  = 2.2;
const BARREL_DAMAGE  = 80;
const BARREL_BLAST_R = 6.0;
const EYE_Y = 1.52;
const HEAD_Y = 1.5;

// Mode durations
const MODE_DURATION = { ffa: 360000, tdm: 480000, lms: 300000 };

// ─── WEAPON DEFINITIONS (realistic balancing) ─────────────────
const WDEF = {
  fists:        { type:'melee',  damage:15,   range:2.0,  cdMs:450 },
  knife:        { type:'melee',  damage:50,   range:2.2,  cdMs:350 },
  grenade:      { type:'throw',  damage:95,   blastR:5.5, cdMs:800 },
  // Guns: higher speed = faster travel, falloffStart = full dmg until this dist, falloffEnd = min dmg dist
  pistol:       { type:'gun',    damage:32,   speed:1.10, maxDist:35, maxAmmo:13,  cdMs:360,  bColor:0xffee00, falloffStart:18, falloffEnd:32, minDmgPct:0.55 },
  shotgun:      { type:'gun',    damage:25,   speed:0.90, maxDist:16, maxAmmo:8,   cdMs:750,  bColor:0xff8800, pellets:8, spread:0.20, falloffStart:6, falloffEnd:14, minDmgPct:0.30 },
  rifle:        { type:'gun',    damage:22,   speed:1.40, maxDist:60, maxAmmo:30,  cdMs:110,  bColor:0x00ffcc, falloffStart:30, falloffEnd:55, minDmgPct:0.65 },
  smg:          { type:'gun',    damage:12,   speed:1.15, maxDist:25, maxAmmo:30,  cdMs:80,   bColor:0xcc88ff, spread:0.032, falloffStart:12, falloffEnd:22, minDmgPct:0.50 },
  sniper:       { type:'gun',    damage:95,   speed:1.80, maxDist:95, maxAmmo:5,   cdMs:950,  bColor:0xffffff, bulletDrop:true, falloffStart:60, falloffEnd:90, minDmgPct:0.80 },
  minigun:      { type:'gun',    damage:9,    speed:1.15, maxDist:30, maxAmmo:120, cdMs:48,   bColor:0xffaa00, spread:0.14, falloffStart:10, falloffEnd:25, minDmgPct:0.40 },
  crossbow:     { type:'gun',    damage:70,   speed:1.00, maxDist:55, maxAmmo:8,   cdMs:1000, bColor:0x88ff44, bulletDrop:true, falloffStart:30, falloffEnd:50, minDmgPct:0.70 },
  rocket:       { type:'rocket', damage:110,  speed:0.60, maxDist:65, maxAmmo:4,   cdMs:2200, bColor:0xff4400, blastR:7 },
  flamethrower: { type:'gun',    damage:6,    speed:0.60, maxDist:13, maxAmmo:80,  cdMs:60,   bColor:0xff6600, pellets:5, spread:0.38, falloffStart:4, falloffEnd:12, minDmgPct:0.20 },
};

// ─── SHOP ────────────────────────────────────────────────────
const SHOP = {
  armor:        { price:200, name:'Armor Vest',    desc:'Absorbs 25% damage',         type:'upgrade' },
  heavy_armor:  { price:400, name:'Heavy Armor',   desc:'Absorbs 50% damage',         type:'upgrade', requires:'armor' },
  speed:        { price:150, name:'Speed Boost',   desc:'Move 25% faster',            type:'upgrade' },
  health_kit:   { price:80,  name:'Health Kit',    desc:'Restore 50 HP',              type:'consumable' },
  gren_pack:    { price:100, name:'Grenade Pack',  desc:'+2 Grenades',                type:'consumable' },
  ammo_crate:   { price:120, name:'Ammo Crate',    desc:'Refill all gun ammo',        type:'consumable' },
  stimpack:     { price:180, name:'Stimpack',      desc:'Regen HP for 12 seconds',    type:'consumable' },
  radar:        { price:250, name:'Radar',         desc:'Enemies always on minimap',  type:'upgrade' },
};

// ─── PICKUPS ─────────────────────────────────────────────────
const PICKUP_POS = {
  forest:    [[-20,0],[20,0],[0,20],[0,-20],[-14,14],[14,14],[-14,-14],[14,-14],[-24,8],[24,8],[8,24],[-8,-24],[-10,22],[10,-22],[22,-10],[-22,10],[0,0]],
  city:      [[-16,0],[16,0],[0,16],[0,-16],[-22,-22],[22,22],[-22,22],[22,-22],[-8,8],[8,-8],[8,8],[-8,-8],[0,28],[0,-28],[28,0],[-28,0],[0,0]],
  warehouse: [[-10,0],[10,0],[0,10],[0,-10],[-6,6],[6,-6],[6,6],[-6,-6],[-16,0],[16,0],[0,16],[0,-16],[-12,12],[12,-12],[-12,-12],[12,12],[0,0]],
  desert:    [[-18,0],[18,0],[0,18],[0,-18],[-12,12],[12,-12],[12,12],[-12,-12],[-24,6],[24,-6],[6,-24],[-6,24],[-18,-18],[18,18],[-18,18],[18,-18],[0,0]],
  arctic:    [[-15,0],[15,0],[0,15],[0,-15],[-10,10],[10,-10],[-10,-10],[10,10],[-20,5],[20,-5],[5,-20],[-5,20],[-16,-16],[16,16],[-20,0],[20,0],[0,0]],
  rooftop:   [[-14,0],[14,0],[0,14],[0,-14],[-10,10],[10,-10],[10,10],[-10,-10],[-18,0],[18,0],[0,-18],[0,18],[-14,-14],[14,14],[-8,0],[8,0],[0,0]],
};
const PGUNS = ['pistol','shotgun','rifle','smg','sniper','minigun','crossbow','rocket','flamethrower','pistol','ammo','ammo'];
function mkPickups(mapName) {
  const pos = PICKUP_POS[mapName] || PICKUP_POS.forest;
  return pos.map((p,i) => ({ id:i, type:PGUNS[i%PGUNS.length], x:p[0], z:p[1], active:true }));
}

const BARREL_POS = {
  forest:    [[-22,-6],[22,6],[-10,18],[10,-18],[-30,18],[30,-18],[0,26],[0,-26]],
  city:      [[-18,-18],[18,18],[-18,18],[18,-18],[0,-26],[0,26],[-26,0],[26,0]],
  warehouse: [[-8,-14],[8,14],[-14,8],[14,-8],[-18,0],[18,0],[0,-18],[0,18]],
  desert:    [[-24,0],[24,0],[0,-24],[0,24],[-18,-18],[18,18],[-18,18],[18,-18]],
  arctic:    [[-20,10],[20,-10],[-10,-20],[10,20],[-26,0],[26,0],[0,-26],[0,26]],
  rooftop:   [[-18,-8],[18,8],[-8,18],[8,-18],[-26,0],[26,0],[0,-26],[0,26]],
};
function mkBarrels(mapName) {
  return (BARREL_POS[mapName]||[]).map((p,i) => ({ id:i+1, x:p[0], z:p[1], alive:true }));
}

function randDropPos() {
  for (let t=0;t<80;t++) {
    const x=(Math.random()-.5)*88, z=(Math.random()-.5)*88;
    if (Math.hypot(x,z) > 48 || (Math.abs(x)<10&&Math.abs(z)<10)) continue;
    return { x, z };
  }
  return { x:0, z:32 };
}

function spawnSupplyDrop(match) {
  const { x, z } = randDropPos();
  const id = 50000 + Math.floor(Math.random()*900000) + (Date.now()%10000);
  const pk = { id, type:'supply', x, z, active:true };
  match.pickups.push(pk);
  io.to(match.id.toString()).emit('pickupBack', { id, type:'supply', x, z });
  io.to(match.id.toString()).emit('supplyDrop', { x, z });
}

// ─── MATCH MANAGEMENT ────────────────────────────────────────
let matchCtr = 0;
const matches = new Map();
let globalLB = [];
// nextMatch: { mapName, mode } — set after vote
let nextMatch = null;
const voteData = new Map();

function createMatch(mode='ffa', mapName=null) {
  const id = ++matchCtr;
  const mName = mapName || MAPS[(id-1) % MAPS.length];
  const durationMs = MODE_DURATION[mode] || 360000;
  const startTime = Date.now();
  const m = {
    id, mapName:mName, mode,
    active:true,
    players:new Map(),
    bullets:[], rockets:[], bulletId:0,
    pickups:mkPickups(mName),
    barrels:mkBarrels(mName),
    nextSupplyAt: startTime + 120000,
    zoneR:52, startTime, durationMs,
    teamScore:{ r:0, b:0 },
  };
  matches.set(id, m);
  console.log(`[Match ${id}] ${mName.toUpperCase()} mode=${mode.toUpperCase()}`);
  if (mode !== 'lms') setTimeout(() => endMatch(id), durationMs);
  return m;
}

// Find an existing match for this mode, or create one
function getMatch(mode='ffa') {
  for (const [,m] of matches) {
    if (m.active && m.mode === mode && m.players.size < MAX_PLAYERS) return m;
  }
  // Honor voted map/mode if same mode
  let mapName = null;
  if (nextMatch && nextMatch.mode === mode) {
    mapName = nextMatch.mapName;
    nextMatch = null;
  }
  return createMatch(mode, mapName);
}

// ─── PLAYER ──────────────────────────────────────────────────
function mkPlayer(sid, name, match) {
  let x,z,team=null;
  if (match.mode === 'tdm') {
    let r=0,b=0;
    for (const [,p] of match.players) { if (p.team==='r') r++; else if (p.team==='b') b++; }
    team = r<=b ? 'r' : 'b';
    x = team==='r' ? -20+Math.random()*8 : 12+Math.random()*8;
    z = (Math.random()-.5)*20;
  } else {
    const a=Math.random()*Math.PI*2, r=6+Math.random()*20;
    x=Math.cos(a)*r; z=Math.sin(a)*r;
  }
  const lives = match.mode === 'lms' ? 1 : 3;
  return {
    id:sid, name:(name||'').trim().slice(0,20)||`Player${~~(Math.random()*9000+1000)}`,
    x, z, angle:0,
    hp:100, lives, dead:false, invincible:0,
    kills:0, deaths:0, assists:0, money:200,
    streak:0, team,
    streakSpeedEnd:0, airstrikeReady:false, minigunEnd:0, streakMinigun:false,
    upgrades:{ armor:false, heavy_armor:false, speed:false, radar:false },
    speedMult:1.0, stimEnd:0, lastDamager:null,
    inventory:[{key:'fists',ammo:Infinity},{key:'knife',ammo:Infinity},{key:'grenade',ammo:2}],
    weaponIdx:0, lastShot:0, lastMelee:0,
  };
}

// ─── DAMAGE with FALLOFF ──────────────────────────────────────
function calcDamageWithFalloff(baseDmg, wdef, dist) {
  if (!wdef || !wdef.falloffStart) return baseDmg;
  if (dist <= wdef.falloffStart) return baseDmg;
  if (dist >= wdef.falloffEnd) return Math.round(baseDmg * (wdef.minDmgPct||0.5));
  const t = (dist - wdef.falloffStart) / (wdef.falloffEnd - wdef.falloffStart);
  const mult = 1 - t * (1 - (wdef.minDmgPct||0.5));
  return Math.round(baseDmg * mult);
}

function damage(match, victimId, rawDmg, killerId, meta={}) {
  const v = match.players.get(victimId);
  if (!v || v.dead || v.invincible > 0) return;
  if (match.mode === 'tdm' && killerId) {
    const k = match.players.get(killerId);
    if (k && v.team && k.team && v.team === k.team) return;
  }
  v.lastDamager = killerId;
  let dmg = rawDmg;
  const headshot = !!meta.headshot;
  if (headshot) dmg = Math.round(dmg * HEADSHOT_MULT);
  if (v.upgrades.heavy_armor) dmg = Math.round(dmg * 0.5);
  else if (v.upgrades.armor)  dmg = Math.round(dmg * 0.75);
  v.hp = Math.max(0, v.hp - dmg);
  io.to(victimId).emit('hit', { hp:v.hp, dmg, headshot });
  if (killerId && killerId !== victimId)
    io.to(killerId).emit('hitMarker', { hp:v.hp, headshot, dmg });
  if (v.hp <= 0) onKill(match, v, killerId, { headshot });
  else io.to(match.id.toString()).emit('pHurt', { id:victimId, hp:v.hp });
}

function onKill(match, v, killerId, meta={}) {
  v.dead=true; v.hp=0; v.lives--; v.deaths++;
  v.streak=0; v.streakSpeedEnd=0; v.airstrikeReady=false;
  const k = killerId ? match.players.get(killerId) : null;
  if (k) {
    k.kills++; k.money += KILL_REWARD;
    k.streak = (k.streak||0) + 1;
    io.to(killerId).emit('earnMoney', { amount:KILL_REWARD, total:k.money, reason:'KILL' });
    if (v.lastDamager && v.lastDamager !== killerId) {
      const ass = match.players.get(v.lastDamager);
      if (ass) { ass.money += ASSIST_REWARD; io.to(v.lastDamager).emit('earnMoney', { amount:ASSIST_REWARD, total:ass.money, reason:'ASSIST' }); }
    }
    io.to(match.id.toString()).emit('kill', { kn:k.name, vn:v.name, ki:killerId, vi:v.id, hs:!!meta.headshot, streak:k.streak });
    // TDM team score
    if (match.mode==='tdm' && k.team) {
      match.teamScore[k.team] = (match.teamScore[k.team]||0) + 1;
      io.to(match.id.toString()).emit('teamScore', match.teamScore);
      if (match.teamScore[k.team] >= 30) { endMatch(match.id); return; }
    }
    // Killstreak rewards
    if (k.streak === 3) {
      k.streakSpeedEnd = Date.now() + 12000;
      io.to(killerId).emit('streakReward', { type:'speed', ms:12000, streak:3 });
    } else if (k.streak === 5) {
      k.airstrikeReady = true;
      io.to(killerId).emit('streakReward', { type:'airstrike', streak:5 });
    } else if (k.streak === 7) {
      k.minigunEnd = Date.now() + 15000;
      k.streakMinigun = true;
      const ex = k.inventory.find(w=>w.key==='minigun');
      if (ex) ex.ammo = Math.max(ex.ammo||0, 240);
      else k.inventory.push({ key:'minigun', ammo:240 });
      io.to(killerId).emit('streakReward', { type:'minigun', ms:15000, streak:7 });
      io.to(killerId).emit('pickupOK', { id:null, inventory:k.inventory, msg:'MINIGUN UNLOCKED (15s)' });
    }
    // LMS: check win condition
    if (match.mode === 'lms') {
      const alive = [...match.players.values()].filter(p => !p.dead && p.lives > 0);
      if (alive.length <= 1) {
        setTimeout(() => endMatch(match.id), 2000);
        return;
      }
    }
  }
  io.to(v.id).emit('youDied', { lives:v.lives, money:v.money });
  if (v.lives > 0) {
    setTimeout(() => {
      if (!match.active) return;
      let nx,nz;
      if (match.mode==='tdm'&&v.team) {
        nx=v.team==='r'?-20+Math.random()*8:12+Math.random()*8;
        nz=(Math.random()-.5)*20;
      } else {
        const a2=Math.random()*Math.PI*2, r2=6+Math.random()*20;
        nx=Math.cos(a2)*r2; nz=Math.sin(a2)*r2;
      }
      Object.assign(v, { x:nx, z:nz, hp:100, dead:false, invincible:3500 });
      const g = v.inventory.find(w=>w.key==='grenade'); if (g&&g.ammo<2) g.ammo++;
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
  const AMMO={pistol:13,shotgun:8,rifle:30,smg:30,sniper:5,minigun:120,crossbow:8,rocket:4,flamethrower:80};
  if (key==='health_kit') player.hp = Math.min(100, player.hp+50);
  else if (key==='gren_pack') { const g=player.inventory.find(w=>w.key==='grenade'); if(g) g.ammo+=2; else player.inventory.push({key:'grenade',ammo:2}); }
  else if (key==='ammo_crate') { for (const w of player.inventory) if (AMMO[w.key]) w.ammo=AMMO[w.key]; }
  else if (key==='stimpack') player.stimEnd = Date.now()+12000;
  return { ok:true, money:player.money, inventory:player.inventory, hp:player.hp };
}

// ─── TICK ────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [,m] of matches) {
    if (!m.active) continue;
    // Supply drops
    if (now >= m.nextSupplyAt) { m.nextSupplyAt = now+120000; spawnSupplyDrop(m); }
    // LMS shrinking zone
    if (m.mode === 'lms') {
      const t = Math.max(0, Math.min(1, (now-m.startTime)/m.durationMs));
      m.zoneR = 52 - (52-14)*t;
    } else { m.zoneR = 52; }
    for (const [,p] of m.players) {
      if (p.invincible>0) p.invincible = Math.max(0, p.invincible-TICK_MS);
      if (p.stimEnd>now && !p.dead) p.hp = Math.min(100, p.hp+0.15);
      if (m.mode==='lms' && !p.dead && Math.hypot(p.x,p.z)>m.zoneR)
        damage(m, p.id, 1.5, null);
      // Minigun expiry
      if (p.minigunEnd && now>=p.minigunEnd) {
        p.minigunEnd=0;
        if (p.streakMinigun) {
          p.streakMinigun=false;
          const idx=p.inventory.findIndex(w=>w.key==='minigun');
          if (idx!==-1) p.inventory.splice(idx,1);
          if (p.weaponIdx>=p.inventory.length) p.weaponIdx=Math.max(0,p.inventory.length-1);
          io.to(p.id).emit('pickupOK', { id:null, inventory:p.inventory, msg:'MINIGUN EXPIRED' });
        }
      }
    }
    // Bullets — realistic physics
    for (let i=m.bullets.length-1;i>=0;i--) {
      const b = m.bullets[i];
      const wd = WDEF[b.wk];
      // Bullet drop (gravity) for sniper/crossbow
      if (wd && wd.bulletDrop) b.vy -= 0.0018*(TICK_MS/50);
      b.x+=b.vx; b.y+=b.vy; b.z+=b.vz;
      b.traveled += Math.hypot(b.vx, b.vz, b.vy||0);
      if (b.traveled>b.maxDist || Math.abs(b.x)>75 || Math.abs(b.z)>75 || (b.y!==undefined&&b.y<0)) {
        m.bullets.splice(i,1); continue;
      }
      let hit=false;
      // Barrel hit
      for (const br of m.barrels) {
        if (!br.alive) continue;
        if ((b.x-br.x)**2+(b.z-br.z)**2 < 0.8) {
          br.alive=false;
          io.to(m.id.toString()).emit('explosion', { x:br.x, z:br.z, big:false });
          io.to(m.id.toString()).emit('barrelGone', { id:br.id });
          for (const [pid,p] of m.players) {
            const d2=Math.hypot(p.x-br.x, p.z-br.z);
            if (d2<BARREL_BLAST_R) damage(m,pid,Math.round(BARREL_DAMAGE*(1-d2/BARREL_BLAST_R)),b.owner);
          }
          m.bullets.splice(i,1); hit=true; break;
        }
      }
      if (hit) continue;
      // Player hit
      for (const [pid,p] of m.players) {
        if (pid===b.owner || p.dead || p.invincible>0) continue;
        const dx=b.x-p.x, dz=b.z-p.z;
        if (dx*dx+dz*dz < 0.9) {
          const headshot = (b.y===undefined ? false : b.y > HEAD_Y);
          // Apply distance falloff
          const dist = b.traveled;
          const dmg = calcDamageWithFalloff(b.damage, wd, dist);
          damage(m, pid, dmg, b.owner, { headshot });
          io.to(m.id.toString()).emit('bulletImpact', { x:b.x, y:b.y||1, z:b.z });
          m.bullets.splice(i,1); hit=true; break;
        }
      }
    }
    // Rockets
    for (let i=m.rockets.length-1;i>=0;i--) {
      const r=m.rockets[i];
      r.vy -= 0.0012*(TICK_MS/50);
      r.x+=r.vx; r.y+=r.vy; r.z+=r.vz; r.traveled+=Math.hypot(r.vx,r.vz,r.vy||0);
      let boom = r.traveled>WDEF.rocket.maxDist || Math.abs(r.x)>75 || Math.abs(r.z)>75 || (r.y<0);
      for (const [pid,p] of m.players) { if (pid!==r.owner&&!p.dead&&(r.x-p.x)**2+(r.z-p.z)**2<1.4) { boom=true; break; } }
      // Barrel hit
      for (const br of m.barrels) {
        if (!br.alive) continue;
        if (Math.hypot(br.x-r.x, br.z-r.z)<1.2) { br.alive=false; io.to(m.id.toString()).emit('barrelGone',{id:br.id}); boom=true; break; }
      }
      if (boom) {
        io.to(m.id.toString()).emit('explosion', { x:r.x, z:r.z, big:true });
        for (const [pid,p] of m.players) {
          const d2=Math.hypot(p.x-r.x, p.z-r.z);
          if (d2<WDEF.rocket.blastR) damage(m,pid,Math.round(WDEF.rocket.damage*(1-d2/WDEF.rocket.blastR)),r.owner);
        }
        m.rockets.splice(i,1);
      }
    }

    const T=Math.max(0,Math.floor((m.startTime+m.durationMs-now)/1000));
    const LB=[...m.players.values()].sort((a,b)=>b.kills-a.kills).slice(0,10).map(p=>({n:p.name,k:p.kills,d:p.deaths,m:p.money,t:p.team}));
    io.to(m.id.toString()).emit('S', {
      P:[...m.players.values()].map(p=>({
        i:p.id,n:p.name,x:+(p.x.toFixed(2)),z:+(p.z.toFixed(2)),a:+(p.angle.toFixed(2)),
        h:p.hp,l:p.lives,k:p.kills,d:p.dead,w:p.weaponIdx,
        ar:p.upgrades.heavy_armor?2:p.upgrades.armor?1:0,
        t:p.team,s:p.streak||0,
        sb:(p.streakSpeedEnd&&now<p.streakSpeedEnd)?1:0,
        as:!!p.airstrikeReady
      })),
      B:m.bullets.map(b=>({ i:b.id, x:+(b.x.toFixed(2)), y:+(b.y!==undefined?b.y:EYE_Y).toFixed(2), z:+(b.z.toFixed(2)), c:b.color, w:b.wk })),
      R:m.rockets.map(r=>({ i:r.id, x:+(r.x.toFixed(2)), y:+(r.y.toFixed(2)), z:+(r.z.toFixed(2)) })),
      BR:m.barrels.filter(b=>b.alive).map(b=>({ id:b.id, x:+(b.x.toFixed(1)), z:+(b.z.toFixed(1)) })),
      MO:m.mode, ZR:+(m.zoneR.toFixed(2)), TS:m.teamScore,
      T, LB, PC:m.players.size,
    });
  }
}, TICK_MS);

function endMatch(id) {
  const m=matches.get(id); if (!m||!m.active) return;
  m.active=false;
  const res=[...m.players.values()].sort((a,b)=>b.kills-a.kills).map(p=>({name:p.name,kills:p.kills,deaths:p.deaths,money:p.money,team:p.team}));
  let winner = res[0]?.name || 'Nobody';
  if (m.mode==='tdm') {
    if (m.teamScore.r > m.teamScore.b) winner='🔴 RED TEAM';
    else if (m.teamScore.b > m.teamScore.r) winner='🔵 BLUE TEAM';
    else winner='DRAW';
  }
  io.to(id.toString()).emit('matchEnd', { results:res, winner, mode:m.mode, teamScore:m.teamScore });
  for (const r of res) { const ex=globalLB.find(g=>g.name===r.name); if(ex){ex.kills+=r.kills;ex.matches++;}else globalLB.push({name:r.name,kills:r.kills,matches:1}); }
  globalLB.sort((a,b)=>b.kills-a.kills); globalLB=globalLB.slice(0,10);
  setTimeout(()=>matches.delete(id), 60000);
  setTimeout(()=>startVote(id, m.mode), 2000);
}

function startVote(matchId, mode='ffa') {
  const shuffled=[...MAPS].sort(()=>Math.random()-.5);
  const choices=shuffled.slice(0,3);
  const votes={}; choices.forEach(m=>votes[m]=0);
  const v={ choices, votes, playerVotes:new Map(), mode };
  voteData.set(matchId, v);
  io.to(matchId.toString()).emit('voteStart', { choices, seconds:20, mode });
  v.timer=setTimeout(()=>endVote(matchId), 20000);
}

function endVote(matchId) {
  const v=voteData.get(matchId); if (!v) return;
  clearTimeout(v.timer);
  let winner=v.choices[0], maxV=-1;
  for (const [map,cnt] of Object.entries(v.votes)) { if (cnt>maxV) { maxV=cnt; winner=map; } }
  voteData.delete(matchId);
  nextMatch = { mapName:winner, mode:v.mode };
  io.to(matchId.toString()).emit('voteEnd', { winner, votes:v.votes, mode:v.mode });
  console.log(`[Vote] Match ${matchId} → next: ${winner} (${v.mode})`);
}

// ─── SOCKET ──────────────────────────────────────────────────
io.on('connection', socket => {
  let match=null, player=null;

  socket.on('join', ({ name, mode='ffa' }) => {
    const validMode = ['ffa','tdm','lms'].includes(mode) ? mode : 'ffa';
    match=getMatch(validMode);
    player=mkPlayer(socket.id, name, match);
    match.players.set(socket.id, player);
    socket.join(match.id.toString());
    socket.emit('joined', {
      playerId:socket.id, mapName:match.mapName, mode:match.mode, team:player.team,
      spawnX:player.x, spawnZ:player.z,
      pickups:match.pickups, barrels:match.barrels,
      timeLeft:Math.max(0, Math.floor((match.startTime+match.durationMs-Date.now())/1000)),
      matchId:match.id, inventory:player.inventory, money:player.money,
      playerCount:match.players.size, teamScore:match.teamScore,
    });
    socket.to(match.id.toString()).emit('pJoin', { id:socket.id, name:player.name, team:player.team });
    console.log(`+ ${player.name} → match ${match.id} [${match.players.size}/${MAX_PLAYERS}] ${match.mapName} ${match.mode}`);
  });

  socket.on('move', data => {
    if (!player||player.dead) return;
    const now=Date.now();
    const streakBoost=(player.streakSpeedEnd&&now<player.streakSpeedEnd)?1.35:1.0;
    const maxStep=2.5*player.speedMult*streakBoost;
    if (Math.hypot(data.x-player.x, data.z-player.z)>maxStep) return;
    player.x=data.x; player.z=data.z; player.angle=data.a;
  });

  socket.on('shoot', data => {
    if (!player||player.dead||!match) return;
    const wd=WDEF[data.wk]; if (!wd||wd.type==='melee'||wd.type==='throw') return;
    const now=Date.now(); if (now-player.lastShot<(wd.cdMs-30)) return; player.lastShot=now;
    const pitch=Number.isFinite(data.p)?data.p:0;
    if (wd.type==='rocket') {
      const ca=Math.cos(data.a),sa=Math.sin(data.a),cp=Math.cos(pitch),sp=Math.sin(pitch);
      match.rockets.push({ id:++match.bulletId, x:player.x+sa*0.9, y:EYE_Y, z:player.z+ca*0.9, vx:sa*cp*wd.speed, vy:-sp*wd.speed, vz:ca*cp*wd.speed, owner:socket.id, traveled:0, maxDist:wd.maxDist });
    } else {
      for (let i=0;i<(wd.pellets||1);i++) {
        const spr=(wd.spread||0.018)*(Math.random()-.5)*2;
        const ang=data.a+spr;
        const ca=Math.cos(ang),sa=Math.sin(ang),cp=Math.cos(pitch),sp=Math.sin(pitch);
        match.bullets.push({ id:++match.bulletId, x:player.x+sa*0.9, y:EYE_Y, z:player.z+ca*0.9, vx:sa*cp*wd.speed, vy:-sp*wd.speed, vz:ca*cp*wd.speed, owner:socket.id, damage:wd.damage, color:wd.bColor, traveled:0, maxDist:wd.maxDist, wk:data.wk });
      }
    }
  });

  socket.on('melee', () => {
    if (!player||player.dead||!match) return;
    const now=Date.now(); if (now-player.lastMelee<350) return; player.lastMelee=now;
    const wd=WDEF[player.inventory[player.weaponIdx]?.key]||WDEF.fists;
    for (const [pid,p] of match.players) {
      if (pid===socket.id||p.dead) continue;
      if (Math.hypot(p.x-player.x, p.z-player.z)<(wd.range||2.0)) {
        damage(match, pid, wd.damage||15, socket.id); break;
      }
    }
  });

  socket.on('grenade', data => {
    if (!player||player.dead||!match) return;
    setTimeout(() => {
      if (!match.active) return;
      io.to(match.id.toString()).emit('explosion', { x:data.x, z:data.z, big:false });
      for (const [pid,p] of match.players) {
        const d2=Math.hypot(p.x-data.x, p.z-data.z);
        if (d2<WDEF.grenade.blastR) damage(match,pid,Math.round(WDEF.grenade.damage*(1-d2/WDEF.grenade.blastR)),socket.id);
      }
      // Barrel chain
      for (const br of match.barrels) {
        if (!br.alive) continue;
        if (Math.hypot(br.x-data.x, br.z-data.z)<WDEF.grenade.blastR) {
          br.alive=false;
          io.to(match.id.toString()).emit('explosion',{x:br.x,z:br.z,big:false});
          io.to(match.id.toString()).emit('barrelGone',{id:br.id});
        }
      }
    }, 2600);
    io.to(match.id.toString()).emit('grenadeFly', { ox:player.x, oz:player.z, vx:data.vx, vy:data.vy||0.18, vz:data.vz });
  });

  socket.on('airstrike', data => {
    if (!player||!match||player.dead||!player.airstrikeReady) return;
    const x=+data?.x, z=+data?.z;
    if (!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>70||Math.abs(z)>70) return;
    player.airstrikeReady=false;
    io.to(match.id.toString()).emit('airstrike', { x, z, by:player.name });
    for (let i=0;i<7;i++) {
      setTimeout(() => {
        if (!match.active) return;
        const ox=x+(Math.random()-.5)*16, oz=z+(Math.random()-.5)*16;
        io.to(match.id.toString()).emit('explosion', { x:ox, z:oz, big:true });
        for (const [pid,p] of match.players) {
          const d2=Math.hypot(p.x-ox,p.z-oz);
          if (d2<7.5) damage(match,pid,Math.round(90*(1-d2/7.5)),player.id);
        }
      }, 650+i*140);
    }
  });

  socket.on('pickup', data => {
    if (!player||!match) return;
    const pk=match.pickups.find(p=>p.id===data.id&&p.active); if (!pk) return;
    if (Math.hypot(player.x-pk.x, player.z-pk.z)>3.5) return;
    if (player.inventory.length>=7) { socket.emit('pickupOK',{id:null,inventory:player.inventory,msg:'SLOTS FULL!'}); return; }
    pk.active=false;
    const AMMO={pistol:13,shotgun:8,rifle:30,smg:30,sniper:5,minigun:120,crossbow:8,rocket:4,flamethrower:80};
    let msg='';
    if (pk.type==='supply') {
      const rare=['sniper','rocket','crossbow','minigun'][Math.floor(Math.random()*4)];
      const ex=player.inventory.find(w=>w.key===rare);
      if (ex) ex.ammo=Math.min((ex.ammo||0)+AMMO[rare],AMMO[rare]*2);
      else player.inventory.push({key:rare,ammo:AMMO[rare]});
      msg='SUPPLY DROP: '+rare.toUpperCase();
      socket.emit('pickupOK',{id:pk.id,inventory:player.inventory,msg});
      io.to(match.id.toString()).emit('pickupGone',{id:pk.id});
      const idx=match.pickups.indexOf(pk); if(idx!==-1) match.pickups.splice(idx,1);
      return;
    }
    if (pk.type==='ammo') {
      for (const w of player.inventory) if (AMMO[w.key]) w.ammo=Math.min((w.ammo||0)+Math.ceil(AMMO[w.key]*0.6),AMMO[w.key]*2);
      msg='AMMO CRATE';
    } else {
      const ex=player.inventory.find(w=>w.key===pk.type);
      if (ex) ex.ammo=Math.min((ex.ammo||0)+AMMO[pk.type],AMMO[pk.type]*2);
      else player.inventory.push({key:pk.type,ammo:AMMO[pk.type]});
      msg=pk.type.toUpperCase()+' PICKED UP';
    }
    socket.emit('pickupOK',{id:pk.id,inventory:player.inventory,msg});
    io.to(match.id.toString()).emit('pickupGone',{id:pk.id});
    setTimeout(()=>{ if(!match.active)return; pk.active=true; io.to(match.id.toString()).emit('pickupBack',{id:pk.id,type:pk.type,x:pk.x,z:pk.z}); },20000);
  });

  socket.on('switchWeapon', ({idx}) => { if (player&&idx>=0&&idx<player.inventory.length) player.weaponIdx=idx; });

  socket.on('dropWeapon', data => {
    if (!player||!match||player.dead) return;
    const wep=player.inventory[data.idx];
    if (!wep||['fists','knife','grenade'].includes(wep.key)) return;
    const newId=10000+Date.now()%100000+Math.floor(Math.random()*1000);
    const pk={ id:newId, type:wep.key, x:player.x+(Math.random()-.5)*1.5, z:player.z+(Math.random()-.5)*1.5, active:true };
    match.pickups.push(pk);
    player.inventory.splice(data.idx,1);
    if (player.weaponIdx>=player.inventory.length) player.weaponIdx=Math.max(0,player.inventory.length-1);
    io.to(match.id.toString()).emit('pickupBack',{id:newId,type:pk.type,x:pk.x,z:pk.z});
    socket.emit('pickupOK',{id:null,inventory:player.inventory,msg:wep.key.toUpperCase()+' DROPPED'});
    setTimeout(()=>{ if(!match.active)return; const i=match.pickups.indexOf(pk); if(i!==-1&&pk.active){match.pickups.splice(i,1);io.to(match.id.toString()).emit('pickupGone',{id:newId});} },30000);
  });

  socket.on('buyItem', ({itemKey}) => { if (!player||!match) return; socket.emit('shopResult',{itemKey,...buyItem(match,player,itemKey)}); });

  socket.on('vote', ({map}) => {
    if (!match||!player) return;
    const v=voteData.get(match.id);
    if (!v||v.playerVotes.has(socket.id)||!v.choices.includes(map)) return;
    v.playerVotes.set(socket.id,map);
    v.votes[map]=(v.votes[map]||0)+1;
    io.to(match.id.toString()).emit('voteUpdate',{votes:v.votes});
  });

  socket.on('disconnect', () => {
    if (match&&player) {
      match.players.delete(socket.id);
      socket.to(match.id.toString()).emit('pLeave',{id:socket.id,name:player.name});
      console.log(`- ${player.name} left match ${match.id}`);
      if (match.players.size===0&&match.active) { match.active=false; matches.delete(match.id); }
    }
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT, () => console.log(`\n🎮  Forest Deathmatch Online  →  http://localhost:${PORT}\n`));
