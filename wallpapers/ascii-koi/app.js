/*
 * ASCII Koi Wallpaper Adapter for ASCII Desk
 * Cleaned UI (100% viewport canvas) and connected to AsciiDesk Bridge.
 */
(() => {
  "use strict";
  const { createPond, AsciiMark } = window.AsciiKoi;
  const root = document.documentElement;
  const q = new URLSearchParams(location.search);
  const THEMES = ["pond", "black", "light"];
  const KEY = "ascii-koi-theme";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  };

  const fixed = root.dataset.lock;
  const first = [q.get("theme"), fixed, store.get(), "pond"].find(v => THEMES.includes(v));
  root.dataset.theme = first;

  const pondCanvas = document.getElementById("pond");
  const introEl = document.getElementById("intro");
  const box = document.getElementById("intro-box");
  const titleCanvas = document.getElementById("wordmark");
  const tagCanvas = document.getElementById("wordmark-tag");
  const srTitle = document.getElementById("sr-title");
  const dateLine = document.getElementById("intro-date");

  const cssVar = n => getComputedStyle(root).getPropertyValue(n).trim();
  const palette = () => ({
    water: cssVar("--pond"), ink: cssVar("--ink"), accent: cssVar("--accent"),
    koiLight: cssVar("--koi-light"), koiDark: cssVar("--koi-dark"),
    dark: cssVar("color-scheme").includes("dark")
  });

  let showClock = true;
  let userPaused = false;
  let systemPaused = false;

  const pond = createPond({
    canvas: pondCanvas, palette, reduce, most: 24,
    dim: () => {
      if (!showClock) return null;
      const r = box.getBoundingClientRect();
      return r.width ? r : null;
    }
  });
  pond.size(innerWidth, innerHeight);
  window.AsciiKoi.pond = pond;

  /* ── the words: the time as the title, the day under it, then the date ── */
  const own = q.get("title");
  const narrow = () => innerWidth < 720;
  const words = () => {
    const now = new Date();
    const date = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    if (own) return { title: own, tag: q.get("tag") || "", date };
    const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    return { title: time, tag: now.toLocaleDateString("en-GB", { weekday: "long" }), date };
  };
  let current = words();
  const serif = `"Noto Serif Display", "Iowan Old Style", Georgia, serif`;
  const look = { tint: pond.tint, light: pond.light };
  const title = AsciiMark(titleCanvas, () => ({
    text: current.title, font: `700 ${narrow() ? 120 : own ? 170 : 230}px ${serif}`,
    cw: narrow() ? 4 : 7, ch: narrow() ? 5 : 9, maxW: Math.min(innerWidth * (narrow() ? 0.9 : 0.8), own ? 700 : 820), edge: true, glow: 1
  }), look);
  const tag = AsciiMark(tagCanvas, () => ({
    text: current.tag || " ", font: `700 ${narrow() ? 64 : 84}px ${serif}`,
    cw: narrow() ? 3 : 4, ch: narrow() ? 4 : 5, maxW: Math.min(innerWidth * (narrow() ? 0.66 : 0.42), 420), tone: 0.88, edge: !narrow(), glow: 0.7
  }), look);
  const clock = () => performance.now() / 1000;
  const buildWords = () => {
    dateLine.textContent = current.date;
    return Promise.all([title.build(clock()), tag.build(clock() + 0.35)]);
  };
  srTitle.textContent = own ? `${current.title} ${current.tag}` : "ASCII Koi";

  let lastWords = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (pond.paused || !showClock) return;
    if (now - lastWords < 66) return;
    lastWords = now;
    const s = now / 1000;
    title.draw(s); tag.draw(s);
    if (!own) {
      const w = words();
      if (w.title !== current.title || w.tag !== current.tag || w.date !== current.date) { current = w; buildWords(); }
    }
  }

  /* ── the waters ── */
  const snap = document.getElementById("snap");
  function setTheme(name, at) {
    if (!THEMES.includes(name) || name === root.dataset.theme) return;
    const dpr = pondCanvas.width / innerWidth;
    if (!reduce && !pond.paused) {
      snap.width = pondCanvas.width; snap.height = pondCanvas.height;
      const s = snap.getContext("2d");
      s.drawImage(pondCanvas, 0, 0);
      if (showClock) {
        for (const m of [title, tag]) {
          for (const c of [m.glow, m === title ? titleCanvas : tagCanvas]) {
            const r = c && c.getBoundingClientRect();
            if (!r || !r.width || !c.width) continue;
            s.filter = c === m.glow ? `blur(${14 * dpr}px)` : "none";
            s.drawImage(c, r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr);
          }
        }
        s.filter = "none";
        const r = dateLine.getBoundingClientRect(), ds = getComputedStyle(dateLine);
        s.setTransform(dpr, 0, 0, dpr, 0, 0);
        s.font = `${ds.fontWeight} ${ds.fontSize} ${ds.fontFamily}`; s.letterSpacing = ds.letterSpacing;
        s.fillStyle = ds.color; s.globalAlpha = +ds.opacity; s.textBaseline = "middle";
        s.fillText(dateLine.textContent.toUpperCase(), r.left, r.top + r.height / 2);
        s.setTransform(1, 0, 0, 1, 0, 0); s.globalAlpha = 1;
      }
      const x = at ? at.x : innerWidth / 2, y = at ? at.y : innerHeight / 2;
      snap.style.setProperty("--x", x + "px");
      snap.style.setProperty("--y", y + "px");
      snap.classList.remove("wipe");
      snap.classList.add("show");
      void snap.offsetWidth;
      snap.classList.add("wipe");
    }
    root.dataset.theme = name;
    if (!fixed) store.set(name);
    pond.colors();
  }
  snap.addEventListener("transitionend", () => snap.classList.remove("show", "wipe"));

  /* ── interactions: Left-click feeds the koi ── */
  let fedAt = 0;
  const feedAt = (x, y) => {
    const now = performance.now();
    if (now - fedAt < 180) return;
    fedAt = now;
    pond.feed(x, y);
  };
  addEventListener("pointerdown", e => {
    if (e.button === 0) {
      feedAt(e.clientX, e.clientY);
    }
  });
  addEventListener("contextmenu", e => {
    e.preventDefault();
  });

  let resizeTimer = 0;
  addEventListener("resize", () => {
    pond.size(innerWidth, innerHeight);
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => buildWords(), 120);
  });

  function syncPauseState() {
    pond.pause(userPaused || systemPaused);
  }

  /* ── Bridge connection ── */
  function handleConfig(cfg) {
    if (!cfg) return;
    if (cfg.theme && THEMES.includes(cfg.theme)) {
      setTheme(cfg.theme);
    }
    if (cfg.speed !== undefined) {
      pond.setSpeed(parseFloat(cfg.speed));
    }
    if (cfg.paused !== undefined) {
      userPaused = !!cfg.paused;
      syncPauseState();
    }
    if (cfg.__systemPaused !== undefined) {
      systemPaused = !!cfg.__systemPaused;
      syncPauseState();
    }
    if (cfg.showClock !== undefined) {
      showClock = !!cfg.showClock;
      if (introEl) introEl.style.display = showClock ? "" : "none";
      pond.render();
    }
  }

  if (window.AsciiDesk) {
    window.AsciiDesk.onConfig(handleConfig);
  }
  window.addEventListener("message", e => {
    if (e.data && e.data.type === "ASCII_DESK_CONFIG") {
      handleConfig(e.data.values);
    } else if (e.data && e.data.type === "ASCII_DESK_PAUSE") {
      systemPaused = !!e.data.paused;
      syncPauseState();
    }
  });

  pond.start();
  buildWords().then(() => { box.classList.add("go"); requestAnimationFrame(frame); });
  document.fonts?.load(`600 12px "Geist Mono"`).then(() => pond.colors());
})();
