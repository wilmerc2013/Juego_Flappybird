/* =============================================
   FLAPPY BIRD — script.js
   Canvas API · 60 FPS · Sin dependencias externas
   ============================================= */

'use strict';

// ─── CANVAS & CONTEXTO ───────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

// ─── ESTADO GLOBAL ───────────────────────────────────────────────────────────
const STATE = { START: 0, PLAYING: 1, PAUSED: 2, GAMEOVER: 3 };
let gameState = STATE.START;

// ─── CONFIGURACIÓN BASE ──────────────────────────────────────────────────────
const CFG = {
  gravity:       0.45,   // aceleración por frame
  jumpForce:    -9,      // velocidad vertical al saltar
  pipeSpeed:     3,      // velocidad inicial de los tubos
  pipeGap:     160,      // hueco entre tubo superior e inferior
  pipeInterval: 90,      // frames entre tubos
  groundHeight: 80,      // altura del suelo
  birdX:        0.22,    // posición X del pájaro (fracción del ancho)
  maxSpeed:     12,      // velocidad máxima de caída
  diffInterval: 5,       // cada cuántos puntos aumenta la dificultad
};

// ─── VARIABLES DE JUEGO ──────────────────────────────────────────────────────
let bird, pipes, score, highScore, frameCount, pipeTimer;
let nightMode   = false;
let selectedSkin = 0;
let animFrame;

// ─── SKINS ───────────────────────────────────────────────────────────────────
const SKINS = [
  { emoji: '🐦', color: '#f9ca24', wing: '#f0932b' },
  { emoji: '🐧', color: '#dfe6e9', wing: '#636e72' },
  { emoji: '🦉', color: '#a29bfe', wing: '#6c5ce7' },
  { emoji: '🦜', color: '#55efc4', wing: '#00b894' },
];

// ─── PARALLAX LAYERS ─────────────────────────────────────────────────────────
// Cada capa tiene velocidad relativa y posición X
const layers = [
  { speed: 0.2, x: 0 },  // nubes lejanas
  { speed: 0.5, x: 0 },  // nubes medias
  { speed: 1.0, x: 0 },  // colinas
];

// ─── AUDIO (Web Audio API) ────────────────────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;

function initAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
}

/**
 * Genera un sonido sintético simple.
 * @param {string} type  - 'jump' | 'score' | 'die'
 */
function playSound(type) {
  if (!audioCtx) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === 'jump') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(780, now + 0.08);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  } else if (type === 'score') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.1);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else if (type === 'die') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.4);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.start(now);
    osc.stop(now + 0.4);
  }
}

// ─── RESIZE ──────────────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', () => {
  resizeCanvas();
  if (gameState === STATE.START) drawStartBackground();
});

// ─── INICIALIZACIÓN DEL JUEGO ────────────────────────────────────────────────
function initGame() {
  const birdSize = Math.min(canvas.width, canvas.height) * 0.055;

  bird = {
    x:        canvas.width  * CFG.birdX,
    y:        canvas.height * 0.45,
    vy:       0,             // velocidad vertical
    size:     birdSize,
    angle:    0,             // rotación visual
    alive:    true,
    flapping: 0,             // frame de animación de alas
  };

  pipes      = [];
  score      = 0;
  frameCount = 0;
  pipeTimer  = 0;

  // Cargar récord
  highScore = parseInt(localStorage.getItem('flappyHighScore') || '0', 10);

  // Actualizar HUD
  document.getElementById('scoreDisplay').textContent = '0';
}

// ─── SALTO ───────────────────────────────────────────────────────────────────
function jump() {
  if (gameState === STATE.PLAYING && bird.alive) {
    bird.vy = CFG.jumpForce;
    bird.flapping = 8; // frames de animación de alas
    playSound('jump');
  }
}

// ─── CREAR TUBO ──────────────────────────────────────────────────────────────
function spawnPipe() {
  const minTop = canvas.height * 0.12;
  const maxTop = canvas.height - CFG.groundHeight - CFG.pipeGap - canvas.height * 0.12;
  const topH   = minTop + Math.random() * (maxTop - minTop);
  const pipeW  = Math.min(canvas.width * 0.12, 72);

  pipes.push({
    x:      canvas.width + pipeW,
    topH,
    botY:   topH + CFG.pipeGap,
    botH:   canvas.height - CFG.groundHeight - topH - CFG.pipeGap,
    w:      pipeW,
    passed: false,
  });
}

// ─── VELOCIDAD DINÁMICA ──────────────────────────────────────────────────────
function currentSpeed() {
  const bonus = Math.floor(score / CFG.diffInterval) * 0.4;
  return Math.min(CFG.pipeSpeed + bonus, 9);
}

// ─── COLISIÓN AABB ───────────────────────────────────────────────────────────
function checkCollision(pipe) {
  const margin = bird.size * 0.28; // margen de tolerancia visual
  const bx = bird.x - bird.size / 2 + margin;
  const by = bird.y - bird.size / 2 + margin;
  const bw = bird.size - margin * 2;
  const bh = bird.size - margin * 2;

  // Tubo superior
  if (bx < pipe.x + pipe.w && bx + bw > pipe.x &&
      by < pipe.topH) return true;

  // Tubo inferior
  if (bx < pipe.x + pipe.w && bx + bw > pipe.x &&
      by + bh > pipe.botY) return true;

  return false;
}

// ─── ACTUALIZACIÓN DE FÍSICA ─────────────────────────────────────────────────
function update() {
  if (gameState !== STATE.PLAYING || !bird.alive) return;

  frameCount++;
  pipeTimer++;

  const speed = currentSpeed();

  // Gravedad
  bird.vy = Math.min(bird.vy + CFG.gravity, CFG.maxSpeed);
  bird.y += bird.vy;

  // Ángulo visual según velocidad
  bird.angle = Math.max(-30, Math.min(90, bird.vy * 4));

  // Animación de alas
  if (bird.flapping > 0) bird.flapping--;

  // Generar tubos
  if (pipeTimer >= CFG.pipeInterval) {
    spawnPipe();
    pipeTimer = 0;
  }

  // Mover y evaluar tubos
  for (let i = pipes.length - 1; i >= 0; i--) {
    const p = pipes[i];
    p.x -= speed;

    // Punto al pasar el tubo
    if (!p.passed && p.x + p.w < bird.x) {
      p.passed = true;
      score++;
      document.getElementById('scoreDisplay').textContent = score;
      playSound('score');

      // Guardar récord
      if (score > highScore) {
        highScore = score;
        localStorage.setItem('flappyHighScore', highScore);
      }
    }

    // Colisión con tubo
    if (checkCollision(p)) {
      triggerDeath();
      return;
    }

    // Eliminar tubos fuera de pantalla
    if (p.x + p.w < -10) pipes.splice(i, 1);
  }

  // Colisión con suelo
  if (bird.y + bird.size / 2 >= canvas.height - CFG.groundHeight) {
    bird.y = canvas.height - CFG.groundHeight - bird.size / 2;
    triggerDeath();
    return;
  }

  // Colisión con techo
  if (bird.y - bird.size / 2 <= 0) {
    bird.y = bird.size / 2;
    bird.vy = 0;
  }

  // Mover capas parallax
  layers[0].x -= speed * 0.2;
  layers[1].x -= speed * 0.5;
  layers[2].x -= speed * 1.0;
}

// ─── MUERTE ──────────────────────────────────────────────────────────────────
function triggerDeath() {
  bird.alive = false;
  playSound('die');

  // Pequeño delay antes de mostrar game over
  setTimeout(() => {
    gameState = STATE.GAMEOVER;
    document.getElementById('finalScore').textContent = score;
    document.getElementById('highScore').textContent  = highScore;
    showScreen('gameOverScreen');
    document.getElementById('hud').classList.add('hidden');
  }, 600);
}

// ─── DIBUJO ──────────────────────────────────────────────────────────────────

/** Fondo con gradiente y parallax */
function drawBackground() {
  const W = canvas.width;
  const H = canvas.height;

  // Gradiente de cielo
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  if (nightMode) {
    sky.addColorStop(0, '#0f0c29');
    sky.addColorStop(1, '#302b63');
  } else {
    sky.addColorStop(0, '#56CCF2');
    sky.addColorStop(1, '#2F80ED');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Estrellas (modo noche)
  if (nightMode) drawStars();

  // Nubes lejanas (capa 0)
  drawClouds(layers[0].x, 0.12, nightMode ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.35)');

  // Nubes medias (capa 1)
  drawClouds(layers[1].x, 0.22, nightMode ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.55)');

  // Colinas (capa 2)
  drawHills(layers[2].x);
}

/** Estrellas estáticas (se generan una vez) */
let stars = null;
function drawStars() {
  if (!stars) {
    stars = Array.from({ length: 120 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.7,
      r: Math.random() * 1.5 + 0.5,
      a: Math.random(),
    }));
  }
  stars.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${s.a})`;
    ctx.fill();
  });
}

/** Nubes procedurales con parallax */
function drawClouds(offsetX, yFrac, color) {
  const W = canvas.width;
  const H = canvas.height;
  const cloudPositions = [0.1, 0.35, 0.6, 0.85, 1.1];

  ctx.fillStyle = color;
  cloudPositions.forEach((frac, i) => {
    const cx = ((frac * W + offsetX) % (W * 1.2) + W * 1.2) % (W * 1.2) - W * 0.1;
    const cy = H * (yFrac + i * 0.04);
    const r  = W * (0.04 + i * 0.01);
    ctx.beginPath();
    ctx.arc(cx,       cy,     r,       0, Math.PI * 2);
    ctx.arc(cx + r,   cy - r * 0.3, r * 0.8, 0, Math.PI * 2);
    ctx.arc(cx - r,   cy - r * 0.2, r * 0.7, 0, Math.PI * 2);
    ctx.arc(cx + r * 1.8, cy, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Colinas con parallax */
function drawHills(offsetX) {
  const W = canvas.width;
  const H = canvas.height;
  const groundY = H - CFG.groundHeight;
  const color   = nightMode ? '#1a3a2a' : '#27ae60';

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, groundY);

  const hillW = W * 0.35;
  const count = Math.ceil(W / hillW) + 2;
  for (let i = 0; i < count; i++) {
    const hx = ((i * hillW + offsetX) % (count * hillW) + count * hillW) % (count * hillW) - hillW;
    ctx.quadraticCurveTo(hx + hillW / 2, groundY - H * 0.12, hx + hillW, groundY);
  }
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
}

/** Suelo */
function drawGround() {
  const W = canvas.width;
  const H = canvas.height;
  const groundY = H - CFG.groundHeight;

  // Base
  ctx.fillStyle = nightMode ? '#2d4a1e' : '#8BC34A';
  ctx.fillRect(0, groundY, W, CFG.groundHeight);

  // Franja superior
  ctx.fillStyle = nightMode ? '#3d6b2a' : '#AED581';
  ctx.fillRect(0, groundY, W, 10);

  // Líneas de textura animadas
  ctx.strokeStyle = nightMode ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 1;
  const lineSpacing = 40;
  const offset = (frameCount * currentSpeed()) % lineSpacing;
  for (let x = -lineSpacing + offset; x < W + lineSpacing; x += lineSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, groundY + 10);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
}

/** Tubos con gradiente y borde */
function drawPipes() {
  pipes.forEach(p => {
    const pipeColor1 = nightMode ? '#1e6b3a' : '#2ecc71';
    const pipeColor2 = nightMode ? '#145228' : '#27ae60';
    const capH = 22;
    const capExtra = 6;

    // ── Tubo superior ──
    const gradTop = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
    gradTop.addColorStop(0, pipeColor1);
    gradTop.addColorStop(0.5, pipeColor2);
    gradTop.addColorStop(1, pipeColor1);
    ctx.fillStyle = gradTop;
    ctx.fillRect(p.x, 0, p.w, p.topH);

    // Borde superior (cap)
    ctx.fillStyle = pipeColor1;
    ctx.fillRect(p.x - capExtra, p.topH - capH, p.w + capExtra * 2, capH);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - capExtra, p.topH - capH, p.w + capExtra * 2, capH);

    // Brillo
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(p.x + 4, 0, 8, p.topH - capH);

    // ── Tubo inferior ──
    const gradBot = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
    gradBot.addColorStop(0, pipeColor1);
    gradBot.addColorStop(0.5, pipeColor2);
    gradBot.addColorStop(1, pipeColor1);
    ctx.fillStyle = gradBot;
    ctx.fillRect(p.x, p.botY, p.w, p.botH);

    // Cap inferior
    ctx.fillStyle = pipeColor1;
    ctx.fillRect(p.x - capExtra, p.botY, p.w + capExtra * 2, capH);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - capExtra, p.botY, p.w + capExtra * 2, capH);

    // Brillo
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(p.x + 4, p.botY + capH, 8, p.botH - capH);
  });
}

/** Pájaro con emoji y rotación */
function drawBird() {
  const skin = SKINS[selectedSkin];
  const s    = bird.size;

  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate((bird.angle * Math.PI) / 180);

  // Sombra suave
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur  = 8;
  ctx.shadowOffsetY = 4;

  // Alas animadas
  const wingOffset = bird.flapping > 0 ? -s * 0.25 : s * 0.1;

  // Cuerpo
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.52, s * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin.color;
  ctx.fill();

  // Ala
  ctx.beginPath();
  ctx.ellipse(-s * 0.1, wingOffset, s * 0.32, s * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = skin.wing;
  ctx.fill();

  // Ojo
  ctx.beginPath();
  ctx.arc(s * 0.22, -s * 0.1, s * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * 0.25, -s * 0.1, s * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = '#2d3436';
  ctx.fill();

  // Pico
  ctx.beginPath();
  ctx.moveTo(s * 0.45, -s * 0.05);
  ctx.lineTo(s * 0.72, s * 0.05);
  ctx.lineTo(s * 0.45, s * 0.15);
  ctx.closePath();
  ctx.fillStyle = '#f39c12';
  ctx.fill();

  ctx.restore();
}

/** Partículas de muerte */
let deathParticles = [];

function spawnDeathParticles() {
  for (let i = 0; i < 18; i++) {
    const angle = (Math.PI * 2 * i) / 18;
    deathParticles.push({
      x: bird.x, y: bird.y,
      vx: Math.cos(angle) * (2 + Math.random() * 4),
      vy: Math.sin(angle) * (2 + Math.random() * 4),
      life: 1,
      color: SKINS[selectedSkin].color,
    });
  }
}

function updateDrawParticles() {
  deathParticles = deathParticles.filter(p => p.life > 0);
  deathParticles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.2;
    p.life -= 0.03;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 * p.life, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.life;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

// ─── LOOP PRINCIPAL ──────────────────────────────────────────────────────────
function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawBackground();
  drawPipes();
  drawGround();

  if (gameState === STATE.PLAYING || gameState === STATE.PAUSED) {
    drawBird();
  }

  // Partículas de muerte
  if (!bird.alive) {
    if (deathParticles.length === 0 && gameState !== STATE.GAMEOVER) {
      spawnDeathParticles();
    }
    updateDrawParticles();
  }

  if (gameState === STATE.PLAYING) update();

  animFrame = requestAnimationFrame(gameLoop);
}

// ─── FONDO ESTÁTICO (pantalla de inicio) ─────────────────────────────────────
function drawStartBackground() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawGround();
}

// ─── GESTIÓN DE PANTALLAS ────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  if (id) {
    const el = document.getElementById(id);
    el.classList.remove('hidden');
    el.classList.add('active');
  }
}

// ─── EVENTOS DE CONTROL ──────────────────────────────────────────────────────

// Teclado
document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    handleInput();
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    handlePause();
  }
});

// Clic / toque en canvas
canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  handleInput();
});

function handleInput() {
  initAudio();
  if (gameState === STATE.PLAYING) {
    jump();
  }
}

function handlePause() {
  if (gameState === STATE.PLAYING) {
    gameState = STATE.PAUSED;
    showScreen('pauseScreen');
  } else if (gameState === STATE.PAUSED) {
    resumeGame();
  }
}

// ─── BOTONES UI ──────────────────────────────────────────────────────────────

document.getElementById('startBtn').addEventListener('click', () => {
  initAudio();
  startGame();
});

document.getElementById('restartBtn').addEventListener('click', () => {
  initAudio();
  startGame();
});

document.getElementById('menuBtn').addEventListener('click', () => {
  goToMenu();
});

document.getElementById('pauseBtn').addEventListener('click', () => {
  handlePause();
});

document.getElementById('resumeBtn').addEventListener('click', () => {
  resumeGame();
});

document.getElementById('pauseMenuBtn').addEventListener('click', () => {
  goToMenu();
});

// Selector de skin
document.querySelectorAll('.skin-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.skin-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedSkin = parseInt(btn.dataset.skin, 10);
  });
});

// Modo noche/día
document.getElementById('toggleMode').addEventListener('click', () => {
  nightMode = !nightMode;
  stars = null; // regenerar estrellas
  document.getElementById('toggleMode').textContent = nightMode ? '☀️ Modo Día' : '🌙 Modo Noche';
  drawStartBackground();
});

// ─── FLUJO DE JUEGO ──────────────────────────────────────────────────────────

function startGame() {
  cancelAnimationFrame(animFrame);
  deathParticles = [];
  initGame();
  gameState = STATE.PLAYING;
  showScreen(null);
  document.getElementById('hud').classList.remove('hidden');
  animFrame = requestAnimationFrame(gameLoop);
}

function resumeGame() {
  gameState = STATE.PLAYING;
  showScreen(null);
}

function goToMenu() {
  gameState = STATE.START;
  cancelAnimationFrame(animFrame);

  // Mostrar récord en menú
  highScore = parseInt(localStorage.getItem('flappyHighScore') || '0', 10);
  const best = document.getElementById('bestScoreDisplay');
  best.textContent = highScore > 0 ? `🏆 Récord: ${highScore}` : '';

  document.getElementById('hud').classList.add('hidden');
  showScreen('startScreen');

  // Reiniciar parallax
  layers.forEach(l => l.x = 0);
  frameCount = 0;

  // Redibujar fondo estático y arrancar loop de fondo
  resizeCanvas();
  drawStartBackground();
  animFrame = requestAnimationFrame(menuLoop);
}

/** Loop animado para el menú (solo fondo) */
function menuLoop() {
  if (gameState !== STATE.START) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Mover capas lentamente
  layers[0].x -= 0.3;
  layers[1].x -= 0.7;
  layers[2].x -= 1.2;
  frameCount++;

  drawBackground();
  drawGround();

  animFrame = requestAnimationFrame(menuLoop);
}

// ─── ARRANQUE ────────────────────────────────────────────────────────────────
resizeCanvas();

// Mostrar récord guardado
highScore = parseInt(localStorage.getItem('flappyHighScore') || '0', 10);
const bestEl = document.getElementById('bestScoreDisplay');
bestEl.textContent = highScore > 0 ? `🏆 Récord: ${highScore}` : '';

// Iniciar loop de menú
gameState = STATE.START;
animFrame = requestAnimationFrame(menuLoop);
