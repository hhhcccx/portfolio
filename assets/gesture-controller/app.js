const video = document.querySelector("#camera");
const playfield = document.querySelector("#playfield");
const cursor = document.querySelector("#cursor");
const target = document.querySelector("#target");
const hint = document.querySelector("#hint");
const pinchValue = document.querySelector("#pinchValue");
const modeValue = document.querySelector("#modeValue");
const canvas = document.querySelector("#trailCanvas");
const ctx = canvas.getContext("2d");

const state = {
  x: 0.5,
  y: 0.5,
  previousX: 0.5,
  pinch: 0,
  pinching: false,
  grabbed: false,
  lastSwipeAt: 0,
  particles: [],
  detector: null,
  lastVideoTime: -1,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function setHint(text) {
  hint.textContent = text;
}

function resizeCanvas() {
  const rect = playfield.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function toFieldPoint(x, y) {
  const rect = playfield.getBoundingClientRect();
  return {
    x: clamp(x, 0.03, 0.97) * rect.width,
    y: clamp(y, 0.05, 0.95) * rect.height,
  };
}

function moveCursor() {
  const point = toFieldPoint(state.x, state.y);
  cursor.style.left = `${point.x}px`;
  cursor.style.top = `${point.y}px`;

  if (state.grabbed) {
    target.style.left = `${point.x}px`;
    target.style.top = `${point.y}px`;
  }
}

function spawnBurst(x, y, count = 28) {
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count;
    const speed = 2 + Math.random() * 5;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      color: i % 3 === 0 ? "#9df55d" : i % 3 === 1 ? "#5ee9ff" : "#ff7b54",
    });
  }
}

function drawParticles() {
  const rect = playfield.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  for (const particle of state.particles) {
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vx *= 0.96;
    particle.vy *= 0.96;
    particle.life -= 0.018;

    ctx.globalAlpha = Math.max(particle.life, 0);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 5 + 12 * (1 - particle.life), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  state.particles = state.particles.filter((particle) => particle.life > 0);
  requestAnimationFrame(drawParticles);
}

function updateGesture(landmarks) {
  const indexTip = landmarks[8];
  const thumbTip = landmarks[4];
  const wrist = landmarks[0];
  const middleBase = landmarks[9];
  const handScale = Math.max(distance(wrist, middleBase), 0.04);
  const pinchDistance = distance(indexTip, thumbTip) / handScale;
  const pinchStrength = clamp(1 - (pinchDistance - 0.34) / 0.48, 0, 1);

  state.previousX = state.x;
  state.x += (1 - indexTip.x - state.x) * 0.36;
  state.y += (indexTip.y - state.y) * 0.36;
  state.pinch = pinchStrength;
  state.pinching = pinchStrength > 0.62;

  const now = performance.now();
  const swipeVelocity = Math.abs(state.x - state.previousX);
  if (swipeVelocity > 0.075 && now - state.lastSwipeAt > 700) {
    const point = toFieldPoint(state.x, state.y);
    spawnBurst(point.x, point.y, 34);
    state.lastSwipeAt = now;
  }

  if (state.pinching && !state.grabbed) {
    state.grabbed = true;
    target.classList.add("grabbed");
  }

  if (!state.pinching && state.grabbed) {
    state.grabbed = false;
    target.classList.remove("grabbed");
    const point = toFieldPoint(state.x, state.y);
    spawnBurst(point.x, point.y, 16);
  }

  cursor.classList.toggle("pinching", state.pinching);
  pinchValue.textContent = `${Math.round(pinchStrength * 100)}%`;
  modeValue.textContent = state.grabbed ? "Grab" : state.pinching ? "Pinch" : "Track";
  moveCursor();
}

async function loadDetector() {
  const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14");
  const fileset = await vision.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  return vision.HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: "user",
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

async function detectLoop() {
  if (video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    const result = state.detector.detectForVideo(video, performance.now());
    if (result.landmarks?.[0]) {
      updateGesture(result.landmarks[0]);
      setHint("食指移动，拇指和食指捏合抓取");
    } else {
      modeValue.textContent = "Seek";
      setHint("把手掌完整放进画面，离摄像头稍远一点");
    }
  }
  requestAnimationFrame(detectLoop);
}

function enableMouseFallback() {
  let mouseDown = false;

  playfield.addEventListener("pointerdown", (event) => {
    mouseDown = true;
    state.grabbed = true;
    target.classList.add("grabbed");
    playfield.setPointerCapture(event.pointerId);
  });

  playfield.addEventListener("pointerup", (event) => {
    mouseDown = false;
    state.grabbed = false;
    target.classList.remove("grabbed");
    const rect = playfield.getBoundingClientRect();
    spawnBurst(event.clientX - rect.left, event.clientY - rect.top, 14);
  });

  playfield.addEventListener("pointermove", (event) => {
    const rect = playfield.getBoundingClientRect();
    state.x = (event.clientX - rect.left) / rect.width;
    state.y = (event.clientY - rect.top) / rect.height;
    state.grabbed = mouseDown;
    moveCursor();
  });
}

async function boot() {
  resizeCanvas();
  drawParticles();
  enableMouseFallback();

  if (!navigator.mediaDevices?.getUserMedia) {
    modeValue.textContent = "Mouse";
    setHint("这个浏览器不支持摄像头 API，先用鼠标拖动玩");
    return;
  }

  try {
    modeValue.textContent = "Camera";
    setHint("正在请求摄像头权限");
    await startCamera();

    modeValue.textContent = "Model";
    setHint("正在加载手势识别模型");
    state.detector = await loadDetector();

    modeValue.textContent = "Ready";
    setHint("伸出一只手，食指会变成指针");
    detectLoop();
  } catch (error) {
    console.error(error);
    modeValue.textContent = "Mouse";
    setHint("摄像头或模型加载失败，当前可用鼠标模式试玩");
  }
}

window.addEventListener("resize", resizeCanvas);
boot();
