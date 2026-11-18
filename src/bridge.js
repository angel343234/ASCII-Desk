/**
 * ASCII & Shader Wallpaper Studio - Bridge Script
 * Loaded by every wallpaper in /wallpapers/<name>/index.html and by the Wallpaper Host.
 * Connects the Studio Control Window & Backend to live wallpaper parameters, desktop mouse events,
 * and the real-time WebGL2 post-processing shader pipeline.
 */
(function () {
  "use strict";

  const handlers = [];
  const state = {};
  let systemPaused = false;
  let shaderOverlayCanvas = null;
  let shaderPipeline = null;
  let shaderActive = false;
  let shaderRafId = 0;

  function isWallpaperSceneFrame() {
    // Only create a fullscreen shader overlay inside an actual /wallpapers/<name>/index.html scene
    // and ONLY when hosted inside the Desktop Wallpaper window (not inside the Studio Panel or its preview iframe)
    if (!window.location.pathname.includes("/wallpapers/")) {
      return false;
    }
    try {
      if (window.parent && window.parent !== window) {
        if (window.parent.location.search.includes("role=panel")) {
          return false;
        }
      }
    } catch (e) {}
    return true;
  }

  function ensureShaderOverlay() {
    if (!isWallpaperSceneFrame()) return;
    if (shaderOverlayCanvas || !window.ShaderRegistry) return;
    shaderOverlayCanvas = document.createElement("canvas");
    shaderOverlayCanvas.id = "asciidesk-shader-overlay";
    shaderOverlayCanvas.style.cssText =
      "position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;pointer-events:none;display:none;";
    document.body.appendChild(shaderOverlayCanvas);
    shaderPipeline = new window.ShaderRegistry.ShaderPipeline(shaderOverlayCanvas);

    const resize = () => {
      if (!shaderOverlayCanvas) return;
      shaderOverlayCanvas.width = window.innerWidth;
      shaderOverlayCanvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);
    resize();
  }

  function findPrimarySourceCanvas() {
    const canvases = document.querySelectorAll(
      "canvas:not(#asciidesk-shader-overlay):not(#preview-gl-canvas):not(#wallpaper-gl-canvas)"
    );
    let best = null;
    let bestArea = 0;
    for (const c of canvases) {
      const area = (c.width || c.clientWidth) * (c.height || c.clientHeight);
      if (area > bestArea) {
        bestArea = area;
        best = c;
      }
    }
    return best;
  }

  function startShaderOverlayLoop() {
    if (shaderRafId) return;
    const loop = () => {
      if (!shaderActive) {
        shaderRafId = 0;
        return;
      }
      shaderRafId = requestAnimationFrame(loop);
      if (systemPaused || !shaderPipeline) return;
      const src = findPrimarySourceCanvas();
      if (src) {
        shaderPipeline.setSource(src);
        shaderPipeline.render();
      }
    };
    shaderRafId = requestAnimationFrame(loop);
  }

  const AsciiDesk = {
    state,
    get isSystemPaused() {
      return systemPaused;
    },
    onConfig(fn) {
      if (typeof fn === "function") {
        handlers.push(fn);
        if (Object.keys(state).length > 0) {
          try {
            fn({ ...state });
          } catch (err) {
            console.error("[AsciiDesk Bridge] Error in config handler:", err);
          }
        }
      }
    },
    applyConfig(newValues) {
      if (!newValues || typeof newValues !== "object") return;
      Object.assign(state, newValues);
      for (const fn of handlers) {
        try {
          fn({ ...state }, newValues);
        } catch (err) {
          console.error("[AsciiDesk Bridge] Error in config handler:", err);
        }
      }
    },
    applyShaderParams(shaderParams) {
      if (!shaderParams || !window.ShaderRegistry) return;
      ensureShaderOverlay();
      if (!shaderPipeline || !shaderOverlayCanvas) return;

      shaderPipeline.setParams(shaderParams);
      const needsPost =
        shaderParams.styleId &&
        shaderParams.styleId !== "none" &&
        Number(shaderParams.opacity ?? 1) > 0.01;

      shaderActive = !!needsPost;
      shaderOverlayCanvas.style.display = shaderActive ? "block" : "none";
      if (shaderActive) {
        startShaderOverlayLoop();
      }
    },
    setSystemPaused(paused) {
      systemPaused = !!paused;
      window.dispatchEvent(
        new CustomEvent("asciidesk:pause", { detail: { paused: systemPaused } })
      );
      for (const fn of handlers) {
        try {
          fn({ ...state, __systemPaused: systemPaused }, { __systemPaused: systemPaused });
        } catch (err) {
          console.error("[AsciiDesk Bridge] Error in pause handler:", err);
        }
      }
    },
    dispatchMouse(type, rawX, rawY, vw, vh) {
      // Never synthesize desktop mouse clicks/moves inside the Studio Panel window or its preview iframe!
      if (!isWallpaperSceneFrame()) return;

      const scaleX = vw > 0 ? window.innerWidth / vw : 1;
      const scaleY = vh > 0 ? window.innerHeight / vh : 1;
      const x = rawX * scaleX;
      const y = rawY * scaleY;

      if (shaderPipeline) {
        shaderPipeline.mouse = [
          Math.max(0, Math.min(1, x / Math.max(1, window.innerWidth))),
          Math.max(0, Math.min(1, y / Math.max(1, window.innerHeight))),
        ];
      }

      const target =
        document.elementFromPoint(x, y) || document.body || document.documentElement;
      if (!target) return;

      if (type === "move") {
        target.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            screenX: rawX,
            screenY: rawY,
            pointerType: "mouse",
          })
        );
        target.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            screenX: rawX,
            screenY: rawY,
          })
        );
      } else if (type === "left_down") {
        target.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: 1,
            pointerType: "mouse",
          })
        );
        target.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: 1,
          })
        );
      } else if (type === "left_up") {
        target.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: 0,
            pointerType: "mouse",
          })
        );
        target.dispatchEvent(
          new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: 0,
          })
        );
        target.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
          })
        );
      }
    },
  };

  window.AsciiDesk = AsciiDesk;

  // Listen for standard window.postMessage
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "ASCII_DESK_CONFIG" && data.values) {
      AsciiDesk.applyConfig(data.values);
    } else if (data.type === "ASCII_DESK_SHADER" && data.shader) {
      AsciiDesk.applyShaderParams(data.shader);
    } else if (data.type === "ASCII_DESK_PAUSE") {
      AsciiDesk.setSystemPaused(data.paused);
    } else if (data.type === "ASCII_DESK_MOUSE") {
      AsciiDesk.dispatchMouse(data.action, data.x, data.y, data.vw, data.vh);
    }
  });

  function setupTauriListeners() {
    if (!isWallpaperSceneFrame()) return;
    const tauriEvent = window.__TAURI__ && window.__TAURI__.event;
    const tauriCore = window.__TAURI__ && window.__TAURI__.core;
    if (tauriEvent && typeof tauriEvent.listen === "function") {
      tauriEvent.listen("wallpaper-config", (event) => {
        if (event && event.payload) {
          AsciiDesk.applyConfig(event.payload.values || event.payload);
        }
      });
      tauriEvent.listen("wallpaper-shader", (event) => {
        if (event && event.payload) {
          AsciiDesk.applyShaderParams(event.payload);
        }
      });
      tauriEvent.listen("wallpaper-pause", (event) => {
        if (event && typeof event.payload === "boolean") {
          AsciiDesk.setSystemPaused(event.payload);
        } else if (event && event.payload && typeof event.payload.paused === "boolean") {
          AsciiDesk.setSystemPaused(event.payload.paused);
        }
      });
      tauriEvent.listen("desktop-mouse", (event) => {
        if (event && event.payload) {
          const { action, x, y, vw, vh } = event.payload;
          AsciiDesk.dispatchMouse(action, x, y, vw, vh);
        }
      });
    }
    if (tauriCore && typeof tauriCore.invoke === "function") {
      tauriCore
        .invoke("get_current_wallpaper_settings")
        .then((res) => {
          if (res && res.values) {
            AsciiDesk.applyConfig(res.values);
          }
          if (res && res.shader) {
            AsciiDesk.applyShaderParams(res.shader);
          }
          if (res && typeof res.paused === "boolean") {
            AsciiDesk.setSystemPaused(res.paused);
          }
        })
        .catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupTauriListeners);
  } else {
    setupTauriListeners();
  }
})();
