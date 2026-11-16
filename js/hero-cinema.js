'use strict';
/* Saqi Hero Cinematic Stage — Oasis Light/Dark adapted 3D phone & GSAP scroll choreography.
 * Strictly visual/motion layer: reads metrics from Engine.decideZoneA without mutating calculations or copy.
 * Safe fallback: every element stays visible if GSAP is offline or Calm/Reduced Motion is enabled. */
(function () {
  const RING_CIRC = 364.42; // 2 * pi * 58
  let currentTargetVal = 34;
  let lastSavedFlag = true;
  let initialized = false;
  let gsapCtx = null;

  const isReduced = () =>
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.calmBg === '1');

  function setRingInstant(pct, savedFlag) {
    const ring = document.getElementById('heroRingFg');
    const valEl = document.getElementById('heroStageSavedPct');
    const clamped = Math.max(4, Math.min(100, Math.abs(+pct || 0)));
    const offset = RING_CIRC * (1 - clamped / 100);
    if (ring) ring.style.strokeDashoffset = offset.toFixed(1);
    if (valEl) valEl.textContent = (savedFlag ? '' : '+') + Math.round(Math.abs(+pct || 0)) + '%';
  }

  function sync(d) {
    if (!d) return;
    const saved = d.savedLitres >= 0;
    const absPct = Math.abs(d.savedPct);
    currentTargetVal = absPct;
    lastSavedFlag = saved;

    const lblEl = document.getElementById('heroStageSavedLbl');
    const minsEl = document.getElementById('heroPhoneMins');
    const minsSubEl = document.getElementById('heroPhoneMinsSub');
    const flushEl = document.getElementById('heroPhoneFlush');
    const flushSubEl = document.getElementById('heroPhoneFlushSub');
    const badgeVolEl = document.getElementById('heroBadgeVol');
    const yieldEl = document.getElementById('heroPhoneYield');

    if (lblEl) lblEl.textContent = saved ? 'WATER SAVED' : 'HEAT BUFFER';
    if (minsEl) minsEl.textContent = `${d.totalMinutes} min · after 21:00`;
    if (minsSubEl) minsSubEl.textContent = `ET₀ ${d.et0} mm/d · 2 ha drip`;
    if (flushEl) flushEl.textContent = d.flushPct > 0 ? `+${d.flushPct}% salt flush` : 'No flush needed';
    if (flushSubEl) flushSubEl.textContent = `Modeled ECe ${d.modeledECe.toFixed(1)} dS/m`;
    if (badgeVolEl) badgeVolEl.textContent = `${d.smartLitres.toLocaleString('en-US')} L today`;
    if (yieldEl) yieldEl.textContent = `${d.smartYieldPct}% est. yield`;

    if (!window.gsap || isReduced() || initialized) {
      setRingInstant(absPct, saved);
    }
  }

  function bindMouseTilt() {
    const stageCard = document.getElementById('heroStageCard');
    const bezel = document.getElementById('heroPhoneBezel');
    const heroPreview = document.querySelector('.preview-card');
    if (!stageCard || !bezel) return;

    let raf = 0;
    const handleMove = e => {
      if (isReduced() || document.hidden) return;
      if (heroPreview) {
        const pr = heroPreview.getBoundingClientRect();
        if (e.clientY >= pr.top - 40 && e.clientY <= pr.bottom + 40) {
          heroPreview.style.setProperty('--mouse-x', `${e.clientX - pr.left}px`);
          heroPreview.style.setProperty('--mouse-y', `${e.clientY - pr.top}px`);
        }
      }
      const rect = stageCard.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;

      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        stageCard.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
        stageCard.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
        const nx = (e.clientX - (rect.left + rect.width / 2)) / Math.max(rect.width / 2, 1);
        const ny = (e.clientY - (rect.top + rect.height / 2)) / Math.max(rect.height / 2, 1);
        const clampedX = Math.max(-1, Math.min(1, nx));
        const clampedY = Math.max(-1, Math.min(1, ny));

        if (window.gsap) {
          gsap.to(bezel, { rotationY: clampedX * 11, rotationX: -clampedY * 9, ease: 'power3.out', duration: 0.9, overwrite: 'auto' });
        } else {
          bezel.style.transform = `rotateY(${(clampedX * 8).toFixed(2)}deg) rotateX(${(-clampedY * 6).toFixed(2)}deg)`;
        }
      });
    };

    const resetTilt = () => {
      cancelAnimationFrame(raf);
      if (window.gsap) gsap.to(bezel, { rotationY: 0, rotationX: 0, ease: 'power3.out', duration: 0.9, overwrite: 'auto' });
      else bezel.style.transform = '';
    };

    stageCard.addEventListener('pointermove', handleMove, { passive: true });
    stageCard.addEventListener('pointerleave', resetTilt);
    document.querySelector('.hero-section')?.addEventListener('pointermove', e => {
      if (!heroPreview || isReduced()) return;
      const pr = heroPreview.getBoundingClientRect();
      heroPreview.style.setProperty('--mouse-x', `${e.clientX - pr.left}px`);
      heroPreview.style.setProperty('--mouse-y', `${e.clientY - pr.top}px`);
    }, { passive: true });
  }

  function setupGSAP() {
    if (gsapCtx) { gsapCtx.revert(); gsapCtx = null; }
    const home = document.getElementById('home');
    const stageCard = document.getElementById('heroStageCard');
    if (!home || !stageCard) return;

    if (!window.gsap || !window.ScrollTrigger || isReduced()) {
      setRingInstant(currentTargetVal, lastSavedFlag);
      return;
    }

    gsap.registerPlugin(ScrollTrigger);
    gsapCtx = gsap.context(() => {
      // Hero opening entrance (runs smoothly while keeping layout stable)
      const heroTl = gsap.timeline({ defaults: { ease: 'expo.out' } });
      heroTl
        .from('.hero-badge', { y: 16, opacity: 0, duration: 0.65 }, 0)
        .from('.hero-line-1', { y: 26, opacity: 0, duration: 0.85 }, 0.08)
        .fromTo('.hero-line-2',
          { clipPath: 'inset(0 100% 0 0)', opacity: 0.25 },
          { clipPath: 'inset(0 0% 0 0)', opacity: 1, duration: 0.95, ease: 'power4.inOut' },
          0.18
        )
        .from('.hero-sub', { y: 18, opacity: 0, duration: 0.75 }, 0.26)
        .from('.hero-ctas', { y: 14, opacity: 0, duration: 0.7 }, 0.34)
        .from('.preview-wrap', { y: 26, opacity: 0, scale: 0.97, duration: 0.9 }, 0.16);

      // Scroll-driven choreography for the interactive 3D Oasis Phone Stage
      const ringEl = document.getElementById('heroRingFg');
      const valEl = document.getElementById('heroStageSavedPct');
      const stageTl = gsap.timeline({
        scrollTrigger: {
          trigger: '#heroStage',
          start: 'top 86%',
          end: 'top 22%',
          scrub: 0.65,
        },
      });

      stageTl
        .fromTo(stageCard, { y: 38, scale: 0.95 }, { y: 0, scale: 1, ease: 'power2.out', duration: 1 }, 0)
        .fromTo('#heroPhoneWrap',
          { y: 55, rotationX: 22, rotationY: -14, scale: 0.86 },
          { y: 0, rotationX: 0, rotationY: 0, scale: 1, ease: 'expo.out', duration: 1.2 },
          0
        )
        .fromTo('.hero-stage-left', { x: -24, opacity: 0.35 }, { x: 0, opacity: 1, ease: 'power3.out', duration: 1 }, 0.1)
        .fromTo('.hero-stage-brand', { x: 24, opacity: 0.35, scale: 0.92 }, { x: 0, opacity: 1, scale: 1, ease: 'power3.out', duration: 1 }, 0.1)
        .fromTo('.hero-float-badge',
          { y: 28, z: 48, opacity: 0, scale: 0.88 },
          { y: 0, z: 48, opacity: 1, scale: 1, stagger: 0.14, ease: 'back.out(1.4)', duration: 0.85 },
          0.2
        );

      // Animate SVG ring sweep and counter whenever #heroStage enters view
      if (ringEl) {
        const clamped = Math.max(4, Math.min(100, Math.abs(currentTargetVal || 34)));
        const targetOffset = RING_CIRC * (1 - clamped / 100);
        const counter = { v: 0 };
        gsap.fromTo(ringEl,
          { strokeDashoffset: RING_CIRC },
          {
            strokeDashoffset: targetOffset,
            duration: 1.25,
            ease: 'power3.out',
            scrollTrigger: { trigger: '#heroStage', start: 'top 80%', once: true },
          }
        );
        if (valEl) {
          gsap.to(counter, {
            v: Math.round(Math.abs(currentTargetVal || 34)),
            duration: 1.25,
            ease: 'power3.out',
            scrollTrigger: { trigger: '#heroStage', start: 'top 80%', once: true },
            onUpdate() {
              valEl.textContent = (lastSavedFlag ? '' : '+') + Math.round(counter.v) + '%';
            },
          });
        }
      }
    }, home);
  }

  function refresh() {
    if (!document.getElementById('home')?.classList.contains('active')) return;
    setRingInstant(currentTargetVal, lastSavedFlag);
    if (window.ScrollTrigger && !isReduced()) {
      setTimeout(() => window.ScrollTrigger.refresh(), 90);
    }
  }

  function init() {
    if (typeof Engine !== 'undefined' && typeof simCond !== 'undefined') {
      sync(Engine.decideZoneA(simCond));
    }
    bindMouseTilt();
    setupGSAP();
    initialized = true;
    new MutationObserver(() => {
      if (isReduced() && gsapCtx) { gsapCtx.revert(); gsapCtx = null; setRingInstant(currentTargetVal, lastSavedFlag); }
      else if (!isReduced() && !gsapCtx) setupGSAP();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-calm-bg'] });
  }

  window.HeroCinema = { sync, refresh, init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
