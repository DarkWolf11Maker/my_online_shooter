const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── CONSTANTS ───────────────────────────────────────────────
const MAX_PLAYERS = 50;
const MATCH_DURATION = 600000; // 10 minutes
const TICK_RATE = 20; // Hz
const MAPS = ['forest', 'city', 'warehouse'];
const SPAWN_RADIUS = { forest: 28, city: 25, warehouse: 18 };

const WEAPON_DEFS = {
  fists:   { damage: 15, range: 2.0, type: 'melee' },
  knife:   { damage: 45, range: 2.2, type: 'melee' },
  grenade: { damage: 90, blastR: 5.5, type: 'throw' },
  pistol:  { damage: 28, speed: 0.80, maxDist: 35, maxAmmo: 12, bColor: 0xffee00, type: 'gun' },
  shotgun: { damage: 22, speed: 0.75, maxDist: 22, maxAmmo:  8, bColor: 0xff8800, type: 'gun', pellets: 5, spread: 0.22 },
  rifle:   { damage: 18, speed: 1.20, maxDist: 55, maxAmmo: 30, bColor: 0x00ffcc, type: 'gun' },
  smg:     { damage: 10, speed: 1.00, maxDist: 26, maxAmmo: 45, bColor: 0xcc88ff, type: 'gun' },
};

const SHOOT_COOLDOWN = { pistol: 350, shotgun: 650, rifle: 110, smg: 70 };
const MELEE_COOLDOWN = 380;

// ─── MATCH MANAGEMENT ────────────────────────────────────────
let matchIdCounter = 0;
const matches = new Map();
let globalLeaderboard = []; // top 10 all-time kills

function createMatch() {
  const id = ++matchIdCounter;
  const mapName = MAPS[(id - 1) % MAPS.length];
  const match = {
    id, mapName,
    players: new Map(),
    bullets: [],
    activeGrenades: [],
    pickups: generatePickups(mapName),
    startTime: Date.now(),
    active: true,
    bulletCounter: 0,
  };
  matches.set(id, match);
  console.log(`⚔️  Match ${id} created on map: ${mapName.toUpperCase()}`);
  setTimeout(() => endMatch(id), MATCH_DURATION);
  return match;
}

function getAvailableMatch() {
  for (const [, m] of matches)
    if (m.active && m.players.size < MAX_PLAYERS) return m;
  return createMatch();
}

// ─── PICKUP LAYOUTS ──────────────────────────────────────────
const PICKUP_POSITIONS = {
  forest: [
    [-20,0],[20,0],[0,20],[0,-20],[-14,14],[14,14],[-14,-14],[14,-14],
    [-24,8],[24,8],[8,24],[-8,-24],[0,0],[-10,22],[10,-22],[22,-10],[-22,10]
  ],
  city: [
    [-16,0],[16,0],[0,16],[0,-16],[-22,-22],[22,22],[-22,22],[22,-22],
    [-8,8],[8,-8],[8,8],[-8,-8],[0,28],[0,-28],[28,0],[-28,0],[0,0]
  ],
  warehouse: [
    [-10,0],[10,0],[0,10],[0,-10],[-6,6],[6,-6],[6,6],[-6,-6],
    [-16,0],[16,0],[0,16],[0,-16],[-12,12],[12,-12],[-12,-12],[12,12],[0,0]
  ],
};

function generatePickups(mapName) {
  const guns = ['pistol','shotgun','rifle','smg'];
  return (PICKUP_POSITIONS[mapName] || PICKUP_POSITIONS.forest).map((pos, i) => ({
    id: i,
    type: i % 5 === 4 ? 'ammo' : guns[i % guns.length],
    x: pos[0], z: pos[1],
    active: true,
  }));
}

// ─── PLAYER FACTORY ──────────────────────────────────────────
function spawnPosition(match) {
  const r = SPAWN_RADIUS[match.mapName] || 22;
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a) * (r * 0.5 + Math.random() * r * 0.5),
           z: Math.sin(a) * (r * 0.5 + Math.random() * r * 0.5) };
}

function createPlayer(socketId, name, match) {
  const sp = spawnPosition(match);
  return {
    id: socketId,
    name: (name || '').trim().slice(0, 20) || `Soldier${Math.floor(Math.random()*9000)+1000}`,
    x: sp.x, y: 0, z: sp.z,
    angle: Math.random() * Math.PI * 2,
    hp: 100, lives: 3,
    kills: 0, deaths: 0,
    dead: false, invincible: 0,
    inventory: [
      { key: 'fists',   ammo: Infinity },
      { key: 'knife',   ammo: Infinity },
      { key: 'grenade', ammo: 2 },
    ],
    weaponIdx: 0,
    lastShot: 0,
    lastMelee: 0,
  };
}

// ─── DAMAGE SYSTEM ───────────────────────────────────────────
function applyDamage(match, victimId, dmg, killerId) {
  const victim = match.players.get(victimId);
  if (!victim || victim.dead || victim.invincible > 0) return;
  victim.hp = Math.max(0, victim.hp - dmg);

  io.to(match.id.toString()).emit('hit', { id: victimId, hp: victim.hp, dmg });

  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.dead = true;
    victim.lives--;
    victim.deaths++;

    const killer = killerId ? match.players.get(killerId) : null;
    if (killer) {
      killer.kills++;
      io.to(match.id.toString()).emit('kill', {
        kn: killer.name, vn: victim.name, ki: killerId, vi: victimId
      });
    }

    io.to(victimId).emit('youDied', { lives: victim.lives });

    if (victim.lives > 0) {
      setTimeout(() => {
        if (!match.active) return;
        const sp = spawnPosition(match);
        victim.x = sp.x; victim.z = sp.z;
        victim.hp = 100; victim.dead = false;
        victim.invincible = 3500;
        // Partial grenade restore
        const gren = victim.inventory.find(w => w.key === 'grenade');
        if (gren && gren.ammo < 2) gren.ammo++;
        io.to(victimId).emit('respawned', { x: victim.x, z: victim.z, inventory: victim.inventory });
      }, 3000);
    } else {
      setTimeout(() => io.to(victimId).emit('eliminated'), 500);
    }
  }
}

// ─── GAME TICK ───────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [, match] of matches) {
    if (!match.active) continue;

    // Tick invincibility
    for (const [, p] of match.players)
      if (p.invincible > 0) p.invincible = Math.max(0, p.invincible - 1000 / TICK_RATE);

    // Update bullets
    for (let i = match.bullets.length - 1; i >= 0; i--) {
      const b = match.bullets[i];
      b.x += b.vx; b.z += b.vz;
      b.traveled += Math.hypot(b.vx, b.vz);
      if (b.traveled > b.maxDist || Math.abs(b.x) > 65 || Math.abs(b.z) > 65) {
        match.bullets.splice(i, 1); continue;
      }
      let hit = false;
      for (const [pid, p] of match.players) {
        if (pid === b.owner || p.dead || p.invincible > 0) continue;
        if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 < 0.81) {
          applyDamage(match, pid, b.damage, b.owner);
          match.bullets.splice(i, 1); hit = true; break;
        }
      }
      if (hit) continue;
    }

    // Build leaderboard
    const lb = [...match.players.values()]
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 10)
      .map(p => ({ n: p.name, k: p.kills, d: p.deaths }));

    // Broadcast state (compressed keys for bandwidth)
    io.to(match.id.toString()).emit('S', {
      P: [...match.players.values()].map(p => ({
        i: p.id, n: p.name, x: Math.round(p.x * 100) / 100,
        z: Math.round(p.z * 100) / 100, a: Math.round(p.angle * 100) / 100,
        h: p.hp, l: p.lives, k: p.kills, d: p.dead, w: p.weaponIdx,
      })),
      B: match.bullets.map(b => ({ i: b.id, x: b.x, z: b.z, c: b.color })),
      T: Math.max(0, Math.floor((match.startTime + MATCH_DURATION - now) / 1000)),
      LB: lb,
      PC: match.players.size,
    });
  }
}, 1000 / TICK_RATE);

// ─── MATCH END ───────────────────────────────────────────────
function endMatch(matchId) {
  const match = matches.get(matchId);
  if (!match || !match.active) return;
  match.active = false;

  const results = [...match.players.values()]
    .sort((a, b) => b.kills - a.kills)
    .map(p => ({ name: p.name, kills: p.kills, deaths: p.deaths }));

  io.to(matchId.toString()).emit('matchEnd', { results, winner: results[0]?.name });

  // Update global leaderboard
  for (const r of results) {
    const ex = globalLeaderboard.find(g => g.name === r.name);
    if (ex) { ex.kills += r.kills; ex.deaths += r.deaths; ex.matches++; }
    else globalLeaderboard.push({ name: r.name, kills: r.kills, deaths: r.deaths, matches: 1 });
  }
  globalLeaderboard.sort((a, b) => b.kills - a.kills);
  globalLeaderboard = globalLeaderboard.slice(0, 10);

  console.log(`🏁 Match ${matchId} ended. Winner: ${results[0]?.name || 'none'}`);
  setTimeout(() => matches.delete(matchId), 30000);
}

// ─── SOCKET HANDLERS ─────────────────────────────────────────
io.on('connection', socket => {
  let match = null, player = null;
  console.log(`🔗 Connected: ${socket.id}`);

  socket.on('join', ({ name }) => {
    match = getAvailableMatch();
    player = createPlayer(socket.id, name, match);
    match.players.set(socket.id, player);
    socket.join(match.id.toString());

    socket.emit('joined', {
      playerId: socket.id,
      mapName: match.mapName,
      spawnX: player.x, spawnZ: player.z,
      pickups: match.pickups,
      timeLeft: Math.max(0, Math.floor((match.startTime + MATCH_DURATION - Date.now()) / 1000)),
      matchId: match.id,
      inventory: player.inventory,
      playerCount: match.players.size,
      globalLeaderboard,
    });

    socket.to(match.id.toString()).emit('pJoin', { id: socket.id, name: player.name, count: match.players.size });
    console.log(`👤 ${player.name} joined match ${match.id} [${match.players.size}/${MAX_PLAYERS}] on ${match.mapName}`);
  });

  socket.on('move', data => {
    if (!player || player.dead) return;
    const dx = data.x - player.x, dz = data.z - player.z;
    if (Math.hypot(dx, dz) > 2.0) return; // anti-teleport
    player.x = data.x; player.z = data.z; player.angle = data.a;
  });

  socket.on('shoot', data => {
    if (!player || player.dead || !match) return;
    const wdef = WEAPON_DEFS[data.wk];
    if (!wdef || wdef.type !== 'gun') return;
    const now = Date.now();
    if (now - player.lastShot < (SHOOT_COOLDOWN[data.wk] - 30)) return;
    player.lastShot = now;

    const pellets = wdef.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      const spr = (wdef.spread || 0.04) * (Math.random() - 0.5) * 2;
      const a = data.a + spr;
      match.bullets.push({
        id: ++match.bulletCounter,
        x: player.x + Math.sin(a) * 0.9, z: player.z + Math.cos(a) * 0.9,
        vx: Math.sin(a) * wdef.speed, vz: Math.cos(a) * wdef.speed,
        owner: socket.id, damage: wdef.damage, color: wdef.bColor,
        traveled: 0, maxDist: wdef.maxDist,
      });
    }
  });

  socket.on('melee', () => {
    if (!player || player.dead || !match) return;
    const now = Date.now();
    if (now - player.lastMelee < MELEE_COOLDOWN) return;
    player.lastMelee = now;
    const inv = player.inventory[player.weaponIdx];
    const wdef = inv ? WEAPON_DEFS[inv.key] : null;
    if (!wdef || wdef.type !== 'melee') return;
    for (const [pid, p] of match.players) {
      if (pid === socket.id || p.dead) continue;
      if (Math.hypot(p.x - player.x, p.z - player.z) < wdef.range) {
        applyDamage(match, pid, wdef.damage, socket.id);
        break;
      }
    }
  });

  socket.on('grenade', data => {
    if (!player || player.dead || !match) return;
    const gx = data.x, gz = data.z;
    setTimeout(() => {
      if (!match.active) return;
      io.to(match.id.toString()).emit('explosion', { x: gx, z: gz });
      for (const [pid, p] of match.players) {
        const dist = Math.hypot(p.x - gx, p.z - gz);
        if (dist < WEAPON_DEFS.grenade.blastR) {
          const dmg = Math.round(WEAPON_DEFS.grenade.damage * (1 - dist / WEAPON_DEFS.grenade.blastR));
          const killer = pid === socket.id ? null : socket.id;
          applyDamage(match, pid, dmg, killer);
        }
      }
    }, 2600);
    io.to(match.id.toString()).emit('grenadeFly', {
      ownerId: socket.id, ox: player.x, oz: player.z, vx: data.vx, vz: data.vz, vy: data.vy
    });
  });

  socket.on('pickup', data => {
    if (!player || !match) return;
    const pk = match.pickups.find(p => p.id === data.id && p.active);
    if (!pk) return;
    if (Math.hypot(player.x - pk.x, player.z - pk.z) > 3) return;
    pk.active = false;

    const AMMOS = { pistol: 12, shotgun: 8, rifle: 30, smg: 45 };
    if (pk.type === 'ammo') {
      for (const w of player.inventory)
        if (AMMOS[w.key]) w.ammo = Math.min(w.ammo + Math.ceil(AMMOS[w.key] * 0.6), AMMOS[w.key] * 2);
    } else {
      const ex = player.inventory.find(w => w.key === pk.type);
      if (ex) ex.ammo = Math.min(ex.ammo + AMMOS[pk.type], AMMOS[pk.type] * 2);
      else player.inventory.push({ key: pk.type, ammo: AMMOS[pk.type] });
    }

    socket.emit('pickupOK', { id: pk.id, inventory: player.inventory });
    io.to(match.id.toString()).emit('pickupGone', { id: pk.id });

    setTimeout(() => {
      if (!match.active) return;
      pk.active = true;
      io.to(match.id.toString()).emit('pickupBack', { id: pk.id });
    }, 20000);
  });

  socket.on('switchWeapon', ({ idx }) => {
    if (!player) return;
    if (idx >= 0 && idx < player.inventory.length) player.weaponIdx = idx;
  });

  socket.on('requestGlobalLB', () => {
    socket.emit('globalLB', globalLeaderboard);
  });

  socket.on('disconnect', () => {
    if (match && player) {
      match.players.delete(socket.id);
      socket.to(match.id.toString()).emit('pLeave', { id: socket.id, name: player.name });
      console.log(`❌ ${player.name} left match ${match.id}`);
      if (match.players.size === 0 && match.active) {
        match.active = false;
        matches.delete(match.id);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 Forest Deathmatch Online\n🚀 Server running at http://localhost:${PORT}\n`);
});
