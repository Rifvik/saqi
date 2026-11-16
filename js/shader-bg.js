'use strict';
/* Saqi WebGL Shader Background — adapted from ShaderBackground for vanilla JS.
 * Supports smooth Dark & Light Oasis palettes plus scroll-linked parallax. */
(() => {
  const canvas = document.getElementById('shaderBg');
  if (!canvas) return;

  const gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'low-power' });
  if (!gl) { canvas.style.display = 'none'; return; }

  const vsSource = `
    attribute vec4 aVertexPosition;
    void main() {
      gl_Position = aVertexPosition;
    }
  `;

  const fsSource = `
    precision highp float;
    uniform vec2 iResolution;
    uniform float iTime;
    uniform float uScroll;
    uniform float uLight;
    uniform vec3 uBase;
    uniform vec3 uBg1;
    uniform vec3 uBg2;
    uniform vec3 uLine1;
    uniform vec3 uLine2;

    const float overallSpeed = 0.2;
    const float gridSmoothWidth = 0.015;
    const float minLineWidth = 0.012;
    const float maxLineWidth = 0.20;
    const float scale = 5.0;
    const float lineSpeed = 1.0 * overallSpeed;
    const float lineAmplitude = 1.0;
    const float lineFrequency = 0.2;
    const float warpSpeed = 0.2 * overallSpeed;
    const float warpFrequency = 0.5;
    const float warpAmplitude = 1.0;
    const float offsetFrequency = 0.5;
    const float offsetSpeed = 1.33 * overallSpeed;
    const float minOffsetSpread = 0.6;
    const float maxOffsetSpread = 2.0;
    const int linesPerGroup = 16;

    #define drawCircle(pos, radius, coord) smoothstep(radius + gridSmoothWidth, radius, length(coord - (pos)))
    #define drawSmoothLine(pos, halfWidth, t) smoothstep(halfWidth, 0.0, abs(pos - (t)))
    #define drawCrispLine(pos, halfWidth, t) smoothstep(halfWidth + gridSmoothWidth, halfWidth, abs(pos - (t)))

    float random(float t) {
      return (cos(t) + cos(t * 1.3 + 1.3) + cos(t * 1.4 + 1.4)) / 3.0;
    }

    float getPlasmaY(float x, float horizontalFade, float offset) {
      return random(x * lineFrequency + iTime * lineSpeed) * horizontalFade * lineAmplitude + offset;
    }

    void main() {
      vec2 fragCoord = gl_FragCoord.xy;
      vec2 uv = fragCoord.xy / iResolution.xy;
      vec2 space = (fragCoord - iResolution.xy / 2.0) / iResolution.x * 2.0 * scale;
      space.y -= uScroll * 1.1;

      float horizontalFade = 1.0 - (cos(uv.x * 6.28318) * 0.5 + 0.5);
      float verticalFade = 1.0 - (cos(uv.y * 6.28318) * 0.5 + 0.5);

      space.y += random(space.x * warpFrequency + iTime * warpSpeed) * warpAmplitude * (0.5 + horizontalFade);
      space.x += random(space.y * warpFrequency + iTime * warpSpeed + 2.0) * warpAmplitude * horizontalFade;

      vec3 lineAcc = vec3(0.0);
      float alphaAcc = 0.0;

      for (int l = 0; l < linesPerGroup; l++) {
        float normalizedLineIndex = float(l) / float(linesPerGroup);
        float offsetTime = iTime * offsetSpeed;
        float offsetPosition = float(l) + space.x * offsetFrequency;
        float rand = random(offsetPosition + offsetTime) * 0.5 + 0.5;
        float halfWidth = mix(minLineWidth, maxLineWidth, rand * horizontalFade) / 2.0;
        float offset = random(offsetPosition + offsetTime * (1.0 + normalizedLineIndex)) * mix(minOffsetSpread, maxOffsetSpread, horizontalFade);
        float linePosition = getPlasmaY(space.x, horizontalFade, offset);
        float line = drawSmoothLine(linePosition, halfWidth, space.y) / 2.0 + drawCrispLine(linePosition, halfWidth * 0.15, space.y);

        float circleX = mod(float(l) + iTime * lineSpeed, 25.0) - 12.0;
        vec2 circlePosition = vec2(circleX, getPlasmaY(circleX, horizontalFade, offset));
        float circle = drawCircle(circlePosition, 0.012, space) * 3.5;

        float intensity = (line + circle) * rand;
        vec3 col = mix(uLine1, uLine2, normalizedLineIndex);
        lineAcc += intensity * col;
        alphaAcc += intensity;
      }

      vec3 bgGrad = mix(uBg1, uBg2, uv.x);
      vec3 baseMix = mix(uBase, bgGrad, 0.45 + 0.55 * verticalFade);

      vec3 finalCol;
      if (uLight > 0.5) {
        // Light Oasis: softly blend emerald/sage waves onto warm alabaster without darkening edges
        float inkStrength = clamp(alphaAcc * 0.095, 0.0, 0.34);
        vec3 avgLine = lineAcc / max(alphaAcc, 0.001);
        finalCol = mix(baseMix, avgLine, inkStrength);
      } else {
        // Dark Oasis: luminous emerald & aqua waves over warm obsidian charcoal (shouldered so glass cards stay legible)
        finalCol = baseMix + (lineAcc * 0.34) / (vec3(1.0) + lineAcc * 0.42);
      }

      gl_FragColor = vec4(clamp(finalCol, 0.0, 1.0), 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Shader link error:', gl.getProgramInfoLog(prog));
    return;
  }

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'aVertexPosition');
  const loc = {
    res: gl.getUniformLocation(prog, 'iResolution'),
    time: gl.getUniformLocation(prog, 'iTime'),
    scroll: gl.getUniformLocation(prog, 'uScroll'),
    light: gl.getUniformLocation(prog, 'uLight'),
    base: gl.getUniformLocation(prog, 'uBase'),
    bg1: gl.getUniformLocation(prog, 'uBg1'),
    bg2: gl.getUniformLocation(prog, 'uBg2'),
    l1: gl.getUniformLocation(prog, 'uLine1'),
    l2: gl.getUniformLocation(prog, 'uLine2'),
  };

  // Theme-matched palettes (Oasis Forest Green + Warm Alabaster in Light; Deep Obsidian + Emerald + Water Aqua in Dark)
  const PALETTES = {
    light: {
      light: 1.0,
      base: [0.968, 0.960, 0.935],
      bg1:  [0.895, 0.942, 0.912],
      bg2:  [0.962, 0.932, 0.875],
      l1:   [0.165, 0.445, 0.295],
      l2:   [0.340, 0.565, 0.435],
    },
    dark: {
      light: 0.0,
      base: [0.088, 0.082, 0.076],
      bg1:  [0.078, 0.138, 0.105],
      bg2:  [0.145, 0.108, 0.082],
      l1:   [0.240, 0.680, 0.440],
      l2:   [0.360, 0.640, 0.780],
    },
  };

  const cur = {
    light: 1.0,
    base: [...PALETTES.light.base],
    bg1:  [...PALETTES.light.bg1],
    bg2:  [...PALETTES.light.bg2],
    l1:   [...PALETTES.light.l1],
    l2:   [...PALETTES.light.l2],
  };

  let targetMode = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const syncThemeNow = () => {
    targetMode = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  };
  new MutationObserver(syncThemeNow).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  syncThemeNow();
  // Snap immediately on first paint
  Object.assign(cur, {
    light: PALETTES[targetMode].light,
    base: [...PALETTES[targetMode].base],
    bg1:  [...PALETTES[targetMode].bg1],
    bg2:  [...PALETTES[targetMode].bg2],
    l1:   [...PALETTES[targetMode].l1],
    l2:   [...PALETTES[targetMode].l2],
  });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  const reduceQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const isReduced = () => Boolean(reduceQuery?.matches || document.documentElement.dataset.calmBg === '1');
  let start = performance.now();
  let hiddenAt = null;
  let rafId = null;
  let scrollVal = 0;

  function lerpArr(a, b, t) { for (let i = 0; i < 3; i++) a[i] += (b[i] - a[i]) * t; }

  function frame(now) {
    rafId = null;
    if (document.visibilityState === 'hidden') return;
    const reduced = isReduced();
    const tgt = PALETTES[targetMode];
    cur.light += (tgt.light - cur.light) * (reduced ? 1 : 0.08);
    lerpArr(cur.base, tgt.base, reduced ? 1 : 0.08);
    lerpArr(cur.bg1, tgt.bg1, reduced ? 1 : 0.08);
    lerpArr(cur.bg2, tgt.bg2, reduced ? 1 : 0.08);
    lerpArr(cur.l1, tgt.l1, reduced ? 1 : 0.08);
    lerpArr(cur.l2, tgt.l2, reduced ? 1 : 0.08);

    const targetScroll = (window.scrollY || 0) / Math.max(window.innerHeight, 600);
    scrollVal += (targetScroll - scrollVal) * (reduced ? 1 : 0.1);

    gl.useProgram(prog);
    gl.uniform2f(loc.res, canvas.width, canvas.height);
    gl.uniform1f(loc.time, reduced ? 4.2 : (now - start) / 1000);
    gl.uniform1f(loc.scroll, scrollVal);
    gl.uniform1f(loc.light, cur.light);
    gl.uniform3fv(loc.base, cur.base);
    gl.uniform3fv(loc.bg1, cur.bg1);
    gl.uniform3fv(loc.bg2, cur.bg2);
    gl.uniform3fv(loc.l1, cur.l1);
    gl.uniform3fv(loc.l2, cur.l2);

    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aPos);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!reduced || Math.abs(tgt.light - cur.light) > 0.005) {
      rafId = requestAnimationFrame(frame);
    }
  }

  function kick() {
    if (rafId == null && document.visibilityState !== 'hidden') rafId = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = performance.now();
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    } else {
      if (hiddenAt != null) { start += performance.now() - hiddenAt; hiddenAt = null; }
      kick();
    }
  });
  new MutationObserver(() => kick()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-calm-bg'] });
  kick();
})();
