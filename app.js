/**
 * VITALIS EXPERIENCE 1.0 — Cinematic Controller & Living Canvas Engine
 * Attached globally to window to guarantee 100% click handler reliability.
 */

window.currentPersona = 'ops';
window.currentTab = 'body';
window.activeScenarioKey = 'golden_path';
window.isThrombosisActive = false;

let canvas = null;
let ctx = null;
let particles = [];
let animFrameId = null;

// 1. TOPOLOGY NODE DEFINITIONS
const TOPOLOGY_NODES = [
  { id: 'client', name: 'Customer Client', x: 80, y: 180, color: '#38bdf8', icon: 'smartphone' },
  { id: 'f5', name: 'F5 / Load Balancer', x: 220, y: 180, color: '#38bdf8', icon: 'shield' },
  { id: 'ihs', name: 'IBM HTTP Server', x: 360, y: 180, color: '#38bdf8', icon: 'server' },
  { id: 'was', name: 'WebSphere Core', x: 500, y: 180, color: '#38bdf8', icon: 'cpu' },
  { id: 'mq', name: 'IBM MQ Bus', x: 640, y: 180, color: '#818cf8', icon: 'layers' },
  { id: 'db2', name: 'DB2 Cluster', x: 780, y: 180, color: '#f43f5e', icon: 'database' },
  { id: 'stripe', name: 'Payment Gateway', x: 920, y: 180, color: '#34d399', icon: 'credit-card' }
];

// 2. MULTI-PERSONA PERSPECTIVE ADAPTER
const PERSONA_CONFIGS = {
  cio: {
    title: "Executive (CEO / CIO) Perspective",
    icon: "👔",
    desc: "Business Impact: Checkout is degraded with 12,438 transactions affected. Likely cause: Database contention introduced after recent deploy.",
    highlight: "Business Impact Focus"
  },
  ops: {
    title: "Operations Engineer Perspective",
    icon: "🛠️",
    desc: "Architectural Diagnosis: DB2 lock contention on PID #99142, query fingerprint Q-847, and HikariCP connection pool saturation at 98%.",
    highlight: "System Infrastructure Focus"
  },
  app: {
    title: "Application Engineer Perspective",
    icon: "💻",
    desc: "Code-Level Lineage: Deployment v2.4.1 (commit 8a4f91e) introduced batch inventory lock query without index on sku_id table.",
    highlight: "Code & Change Lineage Focus"
  }
};

window.setPersona = function(type) {
  window.currentPersona = type;
  document.querySelectorAll('[id^="persona-"]').forEach(btn => {
    btn.className = "px-3 py-1 rounded-lg text-slate-400 hover:text-white transition font-medium";
  });
  const activeBtn = document.getElementById(`persona-${type}`);
  if (activeBtn) {
    activeBtn.className = "px-3 py-1 rounded-lg bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold transition";
  }

  const p = PERSONA_CONFIGS[type];
  if (p) {
    const titleEl = document.getElementById("personaTitle");
    const iconEl = document.getElementById("personaIcon");
    const descEl = document.getElementById("personaDesc");
    if (titleEl) titleEl.innerText = p.title;
    if (iconEl) iconEl.innerText = p.icon;
    if (descEl) descEl.innerText = p.desc;
  }
};

// 3. TAB SWITCHER
window.switchTab = function(tabId) {
  window.currentTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('tab-active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));

  const activeBtn = document.getElementById(`tab-${tabId}`);
  if (activeBtn) activeBtn.classList.add('tab-active');

  const activeView = document.getElementById(`view-${tabId}`);
  if (activeView) activeView.classList.remove('hidden');

  if (tabId === 'flow') {
    window.initCanvas();
  }
};

// 4. TRIGGER CHECKOUT THROMBOSIS (THE "WOW" MOMENT)
window.triggerCheckoutThrombosis = function() {
  window.isThrombosisActive = true;
  const banner = document.getElementById("blockageBanner");
  const chain = document.getElementById("causalExpansionChain");
  if (banner) banner.classList.remove("hidden");
  if (chain) chain.classList.remove("hidden");

  window.renderTransparentRequestView(true);
  window.switchTab('diff');
};

// 5. RENDER TRANSPARENT REQUEST VIEW
window.renderTransparentRequestView = function(isDegraded = false) {
  const goldenHopsList = document.getElementById("goldenHopsList");
  const currentHopsList = document.getElementById("currentHopsList");
  if (!goldenHopsList || !currentHopsList) return;

  const goldenHops = [
    { node: "Client", time: "12 ms", status: "✓ OK", color: "text-emerald-400" },
    { node: "F5 / Load Balancer", time: "18 ms", status: "✓ OK", color: "text-emerald-400" },
    { node: "IBM HTTP Server (IHS)", time: "21 ms", status: "✓ OK", color: "text-emerald-400" },
    { node: "WebSphere Application", time: "51 ms", status: "✓ OK", color: "text-emerald-400" },
    { node: "IBM MQ Series", time: "14 ms", status: "✓ OK", color: "text-emerald-400" },
    { node: "DB2 Database Cluster", time: "18 ms", status: "✓ OK", color: "text-emerald-400" },
    { node: "Stripe External Gateway", time: "46 ms", status: "✓ OK", color: "text-emerald-400" }
  ];

  const currentHops = isDegraded ? [
    { node: "Client", time: "12 ms", status: "✓ OK", color: "text-emerald-400" },
    { node: "F5 / Load Balancer", time: "18 ms", status: "✓ OK", color: "text-emerald-400" },
    { node: "IBM HTTP Server (IHS)", time: "21 ms", status: "✓ OK", color: "text-emerald-400" },
    { node: "WebSphere Application", time: "51 ms", status: "✓ OK", color: "text-emerald-400" },
    { node: "IBM MQ Series", time: "14 ms", status: "✓ OK", color: "text-emerald-400" },
    { node: "DB2 Database Cluster", time: "3,982 ms (156x)", status: "🔴 THROMBOSIS", color: "text-rose-400 font-bold" },
    { node: "Stripe External Gateway", time: "0 ms", status: "⚠️ UNREACHED (504)", color: "text-slate-500" }
  ] : goldenHops;

  goldenHopsList.innerHTML = goldenHops.map(h => `
    <div class="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
      <span class="text-slate-300">${h.node}</span>
      <div class="flex items-center gap-3">
        <span class="text-slate-400 font-mono">${h.time}</span>
        <span class="text-emerald-400 font-bold font-mono">${h.status}</span>
      </div>
    </div>
  `).join('');

  currentHopsList.innerHTML = currentHops.map(h => `
    <div class="p-2.5 rounded-lg ${h.color.includes('rose') ? 'bg-rose-950/80 border-rose-600' : 'bg-slate-900/80 border-slate-800'} border flex items-center justify-between">
      <span class="text-slate-200 font-medium">${h.node}</span>
      <div class="flex items-center gap-3">
        <span class="font-mono ${h.color}">${h.time}</span>
        <span class="font-mono font-bold ${h.color}">${h.status}</span>
      </div>
    </div>
  `).join('');
};

// 6. SYNTHETIC PULSE TRIGGER
window.triggerSyntheticPulse = function() {
  window.isThrombosisActive = false;
  const banner = document.getElementById("blockageBanner");
  if (banner) banner.classList.add("hidden");
  window.renderTransparentRequestView(false);
  alert("🟢 Synthetic Golden Pulse dispatched across all 7 heterogeneous tiers. System 100% Healthy (142ms).");
};

// 7. CONTROLLED REMEDIATION EXECUTION
window.executeControlledRemediation = function() {
  const btn = document.getElementById("btnExecuteFirstAid");
  if (btn) btn.innerHTML = `<span>⏳ Verifying Preconditions & Dispatching...</span>`;

  setTimeout(() => {
    window.isThrombosisActive = false;
    const banner = document.getElementById("blockageBanner");
    if (banner) banner.classList.add("hidden");
    window.renderTransparentRequestView(false);

    if (btn) {
      btn.innerHTML = `<span>✓ Remediated & Baseline Restored (18ms)</span>`;
      btn.className = "bg-emerald-600 text-white font-bold text-xs px-5 py-3 rounded-xl";
    }

    const vHealth = document.getElementById("vitalHealth");
    const vScore = document.getElementById("executiveVitalityScore");
    if (vHealth) vHealth.innerText = "99.99%";
    if (vScore) vScore.innerText = "99.99%";

    alert("✅ VITALIS Closed-Loop Remediation Complete:\n- Terminated holding lock PID #99142\n- Scaled DB2 pool\n- Transaction latency restored to 18ms (HTTP 200 Restored)");
  }, 1000);
};

window.triggerRollbackSafety = function() {
  alert("⏪ VITALIS Auto-Rollback Guard:\nCanary deployment safely rolled back to image tag v2.4.0. Production integrity preserved.");
};

// 8. CINEMATIC AUTOMATED JOURNEY WALKTHROUGH
window.startCinematicJourney = async function() {
  // Step 1: IT Body
  window.switchTab('body');
  await new Promise(r => setTimeout(r, 1800));

  // Step 2: Trigger Blockage
  window.triggerCheckoutThrombosis();
  await new Promise(r => setTimeout(r, 2400));

  // Step 3: Zoom to "WHY?" (Confidence Envelope)
  window.switchTab('why');
  await new Promise(r => setTimeout(r, 2400));

  // Step 4: Replay & Decision Hub
  window.switchTab('whatnext');
  await new Promise(r => setTimeout(r, 2400));

  // Step 5: Change Timeline
  window.switchTab('changes');
};

// 9. CANVAS PARTICLE RENDERING ENGINE
window.initCanvas = function() {
  canvas = document.getElementById("topologyCanvas");
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  if (canvas.parentElement) {
    canvas.width = canvas.parentElement.clientWidth || 900;
  } else {
    canvas.width = 900;
  }
  canvas.height = 360;

  particles = [];
  for (let i = 0; i < 24; i++) {
    particles.push({
      progress: Math.random(),
      speed: window.isThrombosisActive ? 0.002 : (0.005 + Math.random() * 0.004)
    });
  }

  if (!animFrameId) renderCanvas();
};

function renderCanvas() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w = canvas.width;
  const h = canvas.height;
  const nodeCount = TOPOLOGY_NODES.length;
  const spacing = Math.max(80, (w - 160) / (nodeCount - 1));

  // Draw Vessels (Connecting Lines)
  for (let i = 0; i < nodeCount - 1; i++) {
    const x1 = 80 + i * spacing;
    const x2 = 80 + (i + 1) * spacing;
    const y = h / 2;

    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.lineWidth = 4;
    ctx.strokeStyle = (window.isThrombosisActive && i >= 4) ? "rgba(244, 63, 94, 0.8)" : "rgba(56, 189, 248, 0.4)";
    ctx.stroke();
  }

  // Draw Nodes
  for (let i = 0; i < nodeCount; i++) {
    const x = 80 + i * spacing;
    const y = h / 2;
    const node = TOPOLOGY_NODES[i];

    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fillStyle = (window.isThrombosisActive && node.id === 'db2') ? "#e11d48" : "#0f172a";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = (window.isThrombosisActive && node.id === 'db2') ? "#f43f5e" : "#38bdf8";
    ctx.stroke();

    // Node Label
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "11px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(node.name, x, y + 36);
  }

  // Draw Flowing Particles
  for (const p of particles) {
    p.progress += p.speed;
    if (p.progress > 1) p.progress = 0;

    const totalDistance = (nodeCount - 1) * spacing;
    let currentX = 80 + p.progress * totalDistance;
    const currentY = h / 2;

    if (window.isThrombosisActive && currentX > (80 + 4.5 * spacing)) {
      currentX = 80 + 5 * spacing + (Math.sin(Date.now() * 0.005) * 6);
    }

    ctx.beginPath();
    ctx.arc(currentX, currentY, 5, 0, Math.PI * 2);
    ctx.fillStyle = window.isThrombosisActive ? "#fb7185" : "#38bdf8";
    ctx.shadowBlur = 12;
    ctx.shadowColor = window.isThrombosisActive ? "#f43f5e" : "#0ea5e9";
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  animFrameId = requestAnimationFrame(renderCanvas);
}

// 10. INITIALIZATION
window.addEventListener("DOMContentLoaded", () => {
  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
  window.renderTransparentRequestView(false);
  window.setPersona('ops');
});
