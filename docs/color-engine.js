// Color engine: spectral pigment mixing (Kubelka-Munk) + CIEDE2000 similarity.
// Works in browser (window.ColorEngine) and Node (module.exports).
(function (root) {
  const WL = [];
  for (let l = 400; l <= 700; l += 10) WL.push(l);

  // Wyman/Sloan/Shirley analytic CIE 1931 color matching functions
  function g(x, m, s1, s2) { const t = (x - m) / (x < m ? s1 : s2); return Math.exp(-0.5 * t * t); }
  const CMF = WL.map(l => [
    1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
    0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
    1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
  ]);

  function reflToLin(R) {
    let X = 0, Y = 0, Z = 0;
    for (let i = 0; i < WL.length; i++) { X += R[i] * CMF[i][0]; Y += R[i] * CMF[i][1]; Z += R[i] * CMF[i][2]; }
    return [
      3.2406 * X - 1.5372 * Y - 0.4986 * Z,
      -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
      0.0557 * X - 0.2040 * Y + 1.0570 * Z,
    ];
  }
  const WHITE = reflToLin(WL.map(() => 1));
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const gamma = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

  function reflToRGB(R) {
    const lin = reflToLin(R);
    return lin.map((v, i) => Math.round(gamma(clamp01(v / WHITE[i])) * 255));
  }

  const sig = x => 1 / (1 + Math.exp(-x));
  const gauss = (l, m, s) => Math.exp(-(((l - m) / s) ** 2));

  // Reflectance curves of the paints
  const PIGMENTS = [
    { id: 'red',    name: 'แดง',     curve: l => 0.03 + 0.74 * sig((l - 600) / 10) + 0.06 * gauss(l, 410, 25) },
    { id: 'yellow', name: 'เหลือง',  curve: l => 0.03 + 0.76 * sig((l - 500) / 10), strength: 1.4 },
    { id: 'blue',   name: 'น้ำเงิน', curve: l => 0.03 + 0.62 * gauss(l, 470, 48) + 0.05 * sig((l - 670) / 12) },
    { id: 'white',  name: 'ขาว',     curve: () => 0.94, strength: 3 },
    { id: 'black',  name: 'ดำ',      curve: () => 0.02, strength: 0.5 },
  ];
  const ks = r => ((1 - r) * (1 - r)) / (2 * r);
  for (const p of PIGMENTS) {
    p.refl = WL.map(p.curve);
    p.ks = p.refl.map(ks);
    p.strength = p.strength || 1;
    p.rgb = reflToRGB(p.refl);
  }

  // counts: { red: 2, blue: 1, ... } → [r,g,b] or null if empty
  function mix(counts) {
    let total = 0;
    const acc = new Array(WL.length).fill(0);
    for (const p of PIGMENTS) {
      const c = (counts[p.id] || 0) * p.strength;
      if (!c) continue;
      total += c;
      for (let i = 0; i < WL.length; i++) acc[i] += c * p.ks[i];
    }
    if (!total) return null;
    const R = acc.map(a => { const k = a / total; return 1 + k - Math.sqrt(k * k + 2 * k); });
    return reflToRGB(R);
  }

  // ---- CIELAB + CIEDE2000 ----
  function rgbToLab([r, g, b]) {
    const lin = [r, g, b].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    const X = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047;
    const Y = (0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]);
    const Z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
    const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
    const fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function deltaE2000(l1, l2) {
    const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    const Cb = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
    const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const hp = (b, a) => { if (b === 0 && a === 0) return 0; const h = Math.atan2(b, a) * deg; return h < 0 ? h + 360 : h; };
    const h1p = hp(b1, a1p), h2p = hp(b2, a2p);
    const dLp = L2 - L1, dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
    const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
    let hbp = h1p + h2p;
    if (C1p * C2p !== 0) {
      if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
      else hbp = (h1p + h2p) / 2;
    }
    const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
      + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
    const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
    const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
    const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
    const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
    const Rt = -Math.sin(2 * dTheta * rad) * Rc;
    return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
  }

  // Similarity percentage 0–100
  function similarity(rgbA, rgbB) {
    if (!rgbA || !rgbB) return 0;
    const dE = deltaE2000(rgbToLab(rgbA), rgbToLab(rgbB));
    return Math.max(0, Math.min(100, 100 - dE * 1.4));
  }

  const DIFFICULTY = {
    easy:   { min: 2, max: 2, maxDrops: 4 },
    normal: { min: 2, max: 3, maxDrops: 5 },
    hard:   { min: 3, max: 4, maxDrops: 7 },
  };

  function randomRecipe(level = 'normal', rand = Math.random) {
    const d = DIFFICULTY[level] || DIFFICULTY.normal;
    for (let tries = 0; tries < 200; tries++) {
      const k = d.min + Math.floor(rand() * (d.max - d.min + 1));
      // weighted pick without replacement: chromatic paints are favoured, black is rare
      const pool = [['red', 3], ['yellow', 3], ['blue', 3], ['white', 2], ['black', 0.8]];
      const ids = [];
      while (ids.length < k) {
        const sum = pool.reduce((s, [, w]) => s + w, 0);
        let x = rand() * sum, i = 0;
        while ((x -= pool[i][1]) > 0) i++;
        ids.push(pool.splice(i, 1)[0][0]);
      }
      const recipe = {};
      for (const id of ids) {
        const max = id === 'black' ? Math.min(2, d.maxDrops) : d.maxDrops;
        recipe[id] = 1 + Math.floor(rand() * max);
      }
      const rgb = mix(recipe);
      const [L, a, b] = rgbToLab(rgb);
      if (L < 28 || L > 95) continue; // avoid near-black / near-white targets
      if (Math.hypot(a, b) < 12 && rand() < 0.7) continue; // fewer dull greys/browns
      return { recipe, rgb };
    }
    return { recipe: { red: 1, yellow: 1 }, rgb: mix({ red: 1, yellow: 1 }) };
  }

  const toHex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');

  const api = { PIGMENTS, mix, similarity, deltaE2000, rgbToLab, randomRecipe, toHex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ColorEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
