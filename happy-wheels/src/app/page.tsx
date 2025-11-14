"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type Status = "intro" | "playing" | "won" | "crashed";

interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  legLength: number;
  headRadius: number;
  headOffset: number;
}

interface InputState {
  left: boolean;
  right: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
}

interface Runtime {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  player: PlayerState;
  input: InputState;
  status: Status;
  viewport: { width: number; height: number; dpr: number };
  cameraX: number;
  lastTime: number;
  animationFrame: number;
  startTimestamp: number | null;
  elapsed: number;
  lastHudBroadcast: number;
  onGround: boolean;
  setStatus: (status: Status) => void;
  handleWin: () => void;
  handleCrash: () => void;
  startGame: () => void;
  resetGame: (nextStatus: Status) => void;
}

const GRAVITY = 2400;
const SPRING_STIFFNESS = 260;
const SPRING_DAMPING = 32;
const FOOT_FRICTION = 22;
const CONTROL_FORCE = 820;
const CONTROL_TORQUE = 11;
const AIR_TORQUE = 3.4;
const JUMP_BASE_IMPULSE = 520;
const JUMP_COMPRESSION_SCALE = 7.8;
const FINISH_X = 2150;

const levelSegments = [
  { startX: 0, endX: 360, startY: 560, endY: 560 },
  { startX: 360, endX: 620, startY: 560, endY: 480 },
  { startX: 620, endX: 880, startY: 480, endY: 510 },
  { startX: 880, endX: 1120, startY: 510, endY: 460 },
  { startX: 1120, endX: 1320, startY: 460, endY: 520 },
  { startX: 1320, endX: 1540, startY: 520, endY: 490 },
  { startX: 1540, endX: 1760, startY: 490, endY: 540 },
  { startX: 1760, endX: 2050, startY: 540, endY: 500 },
  { startX: 2050, endX: 2300, startY: 500, endY: 500 },
];

const spikeFields = [
  { x: 1180, width: 120, height: 70 },
  { x: 1680, width: 110, height: 60 },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angle: number) {
  let result = angle;
  while (result > Math.PI) {
    result -= Math.PI * 2;
  }
  while (result < -Math.PI) {
    result += Math.PI * 2;
  }
  return result;
}

function createPlayer(): PlayerState {
  return {
    x: 120,
    y: 420,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    legLength: 160,
    headRadius: 28,
    headOffset: 54,
  };
}

function getGroundHeight(x: number) {
  const segments = levelSegments;
  if (x <= segments[0].startX) {
    return segments[0].startY;
  }
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (x >= segment.startX && x <= segment.endX) {
      const span = segment.endX - segment.startX;
      const t = span === 0 ? 0 : (x - segment.startX) / span;
      return segment.startY + (segment.endY - segment.startY) * t;
    }
  }
  const last = segments[segments.length - 1];
  if (x >= last.endX) {
    return last.endY;
  }
  return last.endY;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, Math.min(width, height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawFinishFlag(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  groundY: number,
) {
  const poleHeight = 200;
  ctx.save();
  ctx.translate(screenX, groundY);
  ctx.fillStyle = "#d9ddec";
  ctx.fillRect(-4, -poleHeight, 8, poleHeight);
  const flagWidth = 60;
  const flagHeight = 80;
  const cellSize = 12;
  for (let y = 0; y < flagHeight; y += cellSize) {
    for (let x = 0; x < flagWidth; x += cellSize) {
      const isBlack =
        ((x / cellSize) | 0) % 2 === ((y / cellSize) | 0) % 2;
      ctx.fillStyle = isBlack ? "#1c1f33" : "#f4f7ff";
      ctx.fillRect(8 + x, -poleHeight + 20 + y, cellSize, cellSize);
    }
  }
  ctx.restore();
}

function drawSpikes(
  ctx: CanvasRenderingContext2D,
  field: (typeof spikeFields)[number],
  cameraX: number,
) {
  const screenX = field.x - cameraX;
  const spikeCount = Math.max(3, Math.floor(field.width / 18));
  const cellWidth = field.width / spikeCount;
  ctx.save();
  ctx.translate(screenX, getGroundHeight(field.x + field.width / 2));
  ctx.fillStyle = "#431822";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < spikeCount; i += 1) {
    const baseX = i * cellWidth;
    const topY = -field.height;
    ctx.beginPath();
    ctx.moveTo(baseX, -6);
    ctx.lineTo(baseX + cellWidth / 2, topY);
    ctx.lineTo(baseX + cellWidth, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: PlayerState,
  cameraX: number,
  status: Status,
) {
  const screenX = player.x - cameraX;
  ctx.save();
  ctx.translate(screenX, player.y);
  ctx.rotate(player.angle);

  const isCrashed = status === "crashed";
  const isVictory = status === "won";

  ctx.shadowBlur = isVictory ? 26 : 0;
  ctx.shadowColor = isVictory ? "rgba(255, 240, 180, 0.55)" : "transparent";
  ctx.lineCap = "round";

  // pogo stick core
  ctx.strokeStyle = isCrashed ? "#5a5e6d" : "#f3c25b";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(0, player.legLength);
  ctx.stroke();

  // spring detail
  ctx.lineWidth = 4;
  ctx.strokeStyle = isCrashed ? "#3d4152" : "#ffe38c";
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(0, 20);
  ctx.lineTo(0, player.legLength - 20);
  ctx.stroke();
  ctx.setLineDash([]);

  // foot pedal
  ctx.fillStyle = isCrashed ? "#2c303c" : "#2e7dd2";
  roundedRectPath(
    ctx,
    -28,
    player.legLength - 8,
    56,
    16,
    6,
  );
  ctx.fill();
  ctx.fillStyle = isCrashed ? "#2f333f" : "#1c4c82";
  roundedRectPath(ctx, -18, player.legLength + 6, 36, 10, 5);
  ctx.fill();

  // torso
  ctx.fillStyle = isCrashed ? "#4f5568" : "#e8535a";
  roundedRectPath(ctx, -18, -72, 36, 64, 18);
  ctx.fill();

  // shoulder band
  ctx.fillStyle = isCrashed ? "#32394a" : "#1f2a4b";
  roundedRectPath(ctx, -20, -48, 40, 12, 6);
  ctx.fill();

  // arms
  ctx.strokeStyle = isCrashed ? "#353b48" : "#ffd9a8";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-16, -50);
  ctx.quadraticCurveTo(-34, -20, -10, -8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(16, -50);
  ctx.quadraticCurveTo(34, -24, 10, -4);
  ctx.stroke();

  // head
  ctx.fillStyle = isCrashed ? "#c1c6d6" : "#ffe8c6";
  ctx.beginPath();
  ctx.arc(0, -player.headOffset, player.headRadius, 0, Math.PI * 2);
  ctx.fill();

  // helmet
  ctx.fillStyle = isCrashed ? "#4d5465" : "#4673ff";
  ctx.beginPath();
  ctx.arc(
    0,
    -player.headOffset - 6,
    player.headRadius * 0.9,
    Math.PI,
    0,
    false,
  );
  ctx.fill();

  // goggles
  ctx.fillStyle = "#0c0f1c";
  roundedRectPath(ctx, -18, -player.headOffset - 6, 36, 18, 8);
  ctx.fill();
  ctx.fillStyle = "rgba(180, 211, 255, 0.45)";
  roundedRectPath(ctx, -16, -player.headOffset - 4, 32, 14, 7);
  ctx.fill();

  ctx.restore();
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  width: number,
  height: number,
) {
  const horizon = Math.floor(height * 0.42);
  const gradientSky = ctx.createLinearGradient(0, 0, 0, horizon);
  gradientSky.addColorStop(0, "#2b3b66");
  gradientSky.addColorStop(1, "#1f294b");
  ctx.fillStyle = gradientSky;
  ctx.fillRect(0, 0, width, horizon);

  const gradientGround = ctx.createLinearGradient(0, horizon, 0, height);
  gradientGround.addColorStop(0, "#1d1624");
  gradientGround.addColorStop(1, "#120c18");
  ctx.fillStyle = gradientGround;
  ctx.fillRect(0, horizon, width, height - horizon);

  ctx.save();
  ctx.translate(-cameraX * 0.2, 0);
  ctx.fillStyle = "rgba(64, 78, 120, 0.55)";
  ctx.beginPath();
  ctx.moveTo(-width, horizon + 60);
  ctx.lineTo(-width / 2, horizon - 50);
  ctx.lineTo(width * 0.1, horizon + 40);
  ctx.lineTo(width * 0.6, horizon - 30);
  ctx.lineTo(width * 1.4, horizon + 60);
  ctx.lineTo(width * 1.4, height);
  ctx.lineTo(-width, height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(48, 60, 102, 0.65)";
  ctx.beginPath();
  ctx.moveTo(-width, horizon + 130);
  ctx.lineTo(-width * 0.2, horizon + 20);
  ctx.lineTo(width * 0.3, horizon + 80);
  ctx.lineTo(width, horizon - 10);
  ctx.lineTo(width * 1.5, horizon + 120);
  ctx.lineTo(width * 1.5, height);
  ctx.lineTo(-width, height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  width: number,
) {
  const start = Math.floor(cameraX) - 40;
  const end = cameraX + width + 40;
  ctx.beginPath();
  ctx.moveTo(start - cameraX, 2000);
  for (let x = start; x <= end; x += 16) {
    const sampleX = clamp(x, 0, FINISH_X + 300);
    const y = getGroundHeight(sampleX);
    ctx.lineTo(sampleX - cameraX, y);
  }
  ctx.lineTo(end - cameraX, 2000);
  ctx.closePath();
  ctx.fillStyle = "#4a3b31";
  ctx.fill();
  ctx.strokeStyle = "rgba(25, 18, 12, 0.9)";
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.strokeStyle = "rgba(226, 187, 136, 0.4)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = start; x <= end; x += 18) {
    const sampleX = clamp(x, 0, FINISH_X + 300);
    const y = getGroundHeight(sampleX);
    ctx.lineTo(sampleX - cameraX, y - 3);
  }
  ctx.stroke();
}

function checkSpikeCollision(player: PlayerState) {
  const sin = Math.sin(player.angle);
  const cos = Math.cos(player.angle);
  const headX = player.x - sin * player.headOffset;
  const headY = player.y - cos * player.headOffset;
  const bodyBottom = player.y + 28;
  for (const field of spikeFields) {
    const groundBase = getGroundHeight(field.x + field.width / 2);
    const top = groundBase - field.height;
    const withinHead =
      headX > field.x - 12 && headX < field.x + field.width + 12;
    if (withinHead && headY > top + 4) {
      return true;
    }
    const withinBody =
      player.x > field.x - 14 && player.x < field.x + field.width + 14;
    if (withinBody && bodyBottom > top + 12) {
      return true;
    }
  }
  return false;
}

function stepPhysics(runtime: Runtime, dt: number) {
  const { player, input } = runtime;
  const controlIntent = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  player.vx += CONTROL_FORCE * controlIntent * dt;
  player.angularVelocity += CONTROL_TORQUE * controlIntent * dt;

  player.vy += GRAVITY * dt;
  player.vx *= 0.998;
  player.vy *= 0.999;
  player.angularVelocity *= 0.992;

  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.angle = normalizeAngle(player.angle + player.angularVelocity * dt);

  const sin = Math.sin(player.angle);
  const cos = Math.cos(player.angle);
  let footX = player.x + sin * player.legLength;
  let footY = player.y + cos * player.legLength;
  const groundY = getGroundHeight(footX);
  let onGround = false;

  if (footY >= groundY) {
    onGround = true;
    const penetration = footY - groundY;
    player.x -= sin * penetration;
    player.y -= cos * penetration;
    footX = player.x + sin * player.legLength;
    footY = player.y + cos * player.legLength;

    const normalVelocity = player.vx * sin + player.vy * cos;
    const springCompression = clamp(penetration, 0, 120);
    const springForce =
      springCompression * SPRING_STIFFNESS - normalVelocity * SPRING_DAMPING;
    player.vx -= sin * springForce * dt;
    player.vy -= cos * springForce * dt;

    const tangentX = cos;
    const tangentY = -sin;
    const tangentVelocity =
      player.vx * tangentX + player.vy * tangentY + player.angularVelocity * player.legLength;
    const frictionForce = -tangentVelocity * FOOT_FRICTION;
    player.vx += tangentX * frictionForce * dt;
    player.vy += tangentY * frictionForce * dt;
    player.angularVelocity += frictionForce * dt * 0.026;

    if (input.jumpPressed) {
      const jumpImpulse =
        JUMP_BASE_IMPULSE + springCompression * JUMP_COMPRESSION_SCALE;
      player.vx -= sin * jumpImpulse * 0.7;
      player.vy -= cos * jumpImpulse;
      player.angularVelocity -= tangentVelocity * 0.015;
    }
  } else {
    player.angularVelocity += AIR_TORQUE * controlIntent * dt;
  }

  runtime.onGround = onGround;
  input.jumpPressed = false;

  const headCollision = checkSpikeCollision(player);
  const headX = player.x - sin * player.headOffset;
  const headY = player.y - cos * player.headOffset;
  const headGround = getGroundHeight(headX);
  const bodyGround = getGroundHeight(player.x);
  if (
    headCollision ||
    headY + player.headRadius > headGround ||
    player.y + 24 > bodyGround + 6 ||
    player.y > runtime.viewport.height + 480
  ) {
    runtime.handleCrash();
  }

  if (player.x >= FINISH_X) {
    runtime.handleWin();
  }
}

function updateCamera(runtime: Runtime, dt: number) {
  const { viewport, player } = runtime;
  if (viewport.width <= 0) {
    return;
  }
  const target = player.x - viewport.width * 0.35;
  const followStrength = clamp(dt * 7, 0, 1);
  runtime.cameraX += (target - runtime.cameraX) * followStrength;
  runtime.cameraX = clamp(
    runtime.cameraX,
    0,
    Math.max(0, FINISH_X - viewport.width * 0.4),
  );
}

function render(runtime: Runtime) {
  const {
    ctx,
    viewport: { width, height },
    cameraX,
    player,
    status,
  } = runtime;
  if (width === 0 || height === 0) {
    return;
  }
  ctx.clearRect(0, 0, width, height);
  drawBackdrop(ctx, cameraX, width, height);
  drawGround(ctx, cameraX, width);
  for (const field of spikeFields) {
    const screenX = field.x - cameraX;
    if (screenX > -field.width - 80 && screenX < width + 80) {
      drawSpikes(ctx, field, cameraX);
    }
  }
  const finishScreenX = FINISH_X - cameraX;
  if (finishScreenX > -80 && finishScreenX < width + 120) {
    drawFinishFlag(ctx, finishScreenX, getGroundHeight(FINISH_X));
  }
  drawPlayer(ctx, player, cameraX, status);
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const progressRef = useRef(0);
  const speedRef = useRef(0);

  const [status, setStatus] = useState<Status>("intro");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [finalTime, setFinalTime] = useState<number | null>(null);
  const [bestTime, setBestTime] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const runtime: Runtime = {
      canvas,
      ctx,
      player: createPlayer(),
      input: {
        left: false,
        right: false,
        jumpHeld: false,
        jumpPressed: false,
      },
      status: "intro",
      viewport: { width: 0, height: 0, dpr: 1 },
      cameraX: 0,
      lastTime: performance.now(),
      animationFrame: 0,
      startTimestamp: null,
      elapsed: 0,
      lastHudBroadcast: performance.now(),
      onGround: false,
      setStatus: (next) => {
        if (runtime.status !== next) {
          runtime.status = next;
          setStatus(next);
        }
      },
      handleWin: () => {
        /* replaced below */
      },
      handleCrash: () => {
        /* replaced below */
      },
      startGame: () => {
        /* replaced below */
      },
      resetGame: () => {
        /* replaced below */
      },
    };

    runtime.resetGame = (nextStatus: Status) => {
      runtime.player = createPlayer();
      runtime.cameraX = 0;
      runtime.lastTime = performance.now();
      runtime.elapsed = 0;
      runtime.startTimestamp = nextStatus === "playing" ? runtime.lastTime : null;
      runtime.lastHudBroadcast = runtime.lastTime;
      runtime.input.left = false;
      runtime.input.right = false;
      runtime.input.jumpHeld = false;
      runtime.input.jumpPressed = false;
      runtime.onGround = false;
      if (nextStatus === "playing") {
        setElapsed(0);
        setSpeed(0);
        setProgress(0);
        progressRef.current = 0;
        speedRef.current = 0;
      }
      runtime.setStatus(nextStatus);
    };

    runtime.handleWin = () => {
      if (runtime.status !== "playing") {
        return;
      }
      runtime.setStatus("won");
      const resultTime = runtime.elapsed;
      setFinalTime(resultTime);
      setBestTime((prev) =>
        prev === null || resultTime < prev ? resultTime : prev,
      );
      setProgress(100);
      progressRef.current = 100;
      setSpeed(0);
      speedRef.current = 0;
    };

    runtime.handleCrash = () => {
      if (runtime.status !== "playing") {
        return;
      }
      runtime.setStatus("crashed");
      setSpeed(0);
      speedRef.current = 0;
    };

    runtime.startGame = () => {
      runtime.resetGame("playing");
      setFinalTime(null);
    };

    runtimeRef.current = runtime;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      runtime.viewport.width = rect.width;
      runtime.viewport.height = rect.height;
      runtime.viewport.dpr = ratio;
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
    };

    const keyDown = (event: KeyboardEvent) => {
      const { code } = event;
      switch (code) {
        case "ArrowLeft":
        case "KeyA":
          runtime.input.left = true;
          event.preventDefault();
          break;
        case "ArrowRight":
        case "KeyD":
          runtime.input.right = true;
          event.preventDefault();
          break;
        case "ArrowUp":
        case "KeyW":
        case "Space":
          if (!runtime.input.jumpHeld) {
            runtime.input.jumpPressed = true;
          }
          runtime.input.jumpHeld = true;
          event.preventDefault();
          if (runtime.status === "intro") {
            runtime.startGame();
          } else if (runtime.status === "crashed" || runtime.status === "won") {
            runtime.startGame();
          }
          break;
        case "Enter":
          runtime.startGame();
          event.preventDefault();
          break;
        case "KeyR":
          runtime.startGame();
          event.preventDefault();
          break;
        default:
          break;
      }
    };

    const keyUp = (event: KeyboardEvent) => {
      const { code } = event;
      switch (code) {
        case "ArrowLeft":
        case "KeyA":
          runtime.input.left = false;
          event.preventDefault();
          break;
        case "ArrowRight":
        case "KeyD":
          runtime.input.right = false;
          event.preventDefault();
          break;
        case "ArrowUp":
        case "KeyW":
        case "Space":
          runtime.input.jumpHeld = false;
          event.preventDefault();
          break;
        default:
          break;
      }
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    const loop = (timestamp: number) => {
      const dt = clamp((timestamp - runtime.lastTime) / 1000, 0, 0.04);
      runtime.lastTime = timestamp;

      if (runtime.status === "playing") {
        if (runtime.startTimestamp === null) {
          runtime.startTimestamp = timestamp;
        }
        runtime.elapsed = (timestamp - runtime.startTimestamp) / 1000;
        stepPhysics(runtime, dt);
      }

      updateCamera(runtime, dt);
      render(runtime);

      if (timestamp - runtime.lastHudBroadcast > 90) {
        runtime.lastHudBroadcast = timestamp;
        if (runtime.status === "playing") {
          setElapsed(runtime.elapsed);
          const nextProgress = clamp(
            (runtime.player.x / FINISH_X) * 100,
            0,
            100,
          );
          if (Math.abs(nextProgress - progressRef.current) > 0.2) {
            progressRef.current = nextProgress;
            setProgress(nextProgress);
          }
          const nextSpeed = Math.hypot(runtime.player.vx, runtime.player.vy);
          if (Math.abs(nextSpeed - speedRef.current) > 14) {
            speedRef.current = nextSpeed;
            setSpeed(nextSpeed);
          }
        }
      }

      runtime.animationFrame = requestAnimationFrame(loop);
    };

    runtime.animationFrame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(runtime.animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, []);

  const handleStart = () => {
    runtimeRef.current?.startGame();
  };

  const handleRestart = () => {
    runtimeRef.current?.startGame();
  };

  const hudSpeed = Math.max(0, Math.round(speed * 0.18));

  return (
    <div className={styles.page}>
      <div className={styles.canvasWrapper}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <div className={styles.overlay}>
          <div className={styles.hud}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Time</span>
              <span className={styles.statValue}>
                {status === "playing" || status === "won"
                  ? `${elapsed.toFixed(2)}s`
                  : "--"}
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Course</span>
              <span className={styles.statValue}>
                {`${Math.round(progress)}%`}
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Speed</span>
              <span className={styles.statValue}>{`${hudSpeed} mph`}</span>
            </div>
            {bestTime !== null && (
              <div className={styles.stat}>
                <span className={styles.statLabel}>Best</span>
                <span className={styles.statValue}>
                  {`${bestTime.toFixed(2)}s`}
                </span>
              </div>
            )}
          </div>

          {(status === "intro" || status === "crashed" || status === "won") && (
            <div className={styles.statusPanel}>
              <h1>
                {status === "intro" && "Pogo Stick Dash"}
                {status === "crashed" && "Ouch! Try Again"}
                {status === "won" && "Course Complete!"}
              </h1>
              <p>
                {status === "intro" &&
                  "Bounce, balance, and launch your pogo stick hero across treacherous ramps and spike pits. Lean with the arrows, time your jumps, and stick the landing at the finish flag."}
                {status === "crashed" &&
                  "Your rider took a spill. Reset instantly and keep the momentum alive—master the lean and pogo timing to clear the obstacles."}
                {status === "won" &&
                  (finalTime !== null
                    ? `You cleared the course in ${finalTime.toFixed(
                        2,
                      )} seconds. See if you can shave off a few more and set an unbeatable record!`
                    : "You conquered the pogo gauntlet! Play again to chase an even faster run.")}
              </p>
              <div className={styles.buttons}>
                <button
                  type="button"
                  className={styles.button}
                  onClick={handleStart}
                >
                  {status === "intro" ? "Start Run" : "Play Again"}
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.secondary}`}
                  onClick={handleRestart}
                >
                  Reset (R)
                </button>
              </div>
            </div>
          )}

          <div className={styles.instructions}>
            Controls:
            {" "}
            <strong>Arrow keys / A D</strong>
            {" "}
            lean ·
            {" "}
            <strong>Space / W / Up</strong>
            {" "}
            pogo jump ·
            {" "}
            <strong>R</strong>
            {" "}
            reset
          </div>
        </div>
      </div>
    </div>
  );
}
