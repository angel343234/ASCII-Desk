# ASCII & Shader Wallpaper Studio (ASCII Desk)

Motor ligero de fondos de pantalla interactivos, modulares y de post-procesado WebGL2 en tiempo real para Windows, construido con **Tauri v2**, **Rust (`windows-sys`)** y **WebGL2**.

## Características principales

- **Integración nativa con Windows (Win32 API)**:
  - Anclaje directo detrás de los iconos del escritorio mediante el mensaje `0x052C` a `Progman` (`WorkerW`).
  - **Modo Multimonitor Continuo**: Extiende el lienzo a través de todas las pantallas (`SM_XVIRTUALSCREEN`..`SM_CYVIRTUALSCREEN`) para que las simulaciones (como los peces Koi) naden de un monitor a otro sin cortes.
  - **Ocultación de iconos del escritorio**: Interruptor instantáneo para ocultar/mostrar `SysListView32` (`SHELLDLL_DefView`).
  - **Interacción en vivo en el escritorio**: Detección ligera a 60 Hz de movimiento de cursor y clic izquierdo sobre cualquier escritorio vacío.
  - **Ahorro inteligente de recursos**: Pausa automática cuando hay una aplicación o juego maximizado / a pantalla completa.

- **Estudio Visual (1984 SunOS Workstation + Swiss Editorial Zine Minimalism)**:
  - Interfaz en modo papel claro (`#FFFFFF` / `#000000`) de alto contraste 1-bit con tramas *dithering* y barras de herramientas estilo *SunTools 1.1*.
  - **01 // SOURCE**: Soporta escenas interactivas modulares (`/wallpapers/ascii-koi`, `/wallpapers/matrix-rain`), **GIF animados (`.gif`)**, **Videos (`.mp4`, `.webm`)** e **Imágenes (`.png`, `.jpg`, `.webp`)** mediante el diálogo nativo Win32 `GetOpenFileNameW`.
  - **02 // STYLE_PROCESSOR**: Motor WebGL2 en tiempo real con **26 estilos procedurales** agrupados en 5 categorías (*Original*, *ASCII & Text*, *Dithering & Print*, *Blocks & Tactile*, *Optics & Glitch*).
  - **03 // OUTPUT**: Ajuste de aspecto (`FILL`, `FIT`, `16:9`, `1:1`), aplicación directa al escritorio y exportación a **PNG** o grabación de video **WebM (5s)**.

## Estructura del Proyecto

- `src/`: Interfaz del Estudio (`index.html`, `panel.css`, `main.js`), `bridge.js` y registro de 26 shaders WebGL2 (`src/shaders/registry.js`).
- `src-tauri/`: Backend en Rust (`src/main.rs`) e integración con Win32 (`src/win32_desktop.rs`).
- `wallpapers/`: Escenas interactivas modulares (`ascii-koi`, `matrix-rain`), cada una con su `manifest.json`.
