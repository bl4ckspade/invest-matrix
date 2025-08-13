/* =========================
   Matrix What-If Investment
   Pure vanilla JS
   ========================= */

// ---- Data ----
const msciWorldReturns = [
  0.103, 0.213, 0.133, 0.176, 0.244, 0.241,
  -0.124, -0.166, -0.198, 0.334, 0.104, 0.107,
  0.201, 0.096, -0.404, 0.301, 0.095, -0.053,
  0.161, 0.270, 0.056, -0.004, 0.082, 0.230,
  -0.085, 0.281, -0.089, 0.222, -0.185, 0.235
];

// ---- Finance helpers (as requested) ----
// Future value of a single payment
function fv(pv, rate, years) {
  return pv * (1 + rate) ** years;
}
// Future value of recurring payments
function fvSeries(pmt, rate, years, freq) {
  const r = rate / freq;
  const n = years * freq;
  return pmt * ((1 + r) ** n - 1) / r;
}

// ---- DOM ----
const $ = (q) => document.querySelector(q);

const amountEl = $('#amount');
const recurringToggle = $('#recurringToggle');
const freqEl = $('#frequency');
const horizonEl = $('#horizon');
const horizonOut = $('#horizonOut');
const expReturnEl = $('#expReturn');
const inflToggle = $('#inflToggle');
const inflRateEl = $('#inflation');
const taxToggle = $('#taxToggle');
const taxRateEl = $('#taxRate');
const histToggle = $('#histToggle');
const simsEl = $('#sims');

const fvNominalEl = $('#fvNominal');
const fvRealCard = $('#fvRealCard');
const fvRealEl = $('#fvReal');
const fvAfterTaxCard = $('#fvAfterTaxCard');
const fvAfterTaxEl = $('#fvAfterTax');
const mcStats = $('#mcStats');
const mcMedian = $('#mcMedian');
const mcP10 = $('#mcP10');
const mcP90 = $('#mcP90');
const mcBest = $('#mcBest');
const mcWorst = $('#mcWorst');

const modeBadge = $('#modeBadge');
const tooltip = $('#tooltip');

const chartCanvas = $('#chart');
const ctx = chartCanvas.getContext('2d');

let deviceRatio = Math.max(1, Math.floor(window.devicePixelRatio || 1));
resizeCanvas();

// hover state
let hoverX = null;
let currentPlot = {
  mode: 'idle',          // 'single' | 'mc' | 'idle'
  years: 0,
  xMap: null,            // function idx->x
  yMap: null,            // function val->y
  singlePath: null,      // [values per year]
  median: null,          // [values per year]
  p10: null,             // [values per year]
  p90: null,             // [values per year]
  yMax: 0
};

// ---- Formatting helpers ----
const fmtEUR0 = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtEUR2 = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function niceMax(v){
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const d = v / pow;
  let m = 1;
  if (d > 7.5) m = 10;
  else if (d > 5) m = 7.5;
  else if (d > 3) m = 5;
  else if (d > 2) m = 3;
  else if (d > 1) m = 2;
  return m * pow;
}

function percentile(vals, p){
  if (!vals.length) return 0;
  const arr = vals.slice().sort((a,b)=>a-b);
  if (p <= 0) return arr[0];
  if (p >= 1) return arr[arr.length-1];
  const idx = (arr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return arr[lo];
  const frac = idx - lo;
  return arr[lo] * (1 - frac) + arr[hi] * frac;
}

// ---- Simulation core ----
function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function simulateSinglePath({ amount, years, recurring, freq, useHistorical, fixedRate }) {
  // Returns: { path: number[], totalContrib: number }
  // path[i] = value at end of year i (0..years)
  const out = new Array(years + 1).fill(0);
  let value = 0;
  let totalContrib = 0;

  // Year 0 state
  if (!recurring) {
    value = amount;
    totalContrib += amount;
    out[0] = value;
  } else {
    out[0] = 0;
  }

  for (let y = 1; y <= years; y++){
    const rYear = useHistorical ? pickRandom(msciWorldReturns) : fixedRate;

    // Existing pot grows over the year
    value *= (1 + rYear);

    // Contributions made during the year (if recurring)
    if (recurring){
      const n = freq;
      const r_p = Math.pow(1 + rYear, 1/n) - 1; // per-period rate implied by rYear
      // closed-form within the year to the year-end
      const contribFV = amount * ((1 + r_p) ** n - 1) / r_p;
      value += contribFV;
      totalContrib += amount * n;
    }

    out[y] = value;
  }
  return { path: out, totalContrib };
}

function simulateMonteCarlo({ amount, years, recurring, freq, useHistorical, fixedRate, runs }) {
  // Build distributions per year
  const perYearValues = Array.from({ length: years + 1 }, () => []);
  const endValues = [];

  for (let i = 0; i < runs; i++){
    const { path } = simulateSinglePath({ amount, years, recurring, freq, useHistorical, fixedRate });
    for (let y = 0; y <= years; y++){
      perYearValues[y].push(path[y]);
    }
    endValues.push(path[years]);
  }

  const median = perYearValues.map(list => percentile(list, 0.5));
  const p10 = perYearValues.map(list => percentile(list, 0.10));
  const p90 = perYearValues.map(list => percentile(list, 0.90));
  const best = Math.max(...endValues);
  const worst = Math.min(...endValues);

  return { median, p10, p90, best, worst };
}

// ---- Tax & inflation ----
function applyInflation(value, inflRate, years){
  if (!inflRate) return value;
  return value / ((1 + inflRate) ** years);
}
function applyEndTax(endingValue, totalContrib, taxRate){
  const gain = Math.max(0, endingValue - totalContrib);
  return endingValue - gain * taxRate;
}

// ---- Charting ----
function resizeCanvas(){
  const rect = chartCanvas.getBoundingClientRect();
  const ratio = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  chartCanvas.width = Math.floor(rect.width * ratio);
  chartCanvas.height = Math.floor(rect.height * ratio);
  deviceRatio = ratio;
}

function drawChart(config){
  const { years, yMax, singlePath, median, p10, p90, mode } = config;
  currentPlot = { ...config };

  const W = chartCanvas.width, H = chartCanvas.height;
  const PADL = 80 * deviceRatio, PADR = 20 * deviceRatio;
  const PADT = 30 * deviceRatio, PADB = 60 * deviceRatio;

  ctx.clearRect(0,0,W,H);

  // Helpers
  const xMap = (i) => PADL + ( (W - PADL - PADR) * (i/years) );
  const yMap = (v) => PADT + (H - PADT - PADB) * (1 - (v / yMax));
  currentPlot.xMap = xMap; currentPlot.yMap = yMap;

  // Grid
  ctx.save();
  ctx.strokeStyle = 'rgba(120,255,180,0.18)';
  ctx.lineWidth = 1 * deviceRatio;

  // Y ticks
  const yTicks = 5;
  ctx.font = `${12 * deviceRatio}px Consolas, monospace`;
  ctx.fillStyle = 'rgba(200,255,230,0.9)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let t=0; t<=yTicks; t++){
    const val = (yMax / yTicks) * t;
    const y = yMap(val);
    ctx.beginPath();
    ctx.moveTo(PADL, y);
    ctx.lineTo(W - PADR, y);
    ctx.stroke();
    const label = fmtEUR0.format(val);
    ctx.fillText(label, PADL - 10*deviceRatio, y);
  }

  // X ticks (years)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i=0; i<=years; i++){
    if (i % 5 !== 0 && i !== years) continue;
    const x = xMap(i);
    ctx.beginPath();
    ctx.moveTo(x, PADT);
    ctx.lineTo(x, H - PADB);
    ctx.stroke();
    ctx.fillText(String(i), x, H - PADB + 8*deviceRatio);
  }

  // Axes
  ctx.strokeStyle = 'rgba(0,255,156,0.45)';
  ctx.lineWidth = 2 * deviceRatio;
  ctx.beginPath();
  ctx.moveTo(PADL, PADT);
  ctx.lineTo(PADL, H - PADB);
  ctx.lineTo(W - PADR, H - PADB);
  ctx.stroke();

  // Draw band (MC)
  if (mode === 'mc' && p10 && p90){
    ctx.beginPath();
    for (let i=0; i<=years; i++){
      const x = xMap(i);
      const yU = yMap(p90[i]);
      if (i===0) ctx.moveTo(x, yU);
      else ctx.lineTo(x, yU);
    }
    for (let i=years; i>=0; i--){
      const x = xMap(i);
      const yL = yMap(p10[i]);
      ctx.lineTo(x, yL);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(126,208,255,0.18)'; // blue-ish translucent
    ctx.fill();
    ctx.strokeStyle = 'rgba(126,208,255,0.28)';
    ctx.stroke();
  }

  // Draw median / single line
  ctx.lineWidth = 3 * deviceRatio;
  ctx.lineJoin = 'round';

  if (mode === 'single' && singlePath){
    ctx.strokeStyle = '#87f7cf';
    ctx.shadowColor = 'rgba(135,247,207,0.3)';
    ctx.shadowBlur = 8 * deviceRatio;
    ctx.beginPath();
    for (let i=0;i<=years;i++){
      const x = xMap(i), y = yMap(singlePath[i]);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }

  if (mode === 'mc' && median){
    ctx.strokeStyle = '#7ed0ff';
    ctx.shadowColor = 'rgba(126,208,255,0.35)';
    ctx.shadowBlur = 8 * deviceRatio;
    ctx.beginPath();
    for (let i=0;i<=years;i++){
      const x = xMap(i), y = yMap(median[i]);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }

  // Hover crosshair
  if (hoverX !== null){
    const localX = clamp(hoverX, PADL, W-PADR);
    // nearest year index
    const i = Math.round( years * ((localX - PADL) / (W - PADL - PADR)) );
    const x = xMap(i);

    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,156,0.45)';
    ctx.lineWidth = 2 * deviceRatio;
    ctx.setLineDash([6*deviceRatio, 6*deviceRatio]);
    ctx.beginPath();
    ctx.moveTo(x, PADT);
    ctx.lineTo(x, H - PADB);
    ctx.stroke();
    ctx.restore();

    // value at that year
    let val = null;
    if (mode === 'single' && singlePath) val = singlePath[i];
    if (mode === 'mc' && median)     val = median[i];

    if (val != null){
      // small dot
      ctx.fillStyle = mode === 'single' ? '#87f7cf' : '#7ed0ff';
      ctx.beginPath();
      ctx.arc(x, currentPlot.yMap(val), 5 * deviceRatio, 0, Math.PI*2);
      ctx.fill();

      // tooltip DOM
      const tipText = `Year ${i} • ${fmtEUR0.format(val)}`;
      tooltip.innerText = tipText;
      tooltip.classList.remove('hidden');

      // Place tooltip (CSS pixels)
      const bbox = chartCanvas.getBoundingClientRect();
      const cssX = (x / deviceRatio) + bbox.left;
      const cssY = (currentPlot.yMap(val)/deviceRatio) + bbox.top;
      tooltip.style.left = `${cssX}px`;
      tooltip.style.top = `${cssY - 10}px`;
    }
  } else {
    tooltip.classList.add('hidden');
  }

  ctx.restore();
}

// ---- UI wiring ----
horizonEl.addEventListener('input', () => {
  horizonOut.textContent = horizonEl.value;
});

recurringToggle.addEventListener('change', () => {
  freqEl.disabled = !recurringToggle.checked;
});

inflToggle.addEventListener('change', () => {
  inflRateEl.disabled = !inflToggle.checked;
  fvRealCard.classList.toggle('hidden', !inflToggle.checked);
});

taxToggle.addEventListener('change', () => {
  taxRateEl.disabled = !taxToggle.checked;
  fvAfterTaxCard.classList.toggle('hidden', !taxToggle.checked);
});

histToggle.addEventListener('change', () => {
  const on = histToggle.checked;
  expReturnEl.disabled = on;
});

$('#runSingle').addEventListener('click', () => {
  runSimulation('single');
});
$('#runMC').addEventListener('click', () => {
  runSimulation('mc');
});
$('#clear').addEventListener('click', () => {
  currentPlot = { mode:'idle', years:0, xMap:null, yMap:null, singlePath:null, median:null, p10:null, p90:null, yMax:0 };
  hoverX = null;
  modeBadge.textContent = 'Cleared';
  fvNominalEl.textContent = '—';
  fvRealEl.textContent = '—';
  fvAfterTaxEl.textContent = '—';
  mcStats.classList.add('hidden');
  drawChart({ years: 1, yMax: 1, mode: 'idle' });
});

function getInputs(){
  const amount = Math.max(0, Number(amountEl.value || 0));
  const recurring = !!recurringToggle.checked;
  const freq = Number(freqEl.value);
  const years = Number(horizonEl.value);
  const useHistorical = !!histToggle.checked;
  const fixedRate = Number(expReturnEl.value)/100;
  const inflOn = !!inflToggle.checked;
  const inflRate = Number(inflRateEl.value)/100;
  const taxOn = !!taxToggle.checked;
  const taxRate = Number(taxRateEl.value)/100;
  const runs = Math.max(100, Math.min(5000, Number(simsEl.value||1000)));
  return { amount, recurring, freq, years, useHistorical, fixedRate, inflOn, inflRate, taxOn, taxRate, runs };
}

function runSimulation(kind){
  const a = getInputs();
  const labelParts = [];
  labelParts.push(kind === 'single' ? 'Single Path' : `Monte Carlo x${a.runs}`);
  labelParts.push(a.useHistorical ? 'Historical sampler' : `${(a.fixedRate*100).toFixed(2)}% fixed`);
  labelParts.push(a.recurring ? `Recurring (${freqLabel(a.freq)})` : 'One-off');
  modeBadge.textContent = labelParts.join(' • ');

  if (kind === 'single'){
    const { path, totalContrib } = simulateSinglePath({
      amount: a.amount, years: a.years, recurring: a.recurring, freq: a.freq,
      useHistorical: a.useHistorical, fixedRate: a.fixedRate
    });

    const end = path[a.years];
    const nominal = end;
    fvNominalEl.textContent = fmtEUR0.format(nominal);

    if (a.inflOn){
      const real = applyInflation(nominal, a.inflRate, a.years);
      fvRealEl.textContent = fmtEUR0.format(real);
      fvRealCard.classList.remove('hidden');
    } else {
      fvRealCard.classList.add('hidden');
    }

    if (a.taxOn){
      const afterTax = applyEndTax(nominal, totalContrib, a.taxRate);
      fvAfterTaxEl.textContent = fmtEUR0.format(afterTax);
      fvAfterTaxCard.classList.remove('hidden');
    } else {
      fvAfterTaxCard.classList.add('hidden');
    }

    mcStats.classList.add('hidden');

    const yMax = niceMax(Math.max(...path) * 1.05);
    drawChart({ mode:'single', years: a.years, yMax, singlePath: path });
  } else {
    const mc = simulateMonteCarlo({
      amount: a.amount, years: a.years, recurring: a.recurring, freq: a.freq,
      useHistorical: a.useHistorical, fixedRate: a.fixedRate, runs: a.runs
    });

    // Display MC stats (nominal)
    mcMedian.textContent = fmtEUR0.format(mc.median[a.years]);
    mcP10.textContent = fmtEUR0.format(mc.p10[a.years]);
    mcP90.textContent = fmtEUR0.format(mc.p90[a.years]);
    mcBest.textContent = fmtEUR0.format(mc.best);
    mcWorst.textContent = fmtEUR0.format(mc.worst);
    mcStats.classList.remove('hidden');

    // Single-value cards: show nominal as median (most useful)
    fvNominalEl.textContent = fmtEUR0.format(mc.median[a.years]);

    // For inflation/after-tax, we need contributions to apply tax realistically.
    // Approximate with expected contributions: (recurring ? amount*freq*years : amount).
    const approxContrib = a.recurring ? a.amount * a.freq * a.years : a.amount;

    if (a.inflOn){
      const real = applyInflation(mc.median[a.years], a.inflRate, a.years);
      fvRealEl.textContent = fmtEUR0.format(real);
      fvRealCard.classList.remove('hidden');
    } else {
      fvRealCard.classList.add('hidden');
    }

    if (a.taxOn){
      const afterTax = applyEndTax(mc.median[a.years], approxContrib, a.taxRate);
      fvAfterTaxEl.textContent = fmtEUR0.format(afterTax);
      fvAfterTaxCard.classList.remove('hidden');
    } else {
      fvAfterTaxCard.classList.add('hidden');
    }

    const yMax = niceMax(Math.max(...mc.p90) * 1.05);
    drawChart({ mode:'mc', years: a.years, yMax, median: mc.median, p10: mc.p10, p90: mc.p90 });
  }
}

function freqLabel(f){
  if (f===365) return 'Daily';
  if (f===52) return 'Weekly';
  return 'Monthly';
}

// ---- Hover / touch on canvas ----
function toCanvasX(ev){
  const rect = chartCanvas.getBoundingClientRect();
  const xCss = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
  return xCss * deviceRatio;
}
function handleMove(ev){
  if (currentPlot.mode === 'idle') return;
  hoverX = toCanvasX(ev);
  drawChart(currentPlot);
}
function handleLeave(){
  hoverX = null;
  drawChart(currentPlot);
}
chartCanvas.addEventListener('mousemove', handleMove, { passive:true });
chartCanvas.addEventListener('mouseleave', handleLeave, { passive:true });
chartCanvas.addEventListener('touchstart', handleMove, { passive:true });
chartCanvas.addEventListener('touchmove', handleMove, { passive:true });
chartCanvas.addEventListener('touchend', handleLeave, { passive:true });
window.addEventListener('resize', () => { resizeCanvas(); drawChart(currentPlot.mode==='idle'?{ years:1, yMax:1, mode:'idle' }:currentPlot); });

// ---- Initial blank chart ----
drawChart({ years: 1, yMax: 1, mode:'idle' });

// ---- Matrix background rain ----
(function matrixRain(){
  const c = document.getElementById('matrix-bg');
  const g = c.getContext('2d');
  const setSize = () => {
    c.width = window.innerWidth;
    c.height = window.innerHeight;
  };
  setSize();
  window.addEventListener('resize', setSize);

  const columns = Math.floor(c.width / 18);
  const drops = Array(columns).fill(1);
  const glyphs = '01'; // keep it classic

  function draw(){
    g.fillStyle = 'rgba(5,8,6,0.07)'; // fade
    g.fillRect(0,0,c.width,c.height);

    g.fillStyle = '#00ff9c';
    g.shadowColor = '#00ff9c';
    g.shadowBlur = 8;
    g.font = '16px Consolas, monospace';

    for (let i=0; i<drops.length; i++){
      const x = i * 18;
      const y = drops[i] * 18;
      const text = glyphs[Math.floor(Math.random()*glyphs.length)];
      g.fillText(text, x, y);

      if (y > c.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
    requestAnimationFrame(draw);
  }
  draw();
})();
