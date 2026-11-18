# ASCII Desk

```text
   ___   _____ ______________   ____            __  
  /   | / ___// ____/  _/  _/  / __ \___  _____/ /__
 / /| | \__ \/ /    / / / /   / / / / _ \/ ___/ //_/
/ ___ |___/ / /____/ /_/ /   / /_/ /  __(__  ) ,<   
/_/  |_/____/\____/___/___/  /_____/\___/____/_/|_|  
                                                     
+-----------------------------------------------------------------------+
|  WIN32 WORKERW ENGINE // WEBGL2 SHADER PIPELINE // 60 FPS LIVE DESK   |
+-----------------------------------------------------------------------+
                                                  `T",.`-,

                                                     '8, :.

                                              `""`oooob."T,.

                                            ,-`".)O;8:doob.'-.

                                     ,..`'.'' -dP()d8O8Yo8:,..`,

                                   -o8b-     ,..)doOO8:':o; `Y8.`,

                                  ,..bo.,.....)OOO888o' :oO.  ".  `-.

                                , "`"d....88OOOOO8O88o  :O8o;.    ;;,b

                               ,dOOOOO""""""""O88888o:  :O88Oo.;:o888d

                               ""888Ob...,-- :o88O88o:. :o'"""""""Y8OP

                               d8888.....,.. :o8OO888:: ::

                              "" .dOO8bo`'',,;O88O:O8o: ::,

                                 ,dd8".  ,-)do8O8o:"""; :::

                                 ,db(.  T)8P:8o:::::    :::

                                 -"",`(;O"KdOo::        :::

                                   ,K,'".doo:::'        :o:

                                    .doo:::"""::  :.    'o:

        ,..            .;ooooooo..o:"""""     ::;. ::;.  'o.

   ,, "'    ` ..   .d;o:"""'                  ::o:;::o::  :;

   d,         , ..ooo::;                      ::oo:;::o"'.:o

  ,d'.       :OOOOO8Oo::" '.. .               ::o8Ooo:;  ;o:

  'P"   ;  ;.OPd8888O8::;. 'oOoo:.;..         ;:O88Ooo:' O"'

  ,8:   o::oO` 88888OOo:::  o8O8Oo:::;;     ,;:oO88OOo;  '

 ,YP  ,::;:O:  888888o::::  :8888Ooo::::::::::oo888888o;. ,

 ',d: :;;O;:   :888888::o;  :8888888Ooooooooooo88888888Oo; ,

 dPY:  :o8O     YO8888O:O:;  O8888888888OOOO888"" Y8o:O88o; ,

,' O:  'ob`      "8888888Oo;;o8888888888888'"'     `8OO:.`OOb .

'  Y:  ,:o:       `8O88888OOoo"""""""""""'           `OOob`Y8b`

   ::  ';o:        `8O88o:oOoP                        `8Oo `YO.

   `:   Oo:         `888O::oP                          88O  :OY

    :o; 8oP         :888o::P                           do:  8O:

   ,ooO:8O'       ,d8888o:O'                          dOo   ;:.

   ;O8odo'        88888O:o'                          do::  oo.:

  d"`)8O'         "YO88Oo'                          "8O:   o8b'

 ''-'`"            d:O8oK  -hrr-                   dOOo'  :o":

                   O:8o:b.                        :88o:   `8:,

                   `8O:;7b,.                       `"8'     Y:

                    `YO;`8b'

                     `Oo; 8:.

                      `OP"8.`

                       :  Y8P

                       `o  `,

                        Y8bod.

                        `""""'
------------------------------------------------
Thank you for visiting https://asciiart.website/
This ASCII pic can be found at
https://asciiart.website/art/458

## Descripcion

**ASCII Desk** es un motor ligero de fondos de pantalla interactivos, modulares y de post-procesado WebGL2 en tiempo real para Windows, construido con **Tauri v2**, **Rust (`windows-sys`)** y **WebGL2**.

Ancla cualquier escena HTML5/Canvas, video (`.mp4`, `.webm`), animacion (`.gif`) o imagen (`.png`, `.jpg`, `.webp`) directamente detras de los iconos del escritorio de Windows (`WorkerW`) y permite aplicar **26 shaders procedurales** en vivo (ASCII, Braille, Dithering Bayer, Atkinson, LEGO 3D, CRT, Halftone, Voronoi y mas) desde una interfaz inspirada en estaciones de trabajo SunOS de 1984 y diseno editorial suizo en blanco y negro (1-bit).

---

## Arquitectura del Sistema

```text
+-----------------------------------------------------------------------+
|                        WINDOWS DESKTOP (Progman)                      |
|  +-- SendMessageTimeoutW(0x052C) --> [WorkerW Background Layer]       |
|       +-- ASCII Desk Host Window (Borderless, Multimonitor Span)      |
|            +-- Scene Iframe (/wallpapers/<name>/index.html)           |
|            +-- WebGL2 Post-Processing Pipeline (26 Shaders @ 60 FPS)  |
+-----------------------------------------------------------------------+
         ^                                                  ^
         | (Win32 Cursor & Left-Click Polling @ 60 Hz)      | (IPC Events)
         |                                                  |
+----------------------------------+    +-------------------------------+
|  Win32 Desktop Integration       |    |  ASCII Desk Studio Window     |
|  - WorkerW Auto-Recovery         |    |  [01] Fuente del Fondo        |
|  - Desktop Icon Hide/Show        |    |  [02] Estilo y Efectos        |
|  - Fullscreen App Auto-Pause     |    |  [03] Aplicar y Exportar      |
+----------------------------------+    +-------------------------------+
```

---

## Caracteristicas Principales

### 1. Integracion Nativa con Windows (Win32 API)
- **Anclaje en `WorkerW` (`0x052C`)**: Se situa detras de los iconos del escritorio (`SysListView32` / `SHELLDLL_DefView`) sin bordes, sin sombras DWM y sin aparecer en `Alt+Tab`.
- **Modo Multimonitor Continuo**: Extiende un unico lienzo continuo a traves de todos los monitores (`SM_XVIRTUALSCREEN` a `SM_CYVIRTUALSCREEN`), permitiendo que las simulaciones crucen de una pantalla a otra sin cortes.
- **Ocultacion de Iconos del Escritorio**: Permite ocultar o mostrar instantaneamente los iconos del escritorio de Windows para apreciar el fondo limpio.
- **Interaccion Directa en el Escritorio**: Reenvia el movimiento del cursor y los clics izquierdos realizados sobre cualquier area libre del escritorio hacia el fondo activo.
- **Ahorro Automatico de Recursos**: Detecta cuando el usuario tiene un juego o aplicacion maximizada / en pantalla completa y pausa el renderizado para liberar CPU y GPU.

### 2. Estudio Visual y Fuentes Soportadas (`01 // Fuente del Fondo`)
- **Fondos Interactivos Modulares (`/wallpapers`)**:
  - `ascii-koi`: Estanque interactivo de peces Koi renderizados en celdas de caracteres ASCII. El clic izquierdo en el escritorio lanza comida al agua.
  - `matrix-rain`: Lluvia digital interactiva con ondas expansivas y conjuntos de caracteres configurables.
- **Soporte Multimedia Nativo (`GetOpenFileNameW`)**:
  - Carga directa de **GIF animados (`.gif`)**, **Videos (`.mp4`, `.webm`)** e **Imagenes (`.png`, `.jpg`, `.webp`)** procesados en tiempo real por el motor de shaders.

### 3. Motor WebGL2 con 26 Shaders en Tiempo Real (`02 // Estilo y Efectos`)

```text
+-----------------------+-----------------------------------------------+
| CATEGORIA             | ESTILOS INCLUIDOS                             |
+-----------------------+-----------------------------------------------+
| [Original]            | 00. Original (Bypass)                         |
+-----------------------+-----------------------------------------------+
| [ASCII & Text]        | 01. Standard ASCII (Rampa editable)           |
|                       | 02. High-Res Unicode Braille                  |
|                       | 03. Matrix Katakana Rain                      |
|                       | 04. ANSI Shaded Blocks                        |
|                       | 05. Minimalist Symbols                        |
+-----------------------+-----------------------------------------------+
| [Dithering & Print]   | 06. Ordered Bayer 1-Bit                       |
|                       | 07. Ordered Bayer Color                       |
|                       | 08. Atkinson Dither                           |
|                       | 09. Halftone Dots                             |
|                       | 10. CMYK Offset Print                         |
|                       | 11. Crosshatch Engraving                      |
|                       | 12. CRT Scanlines & Phosphor Mask             |
+-----------------------+-----------------------------------------------+
| [Blocks & Tactile]    | 13. LEGO Stud Bricks 3D                       |
|                       | 14. Tactile Beveled Blocks                    |
|                       | 15. Pixel Art + Palettes (GameBoy/PICO-8/CGA) |
|                       | 16. Ceramic Tile Mosaic                       |
|                       | 17. Voronoi Stained Glass                     |
|                       | 18. Cross-Stitch Embroidery                   |
+-----------------------+-----------------------------------------------+
| [Optics & Glitch]     | 19. Frosted Glass Refraction                  |
|                       | 20. Motion Blur & Echo                        |
|                       | 21. RGB Shift / VHS Glitch                    |
|                       | 22. Edge Detection (Sobel Neon)               |
|                       | 23. Topographic Contour Lines                 |
|                       | 24. Thermal Infrared Vision                   |
|                       | 25. Mixed Hybrid (ASCII + Blocks)             |
+-----------------------+-----------------------------------------------+
```

### 4. Salida y Exportacion (`03 // Aplicar y Exportar`)
- **Ajuste de Proporcion**: Modos `Rellenar`, `Ajustar`, `16:9` y `1:1`.
- **Captura y Grabacion**: Exportacion instantanea del lienzo procesado a imagen **PNG** o grabacion de video **WebM (5s a 60 FPS)**.

---

## Estructura del Repositorio

```text
ASCII-Desk/
|-- config.json                 # Estado persistente de la aplicacion
|-- package.json                # Scripts de Tauri CLI
|-- src/
|   |-- index.html              # Interfaz de ASCII Desk (Host y Estudio)
|   |-- panel.css               # Hoja de estilos 1-bit SunOS / Swiss Editorial
|   |-- main.js                 # Controlador principal, vista previa y GIF/Video
|   |-- bridge.js               # Puente de eventos e inyeccion WebGL2
|   +-- shaders/
|       +-- registry.js         # Pipeline WebGL2 y 26 fragment shaders
|-- src-tauri/
|   |-- Cargo.toml              # Dependencias Rust y windows-sys
|   |-- tauri.conf.json         # Configuracion de Tauri v2
|   +-- src/
|       |-- main.rs             # Bandeja del sistema, comandos IPC y protocolo
|       +-- win32_desktop.rs    # Anclaje WorkerW, hook de mouse y dialogos Win32
+-- wallpapers/
    |-- ascii-koi/              # Escena interactiva ASCII Koi Pond
    +-- matrix-rain/            # Escena interactiva Matrix Digital Rain
```

---

## Compilacion y Ejecucion en Windows

### Requisitos
- **Rust** (`stable-x86_64-pc-windows-gnu` o `msvc`)
- **Node.js** (v18+)
- **WebView2 Runtime** (incluido por defecto en Windows 10/11)

### Comandos

```powershell
# 1. Instalar dependencias de Node
npm install

# 2. Compilar el binario nativo en Rust / Tauri
cd src-tauri
cargo build

# 3. Ejecutar ASCII Desk
.\target\debug\ascii-desk.exe
```

---

## Creacion de Nuevos Fondos Modulares

Cualquier carpeta añadida dentro de `/wallpapers/<nombre-fondo>/` con un archivo `index.html` y un `manifest.json` es detectada automaticamente por **ASCII Desk** y listada tanto en el menu de la bandeja del sistema como en el selector del estudio:

```json
{
  "name": "Mi Fondo ASCII",
  "author": "Autor",
  "description": "Descripcion breve de la escena.",
  "controls": [
    {
      "id": "speed",
      "label": "Velocidad",
      "type": "slider",
      "min": 0.1,
      "max": 3.0,
      "step": 0.1,
      "default": 1.0
    }
  ]
}
```
