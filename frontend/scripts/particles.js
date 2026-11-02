(function () {
  const canvas = document.getElementById('particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = canvas.width = window.innerWidth;
  let h = canvas.height = window.innerHeight;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const particles = [];
  const N = reduce ? 0 : 70;
  for (let i = 0; i < N; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.8 + 0.6,
      hue: Math.random() > 0.5 ? 230 : 280,
    });
  }
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  function draw() {
    ctx.clearRect(0, 0, w, h);
    // connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 130) {
          ctx.strokeStyle = `rgba(120,140,255,${(1 - dist / 130) * 0.25})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, 0.9)`;
      ctx.shadowColor = `hsla(${p.hue}, 80%, 70%, 1)`;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    requestAnimationFrame(draw);
  }
  draw();
})();
