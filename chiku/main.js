// Balloons
const balloonsLayer = document.getElementById('balloons');
function releaseBalloons() {
  const count = 6 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const b = document.createElement('div');
    b.className = 'balloon';
    const hue = Math.floor(Math.random() * 360);
    const color = `hsl(${hue}deg,85%,60%)`;
    b.style.background = `radial-gradient(120% 100% at 20% 20%, #ffffffb0, ${color})`;
    b.style.left = Math.random() * 100 + 'vw';
    b.style.setProperty('--dur', (7 + Math.random() * 6).toFixed(2) + 's');
    b.style.setProperty('--drift', (Math.random() * 120 - 60).toFixed(0) + 'px');
    const string = document.createElement('div');
    string.className = 'string';
    b.appendChild(string);
    balloonsLayer.appendChild(b);
    b.addEventListener('animationend', () => b.remove());
  }
}
// Confetti
const confettiLayer = document.getElementById('confetti');
function sprinkleConfetti() {
  const colors = [
    '#f43f5e',
    '#f59e0b',
    '#10b981',
    '#3b82f6',
    '#8b5cf6',
    '#ef4444',
    '#22c55e',
    '#eab308',
  ];
  const pieces = 120;
  for (let i = 0; i < pieces; i++) {
    const c = document.createElement('div');
    c.className = 'confetti-piece';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.setProperty('--c', colors[i % colors.length]);
    c.style.setProperty('--w', 6 + Math.random() * 8 + 'px');
    c.style.setProperty('--h', 8 + Math.random() * 16 + 'px');
    c.style.setProperty('--dur', 6 + Math.random() * 6 + 's');
    c.style.animationDelay = Math.random() * 6 + 's';
    confettiLayer.appendChild(c);
  }
}
function startVisuals() {
  sprinkleConfetti();
  setInterval(releaseBalloons, 2000);
  releaseBalloons();
}
// Music playback
const music = document.getElementById('music');
function tryPlay() {
  if (!music) return;
  try {
    music.load();
  } catch (e) {}
  const p = music.play();
  if (p && typeof p.then === 'function') {
    p
      .then(() => {
        music.muted = false;
        music.volume = 0.8;
        setTimeout(() => {
          music.pause();
          music.currentTime = 0;
        }, 20000);
      })
      .catch(() => {
        armUserGesturePlayback();
      });
  }
}
function armUserGesturePlayback() {
  const resume = () => {
    const r = music.play();
    if (r && typeof r.then === 'function') {
      r.then(() => {
        music.muted = false;
        music.volume = 0.8;
        setTimeout(() => {
          music.pause();
          music.currentTime = 0;
        }, 20000);
        cleanup();
      });
    }
  };
  const cleanup = () => {
    ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click'].forEach(
      (ev) => document.removeEventListener(ev, resume)
    );
  };
  ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click'].forEach((ev) =>
    document.addEventListener(ev, resume, { once: false })
  );
}
window.addEventListener('load', () => {
  startVisuals();
  tryPlay();
});
window.addEventListener('pageshow', () => {
  tryPlay();
});

// Birthday Counter Logic
const counter = document.getElementById('counter');
const bDate = new Date(2025, 8, 16); // Month is 0-based!
const now = new Date();
let yearDiff = now.getFullYear() - bDate.getFullYear();
let hasHadBirthday = now.getMonth() > 8 || (now.getMonth() === 8 && now.getDate() >= 16);
if (!hasHadBirthday) {
  yearDiff -= 1;
}
if (yearDiff > 0) {
  counter.textContent =
    yearDiff === 1
      ? '🎉 Happy 1st Birthday! 🎉'
      : yearDiff === 2
      ? '🎈 Happy 2nd Birthday! 🎈'
      : `✨ Happy ${yearDiff}th Birthday! ✨`;
} else {
  counter.textContent = '🎂 Happy 1st Birthday! 🎂';
}
// Personalize name if present
const params = new URLSearchParams(location.search);
const name = params.get('name');
if (name) {
  document.getElementById('title').textContent = `Happy Birthday, ${name}! 🎉`;
  document.title = `🎂 Happy Birthday, ${name}!`;
}
