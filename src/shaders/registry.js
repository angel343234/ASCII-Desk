/**
 * ASCII & Shader Wallpaper Studio - Modular WebGL2 Shader Registry & Pipeline
 * Includes 26 real-time open-source-inspired procedural shaders across 5 categories
 * and a unified WebGL2 post-processing engine for Canvas, Video, and Image sources.
 */
(function (global) {
  "use strict";

  const VERTEX_SHADER = `#version 300 es
  precision highp float;
  in vec2 a_position;
  out vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    v_uv.y = 1.0 - v_uv.y;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }`;

  const MASTER_FRAGMENT_SHADER = `#version 300 es
  precision highp float;

  in vec2 v_uv;
  out vec4 outColor;

  uniform sampler2D u_tex;
  uniform sampler2D u_prevTex;
  uniform sampler2D u_glyphTex;
  uniform float u_glyphCount;

  uniform vec2 u_res;
  uniform vec2 u_sourceRes;
  uniform float u_time;
  uniform vec2 u_mouse;

  uniform int u_styleId;
  uniform float u_cellSize;
  uniform float u_opacity;
  uniform int u_blendMode;     // 0: Normal, 1: Screen, 2: Multiply, 3: Overlay, 4: Add
  uniform int u_invert;
  uniform int u_dotGrid;
  uniform float u_contrast;
  uniform float u_brightness;
  uniform float u_saturation;
  uniform float u_relief;
  uniform float u_bevel;
  uniform float u_lightAngle;
  uniform int u_palette;       // 0: Full, 1: GameBoy, 2: PICO-8, 3: CGA, 4: Amber, 5: Matrix
  uniform vec3 u_fgColor;
  uniform vec3 u_bgColor;
  uniform int u_useCustomColors;
  uniform float u_animSpeed;
  uniform float u_intensity;
  uniform float u_param1;
  uniform float u_param2;
  uniform int u_fitMode;       // 0: Fill/Cover, 1: Fit/Contain, 2: 16:9, 3: 1:1

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  vec2 computeAspectUV(vec2 uv) {
    vec2 targetRes = u_res;
    if (u_fitMode == 2) {
      targetRes = vec2(u_res.y * (16.0 / 9.0), u_res.y);
    } else if (u_fitMode == 3) {
      float m = min(u_res.x, u_res.y);
      targetRes = vec2(m, m);
    }

    float srcAspect = max(u_sourceRes.x, 1.0) / max(u_sourceRes.y, 1.0);
    float dstAspect = max(targetRes.x, 1.0) / max(targetRes.y, 1.0);
    vec2 s = vec2(1.0);

    if (u_fitMode == 0) {
      // Cover
      if (dstAspect > srcAspect) {
        s.y = srcAspect / dstAspect;
      } else {
        s.x = dstAspect / srcAspect;
      }
    } else {
      // Contain / Fit
      if (dstAspect > srcAspect) {
        s.x = dstAspect / srcAspect;
      } else {
        s.y = srcAspect / dstAspect;
      }
    }
    return (uv - 0.5) * s + 0.5;
  }

  vec3 adjustColor(vec3 col) {
    col = (col - 0.5) * u_contrast + 0.5 + u_brightness;
    float g = luma(col);
    col = mix(vec3(g), col, u_saturation);
    col = clamp(col, 0.0, 1.0);
    if (u_invert == 1) {
      col = 1.0 - col;
    }
    return col;
  }

  vec3 sampleSrc(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      return u_bgColor;
    }
    return adjustColor(texture(u_tex, uv).rgb);
  }

  vec3 applyPalette(vec3 c, int pal) {
    if (pal == 0) return c;
    float y = luma(c);
    if (pal == 1) {
      // GameBoy DMG
      if (y < 0.25) return vec3(0.059, 0.220, 0.059);
      if (y < 0.50) return vec3(0.188, 0.384, 0.188);
      if (y < 0.75) return vec3(0.545, 0.675, 0.059);
      return vec3(0.608, 0.737, 0.059);
    }
    if (pal == 2) {
      // PICO-8 8-tone subset
      vec3 p0 = vec3(0.0, 0.0, 0.0);
      vec3 p1 = vec3(0.114, 0.169, 0.325);
      vec3 p2 = vec3(0.494, 0.145, 0.325);
      vec3 p3 = vec3(0.0, 0.529, 0.318);
      vec3 p4 = vec3(0.671, 0.322, 0.212);
      vec3 p5 = vec3(1.0, 0.0, 0.302);
      vec3 p6 = vec3(1.0, 0.639, 0.0);
      vec3 p7 = vec3(1.0, 0.945, 0.910);
      vec3 best = p0;
      float bd = distance(c, p0);
      float d;
      d = distance(c, p1); if (d < bd) { bd = d; best = p1; }
      d = distance(c, p2); if (d < bd) { bd = d; best = p2; }
      d = distance(c, p3); if (d < bd) { bd = d; best = p3; }
      d = distance(c, p4); if (d < bd) { bd = d; best = p4; }
      d = distance(c, p5); if (d < bd) { bd = d; best = p5; }
      d = distance(c, p6); if (d < bd) { bd = d; best = p6; }
      d = distance(c, p7); if (d < bd) { bd = d; best = p7; }
      return best;
    }
    if (pal == 3) {
      // CGA 4-color Cyan/Magenta/White/Black
      vec3 c0 = vec3(0.0, 0.0, 0.0);
      vec3 c1 = vec3(0.333, 1.0, 1.0);
      vec3 c2 = vec3(1.0, 0.333, 1.0);
      vec3 c3 = vec3(1.0, 1.0, 1.0);
      if (y < 0.22) return c0;
      if (y > 0.80) return c3;
      return (c.r > c.b * 1.05) ? c2 : c1;
    }
    if (pal == 4) {
      // Amber CRT Terminal
      return mix(vec3(0.05, 0.02, 0.0), vec3(1.0, 0.72, 0.12), y);
    }
    if (pal == 5) {
      // Matrix Phosphor
      return mix(vec3(0.01, 0.04, 0.02), vec3(0.15, 1.0, 0.45), y);
    }
    return c;
  }

  float bayer4(vec2 p) {
    ivec2 ip = ivec2(mod(p, 4.0));
    int idx = ip.y * 4 + ip.x;
    int m[16] = int[16](
       0,  8,  2, 10,
      12,  4, 14,  6,
       3, 11,  1,  9,
      15,  7, 13,  5
    );
    return (float(m[idx]) + 0.5) / 16.0;
  }

  float bayer8(vec2 p) {
    vec2 p2 = floor(mod(p, 2.0));
    float b4 = bayer4(floor(p * 0.5));
    float b2 = (p2.y * 2.0 + p2.x) * 0.25;
    return (b4 * 4.0 + b2) * 0.25;
  }

  float sampleGlyphAtlas(float brightness, vec2 cellUV) {
    float count = max(u_glyphCount, 2.0);
    float idx = clamp(floor(brightness * count), 0.0, count - 1.0);
    vec2 atlasUV = vec2((idx + clamp(cellUV.x, 0.04, 0.96)) / count, clamp(cellUV.y, 0.04, 0.96));
    return texture(u_glyphTex, atlasUV).r;
  }

  vec3 computeBevelRelief(vec2 cellUV, float heightVal, vec3 baseCol) {
    if (u_relief <= 0.001) return baseCol;
    float ang = radians(u_lightAngle);
    vec2 lightDir = vec2(cos(ang), sin(ang));
    vec2 edge = (cellUV - 0.5) * 2.0;
    float edgeMask = smoothstep(1.0 - max(u_bevel, 0.05), 1.0, max(abs(edge.x), abs(edge.y)));
    float shade = dot(-edge, lightDir) * edgeMask * u_relief * (0.4 + 0.6 * heightVal);
    return clamp(baseCol + vec3(shade), 0.0, 1.0);
  }

  vec3 blendColors(vec3 base, vec3 styled, int mode, float alpha) {
    vec3 res = styled;
    if (mode == 1) {
      // Screen
      res = 1.0 - (1.0 - base) * (1.0 - styled);
    } else if (mode == 2) {
      // Multiply
      res = base * styled;
    } else if (mode == 3) {
      // Overlay
      res = mix(2.0 * base * styled, 1.0 - 2.0 * (1.0 - base) * (1.0 - styled), step(0.5, base));
    } else if (mode == 4) {
      // Add
      res = min(base + styled, vec3(1.0));
    }
    return mix(base, res, clamp(alpha, 0.0, 1.0));
  }

  void main() {
    vec2 uv = computeAspectUV(v_uv);
    vec2 fragPos = uv * u_res;
    float cell = max(u_cellSize, 2.0);
    vec2 cellIdx = floor(fragPos / cell);
    vec2 cellUV = fract(fragPos / cell);
    vec2 cellCenterUV = (cellIdx + 0.5) * cell / u_res;

    vec3 origColor = sampleSrc(uv);
    vec3 cellColor = sampleSrc(cellCenterUV);
    float cellLuma = luma(cellColor);
    float t = u_time * u_animSpeed;

    vec3 result = origColor;

    // 0: Original / Bypass
    if (u_styleId == 0) {
      result = origColor;
    }
    // 1: Standard ASCII, 2: Braille Unicode, 3: Matrix Katakana, 4: ANSI Blocks, 5: Minimalist Symbols
    else if (u_styleId >= 1 && u_styleId <= 5) {
      float lum = cellLuma;
      if (u_styleId == 3) {
        // Matrix Katakana digital rain modulation
        float colSpeed = 1.5 + hash12(vec2(cellIdx.x, 7.0)) * 2.5;
        float rain = fract(cellIdx.y * 0.045 - t * colSpeed * 0.35 + hash12(vec2(cellIdx.x, 19.0)));
        float trail = smoothstep(0.95, 0.0, rain);
        lum = clamp(lum * 0.65 + trail * 0.55 * u_intensity, 0.0, 1.0);
      }
      float g = sampleGlyphAtlas(lum, cellUV);
      vec3 fg = (u_useCustomColors == 1) ? u_fgColor : cellColor;
      if (u_styleId == 3 && u_useCustomColors == 0) {
        fg = mix(vec3(0.05, 0.85, 0.35), vec3(0.75, 1.0, 0.85), pow(lum, 2.0));
      }
      if (u_styleId == 4) {
        // ANSI Block shaded background + foreground glyph
        vec3 blockBg = cellColor * 0.35;
        result = mix(blockBg, fg, g);
      } else {
        result = mix(u_bgColor, fg, g);
      }
      result = computeBevelRelief(cellUV, lum, result);
    }
    // 6: Ordered Bayer Dithering (1-Bit)
    else if (u_styleId == 6) {
      vec2 dp = floor(fragPos / max(cell * 0.25, 1.0));
      float threshold = bayer8(dp);
      float bit = step(threshold, luma(cellColor) + (u_param1 - 0.5) * 0.4);
      vec3 fg = (u_useCustomColors == 1) ? u_fgColor : vec3(0.95);
      result = mix(u_bgColor, fg, bit);
    }
    // 7: Ordered Bayer Color Dither
    else if (u_styleId == 7) {
      vec2 dp = floor(fragPos / max(cell * 0.25, 1.0));
      float b = (bayer8(dp) - 0.5) * (0.35 * u_intensity);
      float levels = max(2.0, floor(u_param1 * 8.0 + 2.0));
      result = floor(clamp(cellColor + b, 0.0, 1.0) * levels) / (levels - 1.0);
    }
    // 8: Atkinson Dither Approximation
    else if (u_styleId == 8) {
      vec2 dp = floor(fragPos / max(cell * 0.3, 1.0));
      float l = luma(sampleSrc(dp * max(cell * 0.3, 1.0) / u_res));
      float lLeft = luma(sampleSrc((dp - vec2(1.0, 0.0)) * max(cell * 0.3, 1.0) / u_res));
      float lUp = luma(sampleSrc((dp - vec2(0.0, 1.0)) * max(cell * 0.3, 1.0) / u_res));
      float err = ((lLeft - step(0.5, lLeft)) + (lUp - step(0.5, lUp))) * 0.375;
      float b = bayer4(dp) * 0.35 - 0.175;
      float bit = step(0.5, l + err * u_intensity + b);
      vec3 fg = (u_useCustomColors == 1) ? u_fgColor : cellColor * 1.2;
      result = mix(u_bgColor, fg, bit);
    }
    // 9: Halftone Dots
    else if (u_styleId == 9) {
      float ang = radians(u_param1 * 90.0);
      mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      vec2 rPos = rot * fragPos;
      vec2 hCell = fract(rPos / cell) - 0.5;
      vec2 hCenter = (rot * ((floor(rPos / cell) + 0.5) * cell)) / u_res;
      vec3 col = sampleSrc(clamp(hCenter, 0.0, 1.0));
      float radius = sqrt(luma(col)) * 0.72 * u_intensity;
      float dotMask = 1.0 - smoothstep(radius - 0.06, radius + 0.06, length(hCell));
      vec3 fg = (u_useCustomColors == 1) ? u_fgColor : col;
      result = mix(u_bgColor, fg, dotMask);
    }
    // 10: CMYK Print Halftone
    else if (u_styleId == 10) {
      vec3 rgb = origColor;
      float k = min(1.0 - rgb.r, min(1.0 - rgb.g, 1.0 - rgb.b));
      vec3 cmy = (1.0 - rgb - k) / max(1.0 - k, 0.001);
      vec4 angles = vec4(0.261, 1.309, 0.0, 0.785);
      vec4 cmyk = vec4(cmy, k);
      vec4 dots;
      for (int i = 0; i < 4; i++) {
        float a = angles[i];
        mat2 rm = mat2(cos(a), -sin(a), sin(a), cos(a));
        vec2 st = fract((rm * fragPos) / cell) - 0.5;
        float rad = sqrt(clamp(cmyk[i], 0.0, 1.0)) * 0.68 * u_intensity;
        dots[i] = 1.0 - smoothstep(rad - 0.08, rad + 0.08, length(st));
      }
      vec3 paper = vec3(0.97, 0.95, 0.91);
      paper = mix(paper, paper * vec3(0.0, 0.75, 0.95), dots.x);
      paper = mix(paper, paper * vec3(0.92, 0.05, 0.55), dots.y);
      paper = mix(paper, paper * vec3(0.98, 0.92, 0.05), dots.z);
      paper = mix(paper, vec3(0.08), dots.w * 0.88);
      result = paper;
    }
    // 11: Crosshatch / Engraving
    else if (u_styleId == 11) {
      float lum = luma(origColor);
      float scale = max(cell * 0.65, 3.0);
      float h1 = abs(sin((fragPos.x + fragPos.y) * 3.14159 / scale));
      float h2 = abs(sin((fragPos.x - fragPos.y) * 3.14159 / scale));
      float h3 = abs(sin(fragPos.y * 3.14159 / (scale * 0.7)));
      float ink = 0.0;
      if (lum < 0.78 && h1 < 0.38) ink = 1.0;
      if (lum < 0.52 && h2 < 0.38) ink = 1.0;
      if (lum < 0.28 && h3 < 0.42) ink = 1.0;
      if (lum < 0.12) ink = 1.0;
      vec3 paper = (u_useCustomColors == 1) ? u_bgColor : vec3(0.95, 0.93, 0.88);
      vec3 pen = (u_useCustomColors == 1) ? u_fgColor : vec3(0.10, 0.11, 0.14);
      result = mix(paper, pen, ink);
    }
    // 12: CRT Scanlines & Phosphor Mask
    else if (u_styleId == 12) {
      vec2 cc = uv - 0.5;
      float dist = dot(cc, cc) * 0.12 * u_param1;
      vec2 crtUV = uv + cc * (1.0 + dist) * dist;
      vec3 col = sampleSrc(crtUV);
      float scan = 0.78 + 0.22 * sin(fragPos.y * 3.14159 / max(cell * 0.22, 1.5) + t * 2.0);
      int sub = int(mod(fragPos.x, 3.0));
      vec3 mask = (sub == 0) ? vec3(1.18, 0.88, 0.88) : (sub == 1) ? vec3(0.88, 1.18, 0.88) : vec3(0.88, 0.88, 1.18);
      float vig = 1.0 - dot(cc * 1.35, cc * 1.35);
      result = col * scan * mix(vec3(1.0), mask, 0.5 * u_intensity) * clamp(vig, 0.0, 1.0);
    }
    // 13: LEGO Stud Bricks (3D Tactile Relief)
    else if (u_styleId == 13) {
      vec2 p = cellUV - 0.5;
      float r = length(p);
      float studR = 0.31;
      float ang = radians(u_lightAngle);
      vec2 lDir = vec2(cos(ang), sin(ang));

      // Quantize brick colors slightly for authentic plastic look
      vec3 brickCol = floor(cellColor * 10.0 + 0.5) / 10.0;
      float tileEdge = max(abs(p.x), abs(p.y));
      float bevelMask = smoothstep(0.42, 0.5, tileEdge);
      float brickBevel = dot(-normalize(p + 1e-4), lDir) * bevelMask * 0.28 * max(u_relief, 0.6);

      // Circular stud top & cylindrical wall shadow
      float studTop = 1.0 - smoothstep(studR - 0.04, studR + 0.02, r);
      float studRim = smoothstep(studR - 0.07, studR, r) * (1.0 - smoothstep(studR, studR + 0.05, r));
      float studLight = dot(-p / max(studR, 0.01), lDir) * studTop * 0.22 * max(u_relief, 0.6);
      float rimHighlight = dot(-normalize(p + 1e-4), lDir) * studRim * 0.45 * max(u_relief, 0.6);

      // Cast drop shadow below-right of the stud
      float dropShadow = (1.0 - studTop) * (1.0 - smoothstep(studR * 0.85, studR * 1.35, length(p - lDir * 0.09)));

      vec3 col = brickCol + brickBevel + studLight + rimHighlight - dropShadow * 0.24 * max(u_relief, 0.6);
      if (tileEdge > 0.475) col *= 0.68; // Brick seam
      result = clamp(col, 0.0, 1.0);
    }
    // 14: Tactile Beveled Blocks
    else if (u_styleId == 14) {
      vec3 col = computeBevelRelief(cellUV, cellLuma, cellColor);
      float seam = step(0.47, max(abs(cellUV.x - 0.5), abs(cellUV.y - 0.5)));
      result = mix(col, col * 0.55, seam * 0.8);
    }
    // 15: Pixel Art Palette Quantizer
    else if (u_styleId == 15) {
      float b = (bayer4(cellIdx) - 0.5) * 0.08 * u_param1;
      vec3 qCol = floor(clamp(cellColor + b, 0.0, 1.0) * 6.0 + 0.5) / 6.0;
      int pal = (u_palette == 0) ? 2 : u_palette;
      result = applyPalette(qCol, pal);
    }
    // 16: Ceramic Tile Mosaic
    else if (u_styleId == 16) {
      vec2 jitter = (hash22(cellIdx) - 0.5) * 0.14 * u_param1;
      vec2 mUV = cellUV + jitter;
      float edge = max(abs(mUV.x - 0.5), abs(mUV.y - 0.5));
      float grout = smoothstep(0.42, 0.48, edge);
      vec3 tileCol = computeBevelRelief(mUV, 0.8, cellColor);
      result = mix(tileCol, vec3(0.12, 0.13, 0.15), grout);
    }
    // 17: Voronoi Stained Glass
    else if (u_styleId == 17) {
      vec2 g = floor(fragPos / cell);
      vec2 f = fract(fragPos / cell);
      float d1 = 8.0;
      float d2 = 8.0;
      vec2 bestCenter = cellCenterUV;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 nb = vec2(float(x), float(y));
          vec2 rnd = hash22(g + nb);
          rnd = 0.5 + 0.42 * sin(t * 0.4 + 6.2831 * rnd);
          vec2 diff = nb + rnd - f;
          float d = length(diff);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            bestCenter = ((g + nb + rnd) * cell) / u_res;
          } else if (d < d2) {
            d2 = d;
          }
        }
      }
      vec3 glassCol = sampleSrc(clamp(bestCenter, 0.0, 1.0));
      float leadBorder = 1.0 - smoothstep(0.03, 0.09, d2 - d1);
      float glassGlow = 1.12 - d1 * 0.35;
      result = mix(glassCol * glassGlow, vec3(0.06, 0.07, 0.09), leadBorder * u_intensity);
    }
    // 18: Cross-Stitch Embroidery
    else if (u_styleId == 18) {
      vec2 p = cellUV - 0.5;
      float d1 = abs(p.x - p.y);
      float d2 = abs(p.x + p.y);
      float limit = 0.42;
      float stitch1 = (1.0 - smoothstep(0.09, 0.16, d1)) * step(max(abs(p.x), abs(p.y)), limit);
      float stitch2 = (1.0 - smoothstep(0.09, 0.16, d2)) * step(max(abs(p.x), abs(p.y)), limit);
      float thread = max(stitch1, stitch2);
      float shade = (stitch2 > stitch1) ? 0.92 : 1.06;
      vec3 fabric = vec3(0.11, 0.12, 0.14);
      result = mix(fabric, cellColor * shade, thread);
    }
    // 19: Frosted Glass Refraction
    else if (u_styleId == 19) {
      vec2 n = hash22(floor(fragPos / max(cell * 0.18, 1.0)) + floor(t * 2.0)) - 0.5;
      float radius = (cell / min(u_res.x, u_res.y)) * 0.85 * u_intensity;
      vec3 acc = vec3(0.0);
      acc += sampleSrc(uv + n * radius);
      acc += sampleSrc(uv - n * radius);
      acc += sampleSrc(uv + vec2(n.y, -n.x) * radius);
      acc += sampleSrc(uv + vec2(-n.y, n.x) * radius);
      result = acc * 0.25;
    }
    // 20: Temporal Motion Blur & Echo Trails
    else if (u_styleId == 20) {
      vec3 prev = texture(u_prevTex, v_uv).rgb;
      vec2 dir = normalize(uv - 0.5 + 1e-4) * (cell / u_res) * 0.35 * u_intensity;
      vec3 streak = (origColor + sampleSrc(uv - dir) + sampleSrc(uv - dir * 2.0)) / 3.0;
      result = mix(streak, prev, clamp(0.68 * u_intensity, 0.0, 0.92));
    }
    // 21: RGB Shift / VHS Glitch
    else if (u_styleId == 21) {
      float band = floor(uv.y * (u_res.y / cell));
      float glitchLine = step(0.92 - 0.15 * u_param1, hash12(vec2(band, floor(t * 8.0))));
      float tear = (hash12(vec2(band, floor(t * 14.0))) - 0.5) * 0.045 * glitchLine * u_intensity;
      float shift = (cell / u_res.x) * 0.45 * u_intensity;
      float r = sampleSrc(vec2(uv.x + shift + tear, uv.y)).r;
      float g = sampleSrc(vec2(uv.x + tear, uv.y)).g;
      float b = sampleSrc(vec2(uv.x - shift + tear, uv.y)).b;
      float scan = 0.92 + 0.08 * sin(fragPos.y * 1.8 + t * 12.0);
      result = vec3(r, g, b) * scan;
    }
    // 22: Sobel Neon Edge Detection
    else if (u_styleId == 22) {
      vec2 texel = max(cell * 0.15, 1.0) / u_res;
      float tl = luma(sampleSrc(uv + vec2(-texel.x, -texel.y)));
      float tm = luma(sampleSrc(uv + vec2(0.0, -texel.y)));
      float tr = luma(sampleSrc(uv + vec2(texel.x, -texel.y)));
      float ml = luma(sampleSrc(uv + vec2(-texel.x, 0.0)));
      float mr = luma(sampleSrc(uv + vec2(texel.x, 0.0)));
      float bl = luma(sampleSrc(uv + vec2(-texel.x, texel.y)));
      float bm = luma(sampleSrc(uv + vec2(0.0, texel.y)));
      float br = luma(sampleSrc(uv + vec2(texel.x, texel.y)));
      float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
      float gy = -tl - 2.0 * tm - tr + bl + 2.0 * bm + br;
      float edge = clamp(length(vec2(gx, gy)) * 2.2 * u_intensity, 0.0, 1.0);
      vec3 neon = (u_useCustomColors == 1) ? u_fgColor : normalize(origColor + vec3(0.2, 0.6, 1.0)) * 1.4;
      result = mix(u_bgColor, neon, edge);
    }
    // 23: Topographic Contour Lines
    else if (u_styleId == 23) {
      float lum = luma(origColor);
      float bands = max(6.0, floor(cell * 1.2));
      float v = lum * bands + t * 0.4;
      float f = fract(v);
      float df = fwidth(v);
      float line = 1.0 - smoothstep(0.0, max(df * 1.6, 0.08), min(f, 1.0 - f));
      vec3 fg = (u_useCustomColors == 1) ? u_fgColor : mix(vec3(0.2, 0.85, 0.75), origColor * 1.35, 0.6);
      result = mix(u_bgColor + origColor * 0.18, fg, line * u_intensity);
    }
    // 24: Thermal Infrared Vision
    else if (u_styleId == 24) {
      float y = clamp(luma(origColor) * u_intensity, 0.0, 1.0);
      vec3 c0 = vec3(0.04, 0.02, 0.18);
      vec3 c1 = vec3(0.18, 0.05, 0.55);
      vec3 c2 = vec3(0.82, 0.12, 0.38);
      vec3 c3 = vec3(0.98, 0.58, 0.08);
      vec3 c4 = vec3(1.00, 0.98, 0.82);
      if (y < 0.25) result = mix(c0, c1, y * 4.0);
      else if (y < 0.50) result = mix(c1, c2, (y - 0.25) * 4.0);
      else if (y < 0.75) result = mix(c2, c3, (y - 0.50) * 4.0);
      else result = mix(c3, c4, (y - 0.75) * 4.0);
    }
    // 25: Mixed Hybrid (ASCII + Tactile Blocks)
    else if (u_styleId == 25) {
      float g = sampleGlyphAtlas(cellLuma, cellUV);
      float threshold = 0.48 + (u_param1 - 0.5) * 0.35;
      if (cellLuma > threshold) {
        vec3 fg = (u_useCustomColors == 1) ? u_fgColor : cellColor * 1.15;
        result = mix(cellColor * 0.22, fg, g);
      } else {
        result = computeBevelRelief(cellUV, cellLuma, cellColor * 0.85);
      }
    }

    if (u_palette > 0 && u_styleId != 15) {
      result = applyPalette(result, u_palette);
    }

    if (u_dotGrid == 1) {
      float dotD = length(cellUV - 0.5);
      float dotOverlay = 1.0 - smoothstep(0.08, 0.14, dotD);
      result = mix(result, result + vec3(0.14), dotOverlay * 0.35);
    }

    vec3 finalCol = blendColors(origColor, result, u_blendMode, u_opacity);
    outColor = vec4(finalCol, 1.0);
  }`;

  const SHADER_STYLES = [
    // 1. Original
    {
      id: "none",
      code: 0,
      name: "Original (Bypass)",
      category: "Original",
      description: "Muestra el fondo interactivo, video o imagen original sin post-procesado o con ajustes básicos de color.",
      defaults: { cellSize: 12, charset: "@#$08Xx+=-;:..", relief: 0.0 },
    },
    // 2. ASCII & Text
    {
      id: "ascii-standard",
      code: 1,
      name: "Standard ASCII",
      category: "ASCII & Text",
      description: "Mapeo clásico de luminancia a rampa de caracteres ASCII editables en tiempo real.",
      defaults: { cellSize: 12, charset: " .:-=+*xX80$#@", relief: 0.15 },
    },
    {
      id: "ascii-braille",
      code: 2,
      name: "High-Res Unicode Braille",
      category: "ASCII & Text",
      description: "Matriz densa de puntos Unicode Braille (⠁⠃⠇⠏⠟⠿⡿⣿) de alta definición.",
      defaults: { cellSize: 10, charset: " ⠁⠃⠇⠏⠟⠿⡿⣿", relief: 0.1 },
    },
    {
      id: "ascii-matrix",
      code: 3,
      name: "Matrix Katakana Rain",
      category: "ASCII & Text",
      description: "Glifos Katakana y hexadecimales con cascadas de luminancia animadas.",
      defaults: { cellSize: 14, charset: " 012345789Z:・.=*+-<>¦｜", relief: 0.0 },
    },
    {
      id: "ascii-ansi",
      code: 4,
      name: "ANSI Shaded Blocks",
      category: "ASCII & Text",
      description: "Arte ANSI clásico combinando bloques sombreados (░▒▓█) sobre celdas coloreadas.",
      defaults: { cellSize: 12, charset: " ░▒▓█", relief: 0.25 },
    },
    {
      id: "ascii-minimal",
      code: 5,
      name: "Minimalist Symbols",
      category: "ASCII & Text",
      description: "Estética geométrica limpia con símbolos tipográficos minimalistas.",
      defaults: { cellSize: 14, charset: " ·•+×#", relief: 0.1 },
    },
    // 3. Dithering & Print
    {
      id: "dither-bayer-1bit",
      code: 6,
      name: "Ordered Bayer 1-Bit",
      category: "Dithering & Print",
      description: "Tramado ordenado Bayer 8×8 monocromático de alto contraste estilo Macintosh clásico.",
      defaults: { cellSize: 8, param1: 0.5, param1Label: "Umbral de corte" },
    },
    {
      id: "dither-bayer-color",
      code: 7,
      name: "Ordered Bayer Color",
      category: "Dithering & Print",
      description: "Tramado Bayer 8×8 multicolor con cuantización de niveles estilo retro PC.",
      defaults: { cellSize: 8, param1: 0.35, param1Label: "Niveles de color" },
    },
    {
      id: "dither-atkinson",
      code: 8,
      name: "Atkinson Dither",
      category: "Dithering & Print",
      description: "Tramado con propagación de error local inspirado en Bill Atkinson (HyperCard).",
      defaults: { cellSize: 8, intensity: 1.0 },
    },
    {
      id: "print-halftone",
      code: 9,
      name: "Halftone Dots",
      category: "Dithering & Print",
      description: "Trama rotada de semitonos circulares estilo cómic e imprenta.",
      defaults: { cellSize: 12, param1: 0.35, param1Label: "Ángulo de trama" },
    },
    {
      id: "print-cmyk",
      code: 10,
      name: "CMYK Offset Print",
      category: "Dithering & Print",
      description: "Separación cuatricromática Cian, Magenta, Amarillo y Negro con ángulos de roseta reales.",
      defaults: { cellSize: 11, intensity: 1.0 },
    },
    {
      id: "print-crosshatch",
      code: 11,
      name: "Crosshatch Engraving",
      category: "Dithering & Print",
      description: "Grabado calcográfico de líneas cruzadas según niveles de sombra.",
      defaults: { cellSize: 10, intensity: 1.0 },
    },
    {
      id: "print-crt",
      code: 12,
      name: "CRT Scanlines & Mask",
      category: "Dithering & Print",
      description: "Monitor CRT Trinitron con máscara de subpíxeles RGB, líneas de escaneo y curvatura.",
      defaults: { cellSize: 10, param1: 0.35, param1Label: "Curvatura CRT" },
    },
    // 4. Blocks & Tactile
    {
      id: "block-lego",
      code: 13,
      name: "LEGO Stud Bricks 3D",
      category: "Blocks & Tactile",
      description: "Mosaico de bloques LEGO con relieve circular 3D, iluminación especular y sombras proyectadas.",
      defaults: { cellSize: 18, relief: 0.85, bevel: 0.25 },
    },
    {
      id: "block-bevel",
      code: 14,
      name: "Tactile Beveled Blocks",
      category: "Blocks & Tactile",
      description: "Paneles modulares con biselado 3D direccional e iluminación dinámica.",
      defaults: { cellSize: 16, relief: 0.75, bevel: 0.3 },
    },
    {
      id: "block-pixelart",
      code: 15,
      name: "Pixel Art + Palettes",
      category: "Blocks & Tactile",
      description: "Pixelado limpio con cuantización y paletas seleccionables (GameBoy, PICO-8, CGA, Full).",
      defaults: { cellSize: 10, palette: 2, param1: 0.3, param1Label: "Suavizado Bayer" },
    },
    {
      id: "block-mosaic",
      code: 16,
      name: "Ceramic Tile Mosaic",
      category: "Blocks & Tactile",
      description: "Mosaico cerámico con junta oscura y ligera variación orgánica por tesela.",
      defaults: { cellSize: 15, relief: 0.5, param1: 0.4, param1Label: "Irregularidad" },
    },
    {
      id: "block-voronoi",
      code: 17,
      name: "Voronoi Stained Glass",
      category: "Blocks & Tactile",
      description: "Vitral celular Voronoi animado con emplomado perimetral.",
      defaults: { cellSize: 24, intensity: 1.0 },
    },
    {
      id: "block-crossstitch",
      code: 18,
      name: "Cross-Stitch Embroidery",
      category: "Blocks & Tactile",
      description: "Tejido bordado en punto de cruz con textura de hilo entrelazado.",
      defaults: { cellSize: 14, relief: 0.4 },
    },
    // 5. Optics & Glitch
    {
      id: "optics-frosted",
      code: 19,
      name: "Frosted Glass Refraction",
      category: "Optics & Glitch",
      description: "Cristal esmerilado con dispersión refractiva celular.",
      defaults: { cellSize: 14, intensity: 1.0 },
    },
    {
      id: "optics-motionblur",
      code: 20,
      name: "Motion Blur & Echo",
      category: "Optics & Glitch",
      description: "Persistencia temporal de fotogramas y estelas de movimiento suaves.",
      defaults: { cellSize: 10, intensity: 0.85 },
    },
    {
      id: "optics-vhs",
      code: 21,
      name: "RGB Shift / VHS Glitch",
      category: "Optics & Glitch",
      description: "Aberración cromática RGB y saltos horizontales de cinta magnética.",
      defaults: { cellSize: 12, intensity: 1.0, param1: 0.5, param1Label: "Frecuencia Glitch" },
    },
    {
      id: "optics-sobel",
      code: 22,
      name: "Edge Detection (Sobel Neon)",
      category: "Optics & Glitch",
      description: "Detector de contornos Sobel iluminado con trazos de neón.",
      defaults: { cellSize: 10, intensity: 1.2 },
    },
    {
      id: "optics-topo",
      code: 23,
      name: "Topographic Contour Lines",
      category: "Optics & Glitch",
      description: "Isolíneas de elevación topográfica calculadas sobre el campo de luminancia.",
      defaults: { cellSize: 14, intensity: 1.0 },
    },
    {
      id: "optics-thermal",
      code: 24,
      name: "Thermal Infrared Vision",
      category: "Optics & Glitch",
      description: "Cámara termográfica infrarroja de espectro completo.",
      defaults: { cellSize: 10, intensity: 1.0 },
    },
    {
      id: "optics-hybrid",
      code: 25,
      name: "Mixed Hybrid (ASCII + Blocks)",
      category: "Optics & Glitch",
      description: "Fusión dinámica de bloques biselados en sombras y caracteres ASCII en altas luces.",
      defaults: { cellSize: 14, charset: " .:+*#@", relief: 0.65, param1: 0.5, param1Label: "Balance Híbrido" },
    },
  ];

  const DEFAULT_SHADER_PARAMS = {
    styleId: "none",
    cellSize: 12,
    charset: " .:-=+*xX80$#@",
    opacity: 1.0,
    blendMode: 0,
    invert: false,
    dotGrid: false,
    contrast: 1.0,
    brightness: 0.0,
    saturation: 1.0,
    relief: 0.25,
    bevel: 0.25,
    lightAngle: 135,
    palette: 0,
    fgColor: "#38bdf8",
    bgColor: "#070b10",
    useCustomColors: false,
    animSpeed: 1.0,
    intensity: 1.0,
    param1: 0.5,
    param2: 0.5,
    fitMode: 0,
  };

  function hexToRgbNorm(hex) {
    const clean = String(hex || "#ffffff").replace("#", "").trim();
    const num = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16) || 0;
    return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
  }

  class ShaderPipeline {
    constructor(outputCanvas) {
      this.canvas = outputCanvas;
      this.gl = outputCanvas.getContext("webgl2", {
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
      this.params = { ...DEFAULT_SHADER_PARAMS };
      this.sourceEl = null;
      this.lastCharset = "";
      this.glyphCount = 10;
      this.startTime = performance.now();
      this.mouse = [0.5, 0.5];

      if (this.gl) {
        this._initGL();
      }
    }

    _compile(type, src) {
      const gl = this.gl;
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("[ShaderPipeline] Compile error:", gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    _initGL() {
      const gl = this.gl;
      const vs = this._compile(gl.VERTEX_SHADER, VERTEX_SHADER);
      const fs = this._compile(gl.FRAGMENT_SHADER, MASTER_FRAGMENT_SHADER);
      if (!vs || !fs) return;

      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error("[ShaderPipeline] Link error:", gl.getProgramInfoLog(prog));
        return;
      }
      this.program = prog;
      gl.useProgram(prog);

      // Fullscreen quad
      const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
      const posLoc = gl.getAttribLocation(prog, "a_position");
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      this.vao = vao;

      // Source texture
      this.sourceTex = this._createTex(gl.LINEAR);
      // Previous frame texture (for motion blur)
      this.prevTex = this._createTex(gl.LINEAR);
      // Glyph atlas texture
      this.glyphTex = this._createTex(gl.LINEAR);

      // Cache uniform locations
      const names = [
        "u_tex", "u_prevTex", "u_glyphTex", "u_glyphCount",
        "u_res", "u_sourceRes", "u_time", "u_mouse",
        "u_styleId", "u_cellSize", "u_opacity", "u_blendMode",
        "u_invert", "u_dotGrid", "u_contrast", "u_brightness",
        "u_saturation", "u_relief", "u_bevel", "u_lightAngle",
        "u_palette", "u_fgColor", "u_bgColor", "u_useCustomColors",
        "u_animSpeed", "u_intensity", "u_param1", "u_param2", "u_fitMode"
      ];
      this.u = {};
      for (const n of names) {
        this.u[n] = gl.getUniformLocation(prog, n);
      }

      this._updateGlyphAtlas(this.params.charset);
    }

    _createTex(filter) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      return tex;
    }

    _updateGlyphAtlas(charsetStr) {
      const gl = this.gl;
      if (!gl) return;
      const chars = Array.from(charsetStr && charsetStr.length >= 2 ? charsetStr : " .:-=+*#%@");
      this.lastCharset = charsetStr;
      this.glyphCount = chars.length;

      const cellW = 48;
      const cellH = 48;
      const atlas = document.createElement("canvas");
      atlas.width = cellW * chars.length;
      atlas.height = cellH;
      const ctx = atlas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, atlas.width, atlas.height);
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.floor(cellH * 0.78)}px "Cascadia Mono", Consolas, "Segoe UI Symbol", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let i = 0; i < chars.length; i++) {
        ctx.fillText(chars[i], i * cellW + cellW / 2, cellH / 2 + 1);
      }

      gl.bindTexture(gl.TEXTURE_2D, this.glyphTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    }

    setParams(newParams) {
      if (!newParams) return;
      Object.assign(this.params, newParams);
      if (this.params.charset && this.params.charset !== this.lastCharset) {
        this._updateGlyphAtlas(this.params.charset);
      }
    }

    setSource(el) {
      this.sourceEl = el;
    }

    render() {
      const gl = this.gl;
      if (!gl || !this.program || !this.sourceEl) return;

      const w = this.canvas.width;
      const h = this.canvas.height;
      if (w <= 0 || h <= 0) return;

      let srcW = w;
      let srcH = h;
      const src = this.sourceEl;
      if (src.videoWidth) {
        srcW = src.videoWidth;
        srcH = src.videoHeight;
      } else if (src.naturalWidth) {
        srcW = src.naturalWidth;
        srcH = src.naturalHeight;
      } else if (src.width) {
        srcW = src.width;
        srcH = src.height;
      }
      if (srcW <= 0 || srcH <= 0) return;

      gl.viewport(0, 0, w, h);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);

      // Upload current source frame
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      } catch (e) {
        return;
      }

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.prevTex);

      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.glyphTex);

      const styleObj = SHADER_STYLES.find((s) => s.id === this.params.styleId) || SHADER_STYLES[0];
      const fg = hexToRgbNorm(this.params.fgColor);
      const bg = hexToRgbNorm(this.params.bgColor);
      const nowSec = (performance.now() - this.startTime) / 1000;

      gl.uniform1i(this.u.u_tex, 0);
      gl.uniform1i(this.u.u_prevTex, 1);
      gl.uniform1i(this.u.u_glyphTex, 2);
      gl.uniform1f(this.u.u_glyphCount, this.glyphCount);

      gl.uniform2f(this.u.u_res, w, h);
      gl.uniform2f(this.u.u_sourceRes, srcW, srcH);
      gl.uniform1f(this.u.u_time, nowSec);
      gl.uniform2f(this.u.u_mouse, this.mouse[0], this.mouse[1]);

      gl.uniform1i(this.u.u_styleId, styleObj.code);
      gl.uniform1f(this.u.u_cellSize, Number(this.params.cellSize) || 12);
      gl.uniform1f(this.u.u_opacity, this.params.opacity !== undefined ? Number(this.params.opacity) : 1.0);
      gl.uniform1i(this.u.u_blendMode, Number(this.params.blendMode) || 0);
      gl.uniform1i(this.u.u_invert, this.params.invert ? 1 : 0);
      gl.uniform1i(this.u.u_dotGrid, this.params.dotGrid ? 1 : 0);
      gl.uniform1f(this.u.u_contrast, this.params.contrast !== undefined ? Number(this.params.contrast) : 1.0);
      gl.uniform1f(this.u.u_brightness, Number(this.params.brightness) || 0.0);
      gl.uniform1f(this.u.u_saturation, this.params.saturation !== undefined ? Number(this.params.saturation) : 1.0);
      gl.uniform1f(this.u.u_relief, Number(this.params.relief) || 0.0);
      gl.uniform1f(this.u.u_bevel, Number(this.params.bevel) || 0.25);
      gl.uniform1f(this.u.u_lightAngle, Number(this.params.lightAngle) || 135.0);
      gl.uniform1i(this.u.u_palette, Number(this.params.palette) || 0);
      gl.uniform3f(this.u.u_fgColor, fg[0], fg[1], fg[2]);
      gl.uniform3f(this.u.u_bgColor, bg[0], bg[1], bg[2]);
      gl.uniform1i(this.u.u_useCustomColors, this.params.useCustomColors ? 1 : 0);
      gl.uniform1f(this.u.u_animSpeed, this.params.animSpeed !== undefined ? Number(this.params.animSpeed) : 1.0);
      gl.uniform1f(this.u.u_intensity, this.params.intensity !== undefined ? Number(this.params.intensity) : 1.0);
      gl.uniform1f(this.u.u_param1, this.params.param1 !== undefined ? Number(this.params.param1) : 0.5);
      gl.uniform1f(this.u.u_param2, this.params.param2 !== undefined ? Number(this.params.param2) : 0.5);
      gl.uniform1i(this.u.u_fitMode, Number(this.params.fitMode) || 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Copy rendered frame into prevTex if Motion Blur is active
      if (styleObj.code === 20) {
        gl.bindTexture(gl.TEXTURE_2D, this.prevTex);
        gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, w, h, 0);
      }
    }
  }

  global.ShaderRegistry = {
    STYLES: SHADER_STYLES,
    DEFAULT_PARAMS: DEFAULT_SHADER_PARAMS,
    ShaderPipeline,
    getCategories() {
      const map = {};
      for (const s of SHADER_STYLES) {
        if (!map[s.category]) map[s.category] = [];
        map[s.category].push(s);
      }
      return map;
    },
    getStyleById(id) {
      return SHADER_STYLES.find((s) => s.id === id) || SHADER_STYLES[0];
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
