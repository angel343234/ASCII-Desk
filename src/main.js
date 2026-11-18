/**
 * ASCII & Shader Wallpaper Studio - Main Controller
 * Handles both:
 *   1. Desktop Wallpaper Host (?role=wallpaper)
 *   2. Full Studio Window (?role=panel) with 60 FPS Live WebGL2 Preview, +25 Shaders, Media Import & PNG/WebM Export
 */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const role = params.get("role") || "panel";

  const invoke = (cmd, args) => {
    if (window.__TAURI__ && window.__TAURI__.core) {
      return window.__TAURI__.core.invoke(cmd, args);
    }
    return Promise.reject("Tauri API not available");
  };

  const listen = (event, handler) => {
    if (window.__TAURI__ && window.__TAURI__.event) {
      return window.__TAURI__.event.listen(event, handler);
    }
    return Promise.resolve(() => {});
  };

  function buildMediaUrl(filePath) {
    if (!filePath) return "";
    if (filePath.startsWith("blob:") || filePath.startsWith("data:") || filePath.startsWith("http")) {
      return filePath;
    }
    return `http://wallpaper.localhost/__local_media?path=${encodeURIComponent(filePath)}`;
  }

  function createGifPlayer() {
    let decoder = null;
    let timer = 0;
    let frameIndex = 0;
    let activeUrl = "";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const fallbackImg = document.createElement("img");
    fallbackImg.crossOrigin = "anonymous";
    let useFallback = false;

    function stop() {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      if (decoder) {
        try { decoder.close(); } catch (e) {}
        decoder = null;
      }
    }

    async function load(url) {
      if (activeUrl === url && (decoder || useFallback)) return;
      stop();
      activeUrl = url;
      useFallback = false;

      if (typeof window.ImageDecoder === "function") {
        try {
          const resp = await fetch(url);
          const buf = await resp.arrayBuffer();
          decoder = new window.ImageDecoder({ data: buf, type: "image/gif" });
          await decoder.tracks.ready;
          frameIndex = 0;
          renderNextFrame();
          return;
        } catch (err) {
          decoder = null;
        }
      }

      // Fallback: keep offscreen <img> so Chromium advances GIF frames without ever showing anything on screen
      useFallback = true;
      fallbackImg.style.cssText =
        "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;";
      if (!fallbackImg.parentNode) document.body.appendChild(fallbackImg);
      fallbackImg.onload = () => {
        canvas.width = fallbackImg.naturalWidth || 320;
        canvas.height = fallbackImg.naturalHeight || 240;
      };
      fallbackImg.src = url;
    }

    async function renderNextFrame() {
      if (!decoder) return;
      try {
        const res = await decoder.decode({ frameIndex });
        const frame = res.image;
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(frame, 0, 0);
        const durMs = Math.max(20, (frame.duration || 80000) / 1000);
        frame.close();
        const count = decoder.tracks.selectedTrack ? decoder.tracks.selectedTrack.frameCount : 0;
        frameIndex = count > 0 ? (frameIndex + 1) % count : frameIndex + 1;
        timer = setTimeout(renderNextFrame, durMs);
      } catch (e) {
        frameIndex = 0;
        timer = setTimeout(renderNextFrame, 60);
      }
    }

    function getSource() {
      if (useFallback && fallbackImg.complete && fallbackImg.naturalWidth > 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(fallbackImg, 0, 0);
      }
      return canvas.width > 0 ? canvas : null;
    }

    return { load, stop, getSource, canvas };
  }

  if (role === "wallpaper") {
    initWallpaperHost();
  } else {
    initStudioWindow();
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 1. DESKTOP WALLPAPER HOST (?role=wallpaper)
   * ═══════════════════════════════════════════════════════════════════════════ */
  async function initWallpaperHost() {
    const root = document.getElementById("wallpaper-root");
    const frame = document.getElementById("wallpaper-frame");
    const videoEl = document.getElementById("wallpaper-video");
    const imageEl = document.getElementById("wallpaper-image");
    const glCanvas = document.getElementById("wallpaper-gl-canvas");
    root.classList.remove("hidden");

    const pipeline = window.ShaderRegistry
      ? new window.ShaderRegistry.ShaderPipeline(glCanvas)
      : null;
    const gifPlayer = createGifPlayer();

    let currentSourceType = "interactive";
    let currentFolder = "ascii-koi";
    let currentMediaPath = "";
    let currentValues = {};
    let currentShader = { ...(window.ShaderRegistry ? window.ShaderRegistry.DEFAULT_PARAMS : {}) };
    let isPaused = false;

    const resizeGL = () => {
      glCanvas.width = window.innerWidth;
      glCanvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resizeGL);
    resizeGL();

    function postToWallpaper(msg) {
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage(msg, "*");
      }
    }

    function applyStudioState(stateObj) {
      if (!stateObj) return;
      let srcType = stateObj.source_type || "interactive";
      const folder = stateObj.active_wallpaper || "ascii-koi";
      const mediaPath = stateObj.media_path || "";
      if (srcType !== "interactive" && !mediaPath) {
        srcType = "interactive";
      }
      const wpValues = (stateObj.settings && stateObj.settings[folder]) || stateObj.values || {};
      const shaderCfg = stateObj.shader || currentShader;
      isPaused = !!(stateObj.paused || stateObj.auto_paused);

      currentValues = wpValues;
      currentShader = { ...currentShader, ...shaderCfg };
      if (pipeline) {
        pipeline.setParams(currentShader);
      }

      if (srcType === "interactive") {
        videoEl.pause();
        gifPlayer.stop();
        videoEl.classList.add("hidden");
        imageEl.classList.add("hidden");
        glCanvas.classList.add("hidden");
        frame.classList.remove("hidden");

        if (currentSourceType !== "interactive" || currentFolder !== folder || !frame.src) {
          currentFolder = folder;
          frame.src = `wallpapers/${encodeURIComponent(folder)}/index.html`;
        } else {
          postToWallpaper({ type: "ASCII_DESK_CONFIG", values: currentValues });
          postToWallpaper({ type: "ASCII_DESK_SHADER", shader: currentShader });
          postToWallpaper({ type: "ASCII_DESK_PAUSE", paused: isPaused });
        }
      } else if (srcType === "video") {
        gifPlayer.stop();
        frame.classList.add("hidden");
        imageEl.classList.add("hidden");
        videoEl.classList.remove("hidden");
        glCanvas.classList.remove("hidden");

        const url = buildMediaUrl(mediaPath);
        if (currentMediaPath !== mediaPath || videoEl.src !== url) {
          currentMediaPath = mediaPath;
          videoEl.src = url;
          videoEl.play().catch(() => {});
        }
        if (isPaused) videoEl.pause();
        else videoEl.play().catch(() => {});
        if (pipeline) pipeline.setSource(videoEl);
      } else if (srcType === "gif") {
        videoEl.pause();
        frame.classList.add("hidden");
        videoEl.classList.add("hidden");
        imageEl.classList.add("hidden");
        glCanvas.classList.remove("hidden");

        const url = buildMediaUrl(mediaPath);
        currentMediaPath = mediaPath;
        gifPlayer.load(url);
      } else if (srcType === "image") {
        videoEl.pause();
        gifPlayer.stop();
        frame.classList.add("hidden");
        videoEl.classList.add("hidden");
        imageEl.classList.remove("hidden");
        glCanvas.classList.remove("hidden");

        const url = buildMediaUrl(mediaPath);
        if (currentMediaPath !== mediaPath || imageEl.src !== url) {
          currentMediaPath = mediaPath;
          imageEl.src = url;
        }
        if (pipeline) pipeline.setSource(imageEl);
      }

      currentSourceType = srcType;
    }

    frame.addEventListener("load", () => {
      try {
        if (frame.contentWindow && frame.contentWindow.AsciiDesk) {
          frame.contentWindow.AsciiDesk.applyConfig(currentValues);
          frame.contentWindow.AsciiDesk.applyShaderParams(currentShader);
          frame.contentWindow.AsciiDesk.setSystemPaused(isPaused);
        }
      } catch (e) {}
      postToWallpaper({ type: "ASCII_DESK_CONFIG", values: currentValues });
      postToWallpaper({ type: "ASCII_DESK_SHADER", shader: currentShader });
      postToWallpaper({ type: "ASCII_DESK_PAUSE", paused: isPaused });
    });

    // Render loop for video/image/gif WebGL2 post-processing on desktop
    function desktopRenderLoop() {
      requestAnimationFrame(desktopRenderLoop);
      if (isPaused || currentSourceType === "interactive" || !pipeline) return;
      if (currentSourceType === "gif") {
        const gSrc = gifPlayer.getSource();
        if (gSrc) {
          pipeline.setSource(gSrc);
          pipeline.render();
        }
      } else {
        pipeline.render();
      }
    }
    requestAnimationFrame(desktopRenderLoop);

    try {
      const state = await invoke("get_app_state");
      applyStudioState(state);
    } catch (err) {
      applyStudioState({
        source_type: "interactive",
        active_wallpaper: "ascii-koi",
        settings: {},
      });
    }

    listen("studio-applied", (e) => {
      if (e && e.payload) applyStudioState(e.payload);
    });

    listen("wallpaper-changed", (e) => {
      const p = e.payload || {};
      applyStudioState({
        source_type: p.source_type || "interactive",
        active_wallpaper: p.folder || currentFolder,
        media_path: p.media_path !== undefined ? p.media_path : currentMediaPath,
        values: p.values || currentValues,
        shader: p.shader || currentShader,
        paused: p.paused !== undefined ? p.paused : isPaused,
      });
    });

    listen("wallpaper-config", (e) => {
      const p = e.payload || {};
      if (p.values) {
        Object.assign(currentValues, p.values);
        postToWallpaper({ type: "ASCII_DESK_CONFIG", values: currentValues });
      }
    });

    listen("wallpaper-shader", (e) => {
      if (e && e.payload) {
        Object.assign(currentShader, e.payload);
        if (pipeline) pipeline.setParams(currentShader);
        postToWallpaper({ type: "ASCII_DESK_SHADER", shader: currentShader });
      }
    });

    listen("wallpaper-pause", (e) => {
      const p = e.payload;
      isPaused = typeof p === "boolean" ? p : !!(p && p.paused);
      postToWallpaper({ type: "ASCII_DESK_PAUSE", paused: isPaused });
      if (currentSourceType === "video") {
        if (isPaused) videoEl.pause();
        else videoEl.play().catch(() => {});
      }
    });

    listen("desktop-mouse", (e) => {
      const payload = e.payload;
      if (!payload || isPaused) return;
      if (pipeline) {
        pipeline.mouse = [
          Math.max(0, Math.min(1, payload.x / Math.max(1, payload.vw || window.innerWidth))),
          Math.max(0, Math.min(1, payload.y / Math.max(1, payload.vh || window.innerHeight))),
        ];
      }
      postToWallpaper({
        type: "ASCII_DESK_MOUSE",
        action: payload.action,
        x: payload.x,
        y: payload.y,
        vw: payload.vw || 0,
        vh: payload.vh || 0,
        button: payload.button || 0,
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 2. STUDIO CONTROL WINDOW (?role=panel)
   * ═══════════════════════════════════════════════════════════════════════════ */
  async function initStudioWindow() {
    const root = document.getElementById("panel-root");
    root.classList.remove("hidden");

    const previewIframe = document.getElementById("preview-iframe");
    const previewVideo = document.getElementById("preview-video");
    const previewImage = document.getElementById("preview-image");
    const previewCanvas = document.getElementById("preview-gl-canvas");
    const previewStage = document.getElementById("preview-stage");

    const hudSourceLabel = document.getElementById("hud-source-label");
    const hudStyleLabel = document.getElementById("hud-style-label");
    const hudFps = document.getElementById("hud-fps");
    const statusBadge = document.getElementById("status-badge");

    const selectEl = document.getElementById("wallpaper-select");
    const descEl = document.getElementById("wallpaper-desc");
    const controlsContainer = document.getElementById("controls-container");

    const shaderSearch = document.getElementById("shader-search");
    const shaderSelect = document.getElementById("shader-select");
    const shaderDesc = document.getElementById("shader-desc");

    const btnPause = document.getElementById("btn-pause");
    const btnClose = document.getElementById("btn-close");
    const btnReset = document.getElementById("btn-reset");
    const btnResetShader = document.getElementById("btn-reset-shader");
    const btnRandomize = document.getElementById("btn-randomize");
    const btnBrowseMedia = document.getElementById("btn-browse-media");
    const mediaFileInput = document.getElementById("media-file-input");
    const mediaFileName = document.getElementById("media-file-name");

    const btnApplyWallpaper = document.getElementById("btn-apply-wallpaper");
    const btnExportPng = document.getElementById("btn-export-png");
    const btnExportWebm = document.getElementById("btn-export-webm");

    const toggleSpanMonitors = document.getElementById("toggle-span-monitors");
    const toggleHideIcons = document.getElementById("toggle-hide-icons");
    const toggleAutostart = document.getElementById("toggle-autostart");

    const previewPipeline = new window.ShaderRegistry.ShaderPipeline(previewCanvas);
    const previewGifPlayer = createGifPlayer();

    let appState = null;
    let wallpapersMap = {};
    let draftSourceType = "interactive";
    let draftWallpaper = "ascii-koi";
    let draftMediaPath = "";
    let draftMediaBlobUrl = "";
    let draftShader = { ...window.ShaderRegistry.DEFAULT_PARAMS };

    // Resize preview canvas to stage bounds
    const syncPreviewSize = () => {
      const rect = previewStage.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        previewCanvas.width = Math.round(rect.width * (window.devicePixelRatio || 1));
        previewCanvas.height = Math.round(rect.height * (window.devicePixelRatio || 1));
      }
    };
    window.addEventListener("resize", syncPreviewSize);
    setTimeout(syncPreviewSize, 60);

    // Populate categorized shader select
    function populateShaderDropdown(filterText = "") {
      const q = filterText.trim().toLowerCase();
      shaderSelect.innerHTML = "";
      const categories = window.ShaderRegistry.getCategories();

      for (const [catName, styles] of Object.entries(categories)) {
        const filtered = styles.filter(
          (s) =>
            !q ||
            s.name.toLowerCase().includes(q) ||
            s.category.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q)
        );
        if (!filtered.length) continue;

        const group = document.createElement("optgroup");
        group.label = `[${catName}]`;
        for (const st of filtered) {
          const opt = document.createElement("option");
          opt.value = st.id;
          opt.textContent = st.name;
          if (st.id === draftShader.styleId) opt.selected = true;
          group.appendChild(opt);
        }
        shaderSelect.appendChild(group);
      }

      if (shaderSelect.options.length > 0 && !shaderSelect.value) {
        shaderSelect.selectedIndex = 0;
        onSelectShaderStyle(shaderSelect.value, false);
      }
    }

    function updateShaderUI() {
      const styleObj = window.ShaderRegistry.getStyleById(draftShader.styleId);
      shaderSelect.value = styleObj.id;
      shaderDesc.textContent = styleObj.description;
      hudStyleLabel.textContent = `Shader: ${styleObj.name}`;

      document.getElementById("sh-cellSize").value = draftShader.cellSize;
      document.getElementById("val-cellSize").textContent = `${draftShader.cellSize} px`;

      document.getElementById("sh-charset").value = draftShader.charset;
      document.getElementById("card-charset").style.display =
        styleObj.code >= 1 && styleObj.code <= 5 || styleObj.code === 25 ? "flex" : "none";

      const p1Label = (styleObj.defaults && styleObj.defaults.param1Label) || "Modulación de Estilo";
      document.getElementById("lbl-param1").textContent = p1Label;
      document.getElementById("sh-param1").value = draftShader.param1;
      document.getElementById("val-param1").textContent = Number(draftShader.param1).toFixed(2);

      document.getElementById("sh-blendMode").value = draftShader.blendMode;
      document.getElementById("sh-opacity").value = draftShader.opacity;
      document.getElementById("val-opacity").textContent = `${Math.round(draftShader.opacity * 100)}%`;

      document.getElementById("sh-invert").checked = !!draftShader.invert;
      document.getElementById("sh-dotGrid").checked = !!draftShader.dotGrid;

      document.getElementById("sh-relief").value = draftShader.relief;
      document.getElementById("val-relief").textContent = Number(draftShader.relief).toFixed(2);

      document.getElementById("sh-bevel").value = draftShader.bevel;
      document.getElementById("val-bevel").textContent = Number(draftShader.bevel).toFixed(2);

      document.getElementById("sh-lightAngle").value = draftShader.lightAngle;
      document.getElementById("val-lightAngle").textContent = `${draftShader.lightAngle}°`;

      document.getElementById("sh-intensity").value = draftShader.intensity;
      document.getElementById("val-intensity").textContent = Number(draftShader.intensity).toFixed(2);

      document.getElementById("sh-contrast").value = draftShader.contrast;
      document.getElementById("sh-brightness").value = draftShader.brightness;
      document.getElementById("sh-saturation").value = draftShader.saturation;
      document.getElementById("sh-palette").value = draftShader.palette;

      document.getElementById("sh-useCustomColors").checked = !!draftShader.useCustomColors;
      document.getElementById("sh-fgColor").value = draftShader.fgColor;
      document.getElementById("sh-bgColor").value = draftShader.bgColor;

      document.getElementById("sh-animSpeed").value = draftShader.animSpeed;
      document.getElementById("val-animSpeed").textContent = `${Number(draftShader.animSpeed).toFixed(1)}x`;

      document.querySelectorAll(".aspect-pill").forEach((b) => {
        b.classList.toggle("active", Number(b.dataset.fit) === Number(draftShader.fitMode));
      });

      previewPipeline.setParams(draftShader);
      syncPreviewSourceVisibility();
    }

    function onSelectShaderStyle(styleId, applyStyleDefaults = true) {
      const styleObj = window.ShaderRegistry.getStyleById(styleId);
      draftShader.styleId = styleObj.id;
      if (applyStyleDefaults && styleObj.defaults) {
        if (styleObj.defaults.cellSize !== undefined) draftShader.cellSize = styleObj.defaults.cellSize;
        if (styleObj.defaults.charset !== undefined) draftShader.charset = styleObj.defaults.charset;
        if (styleObj.defaults.relief !== undefined) draftShader.relief = styleObj.defaults.relief;
        if (styleObj.defaults.bevel !== undefined) draftShader.bevel = styleObj.defaults.bevel;
        if (styleObj.defaults.palette !== undefined) draftShader.palette = styleObj.defaults.palette;
        if (styleObj.defaults.param1 !== undefined) draftShader.param1 = styleObj.defaults.param1;
        if (styleObj.defaults.intensity !== undefined) draftShader.intensity = styleObj.defaults.intensity;
      }
      updateShaderUI();
      broadcastLiveShaderToDesktop();
    }

    function syncPreviewSourceVisibility() {
      syncPreviewSize();
      const isBypass = draftShader.styleId === "none" && draftSourceType === "interactive";

      if (draftSourceType === "interactive") {
        previewVideo.pause();
        previewGifPlayer.stop();
        previewVideo.classList.add("hidden");
        previewImage.classList.add("hidden");
        previewIframe.classList.remove("hidden");
        previewCanvas.classList.toggle("hidden", isBypass);
      } else {
        previewIframe.classList.add("hidden");
        previewImage.classList.add("hidden");
        previewVideo.classList.add("hidden");
        previewCanvas.classList.remove("hidden");
      }
    }

    function switchSourceType(type) {
      draftSourceType = type;
      document.querySelectorAll(".source-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.sourceType === type);
      });

      const isInteractive = type === "interactive";
      document.getElementById("source-panel-interactive").classList.toggle("hidden", !isInteractive);
      document.getElementById("source-panel-media").classList.toggle("hidden", isInteractive);

      if (isInteractive) {
        const wp = wallpapersMap[draftWallpaper];
        hudSourceLabel.textContent = `Fuente: ${(wp && wp.manifest.name) || draftWallpaper}`;
        const targetSrc = `wallpapers/${encodeURIComponent(draftWallpaper)}/index.html`;
        if (!previewIframe.src.endsWith(targetSrc)) {
          previewIframe.src = targetSrc;
        }
      } else {
        const label = draftMediaPath ? draftMediaPath.split(/[\\/]/).pop() : "Sin archivo seleccionado";
        hudSourceLabel.textContent = `Fuente (${type.toUpperCase()}): ${label}`;
      }

      syncPreviewSourceVisibility();
    }

    // Bind source type tabs
    document.querySelectorAll(".source-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchSourceType(btn.dataset.sourceType));
    });

    // Bind parameter internal tabs
    document.querySelectorAll(".param-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.paramTab;
        document.querySelectorAll(".param-tab").forEach((b) => b.classList.toggle("active", b === btn));
        document.getElementById("tab-style").classList.toggle("hidden", tab !== "style");
        document.getElementById("tab-depth").classList.toggle("hidden", tab !== "depth");
        document.getElementById("tab-color").classList.toggle("hidden", tab !== "color");
        document.getElementById("tab-anim").classList.toggle("hidden", tab !== "anim");
      });
    });

    // Bind shader search & select
    shaderSearch.addEventListener("input", () => {
      populateShaderDropdown(shaderSearch.value);
    });

    shaderSelect.addEventListener("change", () => {
      onSelectShaderStyle(shaderSelect.value, true);
    });

    // Bind all shader controls
    const bindSlider = (id, key, fmt) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(`val-${key}`);
      el.addEventListener("input", () => {
        draftShader[key] = parseFloat(el.value);
        if (valEl && fmt) valEl.textContent = fmt(draftShader[key]);
        previewPipeline.setParams(draftShader);
        syncPreviewSourceVisibility();
        broadcastLiveShaderToDesktop();
      });
    };

    bindSlider("sh-cellSize", "cellSize", (v) => `${v} px`);
    bindSlider("sh-param1", "param1", (v) => v.toFixed(2));
    bindSlider("sh-opacity", "opacity", (v) => `${Math.round(v * 100)}%`);
    bindSlider("sh-relief", "relief", (v) => v.toFixed(2));
    bindSlider("sh-bevel", "bevel", (v) => v.toFixed(2));
    bindSlider("sh-lightAngle", "lightAngle", (v) => `${v}°`);
    bindSlider("sh-intensity", "intensity", (v) => v.toFixed(2));
    bindSlider("sh-contrast", "contrast");
    bindSlider("sh-brightness", "brightness");
    bindSlider("sh-saturation", "saturation");
    bindSlider("sh-animSpeed", "animSpeed", (v) => `${v.toFixed(1)}x`);

    document.getElementById("sh-charset").addEventListener("input", (e) => {
      draftShader.charset = e.target.value || " .:-=+*#%@";
      previewPipeline.setParams(draftShader);
      broadcastLiveShaderToDesktop();
    });

    document.getElementById("sh-blendMode").addEventListener("change", (e) => {
      draftShader.blendMode = parseInt(e.target.value, 10) || 0;
      previewPipeline.setParams(draftShader);
      broadcastLiveShaderToDesktop();
    });

    document.getElementById("sh-palette").addEventListener("change", (e) => {
      draftShader.palette = parseInt(e.target.value, 10) || 0;
      previewPipeline.setParams(draftShader);
      broadcastLiveShaderToDesktop();
    });

    document.getElementById("sh-invert").addEventListener("change", (e) => {
      draftShader.invert = e.target.checked;
      previewPipeline.setParams(draftShader);
      broadcastLiveShaderToDesktop();
    });

    document.getElementById("sh-dotGrid").addEventListener("change", (e) => {
      draftShader.dotGrid = e.target.checked;
      previewPipeline.setParams(draftShader);
      broadcastLiveShaderToDesktop();
    });

    document.getElementById("sh-useCustomColors").addEventListener("change", (e) => {
      draftShader.useCustomColors = e.target.checked;
      previewPipeline.setParams(draftShader);
      broadcastLiveShaderToDesktop();
    });

    document.getElementById("sh-fgColor").addEventListener("input", (e) => {
      draftShader.fgColor = e.target.value;
      draftShader.useCustomColors = true;
      document.getElementById("sh-useCustomColors").checked = true;
      previewPipeline.setParams(draftShader);
      broadcastLiveShaderToDesktop();
    });

    document.getElementById("sh-bgColor").addEventListener("input", (e) => {
      draftShader.bgColor = e.target.value;
      previewPipeline.setParams(draftShader);
      broadcastLiveShaderToDesktop();
    });

    // Aspect pills
    document.querySelectorAll(".aspect-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        draftShader.fitMode = parseInt(btn.dataset.fit, 10) || 0;
        updateShaderUI();
        broadcastLiveShaderToDesktop();
      });
    });

    // Randomize Shader Button
    btnRandomize.addEventListener("click", () => {
      const styles = window.ShaderRegistry.STYLES.filter((s) => s.id !== "none");
      const pick = styles[Math.floor(Math.random() * styles.length)];
      draftShader.styleId = pick.id;
      draftShader.cellSize = Math.floor(8 + Math.random() * 18);
      draftShader.relief = Number((Math.random() * 0.95).toFixed(2));
      draftShader.param1 = Number(Math.random().toFixed(2));
      draftShader.intensity = Number((0.75 + Math.random() * 0.75).toFixed(2));
      draftShader.palette = Math.random() < 0.35 ? Math.floor(Math.random() * 6) : 0;
      populateShaderDropdown(shaderSearch.value);
      updateShaderUI();
      broadcastLiveShaderToDesktop();
    });

    btnResetShader.addEventListener("click", () => {
      draftShader = { ...window.ShaderRegistry.DEFAULT_PARAMS };
      populateShaderDropdown(shaderSearch.value);
      updateShaderUI();
      broadcastLiveShaderToDesktop();
    });

    function broadcastLiveShaderToDesktop() {
      invoke("update_shader_settings", { shader: draftShader }).catch(() => {});
    }

    // Native / Local File Selector for Video, Animated GIF & Image (Non-blocking async Tauri command)
    let isPickingFile = false;
    btnBrowseMedia.addEventListener("click", async () => {
      if (isPickingFile) return;
      isPickingFile = true;
      btnBrowseMedia.disabled = true;
      const origText = btnBrowseMedia.textContent;
      btnBrowseMedia.textContent = "Abriendo selector...";
      try {
        const pickedPath = await invoke("pick_media_file", {
          mediaType: draftSourceType,
        });
        if (pickedPath) {
          const lower = pickedPath.toLowerCase();
          if (lower.endsWith(".gif")) {
            switchSourceType("gif");
          } else if (lower.endsWith(".mp4") || lower.endsWith(".webm")) {
            switchSourceType("video");
          } else {
            switchSourceType("image");
          }
          loadMediaSource(pickedPath, buildMediaUrl(pickedPath));
        }
      } catch (e) {
        console.error("Error opening native file dialog:", e);
      } finally {
        isPickingFile = false;
        btnBrowseMedia.disabled = false;
        btnBrowseMedia.textContent = origText;
      }
    });

    mediaFileInput.addEventListener("change", () => {
      const file = mediaFileInput.files && mediaFileInput.files[0];
      if (!file) return;
      if (draftMediaBlobUrl) URL.revokeObjectURL(draftMediaBlobUrl);
      draftMediaBlobUrl = URL.createObjectURL(file);
      const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
      const isVid = file.type.startsWith("video/");
      switchSourceType(isGif ? "gif" : isVid ? "video" : "image");
      loadMediaSource(file.name, draftMediaBlobUrl);
    });

    function loadMediaSource(pathOrName, url) {
      draftMediaPath = pathOrName;
      const shortName = pathOrName.split(/[\\/]/).pop();
      mediaFileName.textContent = shortName;
      hudSourceLabel.textContent = `Fuente (${draftSourceType.toUpperCase()}): ${shortName}`;

      if (draftSourceType === "video") {
        previewGifPlayer.stop();
        previewVideo.src = url;
        previewVideo.play().catch(() => {});
      } else if (draftSourceType === "gif") {
        previewVideo.pause();
        previewGifPlayer.load(url);
      } else if (draftSourceType === "image") {
        previewVideo.pause();
        previewGifPlayer.stop();
        previewImage.src = url;
      }
      syncPreviewSourceVisibility();
    }

    // Live 60 FPS WebGL2 Preview Render Loop (automatically pauses when Studio window is hidden)
    let isPanelVisible = true;
    listen("panel-visibility", (e) => {
      isPanelVisible = !!e.payload;
      if (previewIframe && previewIframe.contentWindow) {
        previewIframe.contentWindow.postMessage(
          { type: "ASCII_DESK_PAUSE", paused: !isPanelVisible },
          "*"
        );
      }
      if (draftSourceType === "video") {
        if (isPanelVisible) previewVideo.play().catch(() => {});
        else previewVideo.pause();
      }
    });

    let frameCount = 0;
    let lastFpsTick = performance.now();
    function studioPreviewLoop(now) {
      requestAnimationFrame(studioPreviewLoop);
      if (!isPanelVisible || document.hidden) return;
      frameCount++;
      if (now - lastFpsTick >= 1000) {
        hudFps.textContent = `${frameCount} FPS`;
        frameCount = 0;
        lastFpsTick = now;
      }

      if (draftSourceType === "interactive") {
        if (draftShader.styleId === "none") return;
        try {
          const doc = previewIframe.contentDocument;
          if (doc) {
            const srcCanvas = doc.querySelector("canvas:not(#asciidesk-shader-overlay)");
            if (srcCanvas) {
              previewPipeline.setSource(srcCanvas);
              previewPipeline.render();
            }
          }
        } catch (e) {}
      } else if (draftSourceType === "video") {
        if (previewVideo.readyState >= 2) {
          previewPipeline.setSource(previewVideo);
          previewPipeline.render();
        }
      } else if (draftSourceType === "gif") {
        const gSrc = previewGifPlayer.getSource();
        if (gSrc) {
          previewPipeline.setSource(gSrc);
          previewPipeline.render();
        }
      } else if (draftSourceType === "image") {
        if (previewImage.complete && previewImage.naturalWidth > 0) {
          previewPipeline.setSource(previewImage);
          previewPipeline.render();
        }
      }
    }
    requestAnimationFrame(studioPreviewLoop);

    // Forward mouse coordinates on preview stage to shader & live SunTools coordinate bar
    const titlebarCoords = document.querySelector(".sun-titlebar-coords");
    previewStage.addEventListener("pointermove", (e) => {
      const r = previewStage.getBoundingClientRect();
      const nx = (e.clientX - r.left) / Math.max(1, r.width);
      const ny = (e.clientY - r.top) / Math.max(1, r.height);
      previewPipeline.mouse = [nx, ny];
      if (titlebarCoords) {
        const px = String(Math.max(0, Math.round(e.clientX - r.left))).padStart(4, "0");
        const py = String(Math.max(0, Math.round(e.clientY - r.top))).padStart(4, "0");
        titlebarCoords.textContent = `X:${px} Y:${py} // 1:1_UNIT`;
      }
    });

    // Apply as Desktop Wallpaper CTA
    btnApplyWallpaper.addEventListener("click", async () => {
      const origText = btnApplyWallpaper.textContent;
      btnApplyWallpaper.textContent = "✅ ¡Aplicado al Escritorio!";
      try {
        await invoke("apply_studio_wallpaper", {
          sourceType: draftSourceType,
          activeWallpaper: draftWallpaper,
          mediaPath: draftMediaPath,
          shader: draftShader,
        });
      } catch (err) {
        console.error("Failed to apply studio wallpaper:", err);
      }
      setTimeout(() => {
        btnApplyWallpaper.textContent = origText;
      }, 1400);
    });

    // Export PNG Snapshot
    btnExportPng.addEventListener("click", () => {
      let targetCanvas = previewCanvas;
      if (draftSourceType === "interactive" && draftShader.styleId === "none") {
        try {
          const c = previewIframe.contentDocument.querySelector("canvas");
          if (c) targetCanvas = c;
        } catch (e) {}
      } else {
        previewPipeline.render();
      }
      const dataUrl = targetCanvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `ascii-studio-${draftShader.styleId}-${Date.now()}.png`;
      a.click();
    });

    // Export 5s WebM Video Recording via MediaRecorder
    let isRecording = false;
    btnExportWebm.addEventListener("click", () => {
      if (isRecording) return;
      let targetCanvas = previewCanvas;
      if (draftSourceType === "interactive" && draftShader.styleId === "none") {
        try {
          const c = previewIframe.contentDocument.querySelector("canvas");
          if (c) targetCanvas = c;
        } catch (e) {}
      }
      if (!targetCanvas.captureStream) return;

      isRecording = true;
      const origLabel = btnExportWebm.textContent;
      btnExportWebm.textContent = "🔴 Grabando 5s...";

      const stream = targetCanvas.captureStream(60);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ascii-studio-${draftShader.styleId}-${Date.now()}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        btnExportWebm.textContent = origLabel;
        isRecording = false;
      };
      recorder.start();
      setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 5000);
    });

    function updateStatusUI(paused, autoPaused) {
      btnPause.textContent = paused ? "▶" : "⏸";
      btnPause.title = paused ? "Reanudar fondo" : "Pausar fondo";
      if (autoPaused) {
        statusBadge.textContent = "Ahorro Automático (App Maximizada)";
        statusBadge.classList.add("paused");
      } else if (paused) {
        statusBadge.textContent = "Fondo Pausado";
        statusBadge.classList.add("paused");
      } else {
        statusBadge.textContent = "Motor Activo · 60 FPS WebGL2";
        statusBadge.classList.remove("paused");
      }
    }

    function renderWallpaperControls(folder) {
      controlsContainer.innerHTML = "";
      const wp = wallpapersMap[folder];
      if (!wp) return;

      descEl.textContent = wp.manifest.description || "";
      const controls = wp.manifest.controls || [];
      const savedValues = (appState.settings && appState.settings[folder]) || {};

      for (const ctrl of controls) {
        const card = document.createElement("div");
        card.className = "control-card";
        const currentVal = savedValues[ctrl.id] !== undefined ? savedValues[ctrl.id] : ctrl.default;

        if (ctrl.type === "slider") {
          const row = document.createElement("div");
          row.className = "control-row";
          const label = document.createElement("span");
          label.className = "control-label";
          label.textContent = ctrl.label;
          const valSpan = document.createElement("span");
          valSpan.className = "control-value";
          valSpan.textContent = currentVal;
          row.appendChild(label);
          row.appendChild(valSpan);

          const input = document.createElement("input");
          input.type = "range";
          input.min = ctrl.min ?? 0;
          input.max = ctrl.max ?? 100;
          input.step = ctrl.step ?? 1;
          input.value = currentVal;
          input.addEventListener("input", () => {
            const num = parseFloat(input.value);
            valSpan.textContent = num;
            saveControlValue(folder, ctrl.id, num);
          });
          card.appendChild(row);
          card.appendChild(input);
        } else if (ctrl.type === "select") {
          const row = document.createElement("div");
          row.className = "control-row";
          const label = document.createElement("span");
          label.className = "control-label";
          label.textContent = ctrl.label;
          row.appendChild(label);

          const sel = document.createElement("select");
          sel.className = "ctrl-select";
          for (const opt of ctrl.options || []) {
            const o = document.createElement("option");
            o.value = opt.value;
            o.textContent = opt.label;
            if (String(opt.value) === String(currentVal)) o.selected = true;
            sel.appendChild(o);
          }
          sel.addEventListener("change", () => saveControlValue(folder, ctrl.id, sel.value));
          card.appendChild(row);
          card.appendChild(sel);
        } else if (ctrl.type === "color") {
          const row = document.createElement("div");
          row.className = "control-row";
          const label = document.createElement("span");
          label.className = "control-label";
          label.textContent = ctrl.label;
          const wrap = document.createElement("div");
          wrap.className = "color-picker-wrap";
          const valSpan = document.createElement("span");
          valSpan.className = "control-value";
          valSpan.textContent = currentVal;
          const input = document.createElement("input");
          input.type = "color";
          input.value = currentVal;
          input.addEventListener("input", () => {
            valSpan.textContent = input.value;
            saveControlValue(folder, ctrl.id, input.value);
          });
          wrap.appendChild(valSpan);
          wrap.appendChild(input);
          row.appendChild(label);
          row.appendChild(wrap);
          card.appendChild(row);
        } else if (ctrl.type === "toggle") {
          const row = document.createElement("label");
          row.className = "control-row switch-wrap";
          const label = document.createElement("span");
          label.className = "control-label";
          label.textContent = ctrl.label;
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = !!currentVal;
          const sw = document.createElement("span");
          sw.className = "switch";
          input.addEventListener("change", () => saveControlValue(folder, ctrl.id, input.checked));
          row.appendChild(label);
          row.appendChild(input);
          row.appendChild(sw);
          card.appendChild(row);
        }

        controlsContainer.appendChild(card);
      }
    }

    async function saveControlValue(folder, key, value) {
      if (!appState.settings[folder]) appState.settings[folder] = {};
      appState.settings[folder][key] = value;
      // Forward immediately to preview iframe
      if (previewIframe && previewIframe.contentWindow) {
        previewIframe.contentWindow.postMessage(
          { type: "ASCII_DESK_CONFIG", values: appState.settings[folder] },
          "*"
        );
      }
      try {
        await invoke("update_wallpaper_control", { folder, key, value });
      } catch (err) {}
    }

    previewIframe.addEventListener("load", () => {
      if (!appState) return;
      const vals = (appState.settings && appState.settings[draftWallpaper]) || {};
      if (previewIframe.contentWindow) {
        previewIframe.contentWindow.postMessage({ type: "ASCII_DESK_CONFIG", values: vals }, "*");
      }
    });

    async function refreshStudio() {
      try {
        const state = await invoke("get_app_state");
        appState = state;
        wallpapersMap = {};
        selectEl.innerHTML = "";

        for (const wp of state.wallpapers || []) {
          wallpapersMap[wp.folder] = wp;
          const opt = document.createElement("option");
          opt.value = wp.folder;
          opt.textContent = wp.manifest.name || wp.folder;
          if (wp.folder === state.active_wallpaper) opt.selected = true;
          selectEl.appendChild(opt);
        }

        draftWallpaper = state.active_wallpaper || "ascii-koi";
        draftSourceType = state.source_type || "interactive";
        draftMediaPath = state.media_path || "";
        if (state.shader) {
          draftShader = { ...window.ShaderRegistry.DEFAULT_PARAMS, ...state.shader };
        }

        toggleSpanMonitors.checked = state.span_monitors !== false;
        toggleHideIcons.checked = !!state.hide_desktop_icons;
        toggleAutostart.checked = !!state.autostart;

        populateShaderDropdown(shaderSearch.value);
        updateStatusUI(state.paused, state.auto_paused);
        renderWallpaperControls(draftWallpaper);
        updateShaderUI();
        switchSourceType(draftSourceType);
        if (draftMediaPath && draftSourceType !== "interactive") {
          loadMediaSource(draftMediaPath, buildMediaUrl(draftMediaPath));
        }
      } catch (err) {
        console.error("Failed to load studio state:", err);
      }
    }

    selectEl.addEventListener("change", async () => {
      draftWallpaper = selectEl.value;
      appState.active_wallpaper = draftWallpaper;
      renderWallpaperControls(draftWallpaper);
      switchSourceType("interactive");
      await invoke("set_active_wallpaper", { folder: draftWallpaper });
    });

    btnPause.addEventListener("click", async () => {
      const paused = await invoke("toggle_pause");
      appState.paused = paused;
      updateStatusUI(appState.paused, appState.auto_paused);
    });

    btnClose.addEventListener("click", async () => {
      await invoke("hide_panel");
    });

    btnReset.addEventListener("click", async () => {
      const folder = draftWallpaper;
      const wp = wallpapersMap[folder];
      if (!wp) return;
      const defaults = {};
      for (const c of wp.manifest.controls || []) {
        defaults[c.id] = c.default;
      }
      appState.settings[folder] = defaults;
      renderWallpaperControls(folder);
      if (previewIframe && previewIframe.contentWindow) {
        previewIframe.contentWindow.postMessage({ type: "ASCII_DESK_CONFIG", values: defaults }, "*");
      }
      await invoke("reset_wallpaper_controls", { folder });
    });

    toggleSpanMonitors.addEventListener("change", async () => {
      await invoke("set_span_monitors", { enabled: toggleSpanMonitors.checked });
    });

    toggleHideIcons.addEventListener("change", async () => {
      await invoke("set_hide_desktop_icons", { hidden: toggleHideIcons.checked });
    });

    toggleAutostart.addEventListener("change", async () => {
      await invoke("set_autostart", { enabled: toggleAutostart.checked });
    });

    listen("state-updated", () => refreshStudio());
    listen("wallpaper-pause", (e) => {
      if (!appState) return;
      const p = e.payload;
      if (p && typeof p === "object") {
        appState.paused = !!p.manual_paused;
        appState.auto_paused = !!p.auto_paused;
      }
      updateStatusUI(appState.paused, appState.auto_paused);
    });

    populateShaderDropdown("");
    refreshStudio();
  }
})();
