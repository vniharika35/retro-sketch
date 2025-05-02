/**
 * sketch.js
 * =========
 * 
 * Retro-Sketch Pixel Art App Logic
 * --------------------------------
 * This script implements all interactive features of Retro-Sketch:
 *  - State management for pen and background colours, grid size, and tool modes
 *  - Dynamic creation of the pixel grid
 *  - Drawing tools: draw (solid, rainbow, shade, lighten), erase, colour grab
 *  - Background-colour picker functionality that only affects untouched cells
 *  - Undo history (including background and per-cell flags)
 *  - Save/load from localStorage
 *  - Export as PNG
 * 
 * Usage:
 *   - Include this file after the toolbar HTML and an empty
 *     <main id="canvasContainer"> in your page.
 *   - Ensure your CSS defines .pixel, .active, .no-grid-lines, etc.
 *   - The toolbar buttons and inputs must have the IDs referenced below.
 */

/* ------------------------------------------------------------------
   SECTION 1: Element References
   ------------------------------------------------------------------ */
const container     = document.getElementById('canvasContainer');
const inputs        = {
  pen: document.getElementById('penColour'),   // <input type="color" id="penColour">
  bg:  document.getElementById('bgColour'),    // <input type="color" id="bgColour">
};
const buttons       = {
  grab:    document.getElementById('grabColour'),   // Colour Grabber
  erase:   document.getElementById('eraserBtn'),    // Eraser tool
  rainbow: document.getElementById('rainbowMode'),  // Toggle Rainbow
  shade:   document.getElementById('shadeMode'),    // Toggle Shade
  lighten: document.getElementById('lightenMode'),  // Toggle Lighten
  undo:    document.getElementById('undoBtn'),      // Undo last action
  clear:   document.getElementById('clearBtn'),     // Clear canvas
  toggle:  document.getElementById('toggleGrid'),   // Toggle grid lines
};
const saveBtn       = document.getElementById('saveBtn');     // Save to browser
const exportBtn     = document.getElementById('exportBtn');   // Export PNG
const gridSizeInput = document.getElementById('gridSize');    // <input type="range">
const gridLabel     = document.getElementById('gridLabel');   // <span>show dimensions

/* ------------------------------------------------------------------
   SECTION 2: Application State
   ------------------------------------------------------------------ */
let penColour   = inputs.pen.value;   // Current drawing colour (#rrggbb)
let bgColour    = inputs.bg.value;    // Canvas background colour (#rrggbb)
let gridSize    = +gridSizeInput.value; // Number of cells per row/column (1–60)
let mode        = 'draw';             // Current tool: 'draw' | 'grab' | 'erase'
let isRainbow   = false;              // Rainbow mode active?
let isShade     = false;              // Shade mode active?
let isLighten   = false;              // Lighten mode active?

/**
 * Undo history stack.
 * Each entry is an object:
 *   {
 *     bgColour: <string>,       // background at that moment
 *     cells: [                   // array of per-cell snapshots
 *       { bg: <string>, orig: <'true'|'false'> }, ...
 *     ]
 *   }
 */
const history = [];

/* ------------------------------------------------------------------
   SECTION 3: Helper Functions
   ------------------------------------------------------------------ */

/**
 * pushHistory()
 * --------------
 * Capture the current state (background colour + each cell's colour
 * and original-flag) and push onto the history stack. Caps at 50 entries.
 */
function pushHistory() {
  const snapshot = {
    bgColour,
    cells: Array.from(container.children).map(cell => ({
      bg:   cell.style.background,
      orig: cell.dataset.original
    }))
  };
  history.push(snapshot);
  if (history.length > 50) history.shift();
}

/**
 * undo()
 * -------
 * Pop the last history snapshot and restore bgColour and each cell.
 * If history is empty, does nothing.
 */
function undo() {
  if (history.length === 0) return;
  const { bgColour: prevBg, cells } = history.pop();

  // Restore background colour
  bgColour = prevBg;
  inputs.bg.value = bgColour;
  container.style.setProperty('--bgColour', bgColour);

  // Restore each cell's style and original flag
  container.querySelectorAll('.pixel').forEach((cell, i) => {
    if (cells[i]) {
      cell.style.background   = cells[i].bg;
      cell.dataset.original   = cells[i].orig;
    }
  });
}

/**
 * parseColor(col)
 * ----------------
 * Accepts a hex string "#rrggbb" or an "rgb(r,g,b)" string,
 * returns an [r,g,b] array of numbers 0–255.
 */
function parseColor(col) {
  if (col.startsWith('#')) {
    const num = parseInt(col.slice(1), 16);
    return [(num >> 16) & 0xFF, (num >> 8) & 0xFF, num & 0xFF];
  }
  const m = col.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/);
  return m ? [ +m[1], +m[2], +m[3] ] : [255, 255, 255];
}

/**
 * clamp(value)
 * -------------
 * Ensure value is between 0 and 255.
 */
function clamp(value) {
  return Math.min(255, Math.max(0, value));
}

/**
 * rgb2hex(r, g, b)
 * ----------------
 * Convert r,g,b 0–255 numbers into "#rrggbb".
 */
function rgb2hex(r, g, b) {
  return '#' + ((r << 16) | (g << 8) | b)
    .toString(16)
    .padStart(6, '0');
}

/**
 * shade(col, amount)
 * ------------------
 * Lighten (amount>0) or darken (amount<0) a colour string.
 * Returns new "#rrggbb".
 */
function shade(col, amount) {
  const [r, g, b] = parseColor(col);
  return rgb2hex(
    clamp(r + amount),
    clamp(g + amount),
    clamp(b + amount)
  );
}

/* ------------------------------------------------------------------
   SECTION 4: Grid Initialization
   ------------------------------------------------------------------ */

/**
 * buildGrid(n)
 * ------------
 * Create an n×n grid of div.pixel cells inside #canvasContainer.
 * Resets history, sets CSS --bgColour, and marks every cell
 * with data-original="true" (meaning untouched).
 */
function buildGrid(n) {
  history.length = 0;                   // clear undo history
  container.innerHTML = '';             // remove existing cells
  container.style.setProperty('--bgColour', bgColour);
  container.style.gridTemplate = `repeat(${n},1fr)/repeat(${n},1fr)`;

  for (let i = 0; i < n * n; i++) {
    const cell = document.createElement('div');
    cell.className = 'pixel';
    cell.style.background = bgColour;
    cell.dataset.original = 'true';
    // Paint or erase on mousedown + drag
    cell.addEventListener('mousedown', onPaint);
    cell.addEventListener('mouseover', e => {
      if (e.buttons === 1) onPaint(e);
    });
    container.append(cell);
  }
}

/* ------------------------------------------------------------------
   SECTION 5: Painting Logic
   ------------------------------------------------------------------ */

/**
 * onPaint(e)
 * -----------
 * Handles all painting interactions on a cell:
 *  - Erase mode: reset to background, flag original
 *  - Grab mode: sample colour and update pen picker
 *  - Draw modes: solid pen, rainbow, shade, lighten
 * After an erase or grab, mode reverts to 'draw'.
 */
function onPaint(e) {
  pushHistory();                   // snapshot for undo
  const cell = e.target;

  // Erase tool: restore to background
  if (mode === 'erase') {
    cell.style.background  = bgColour;
    cell.dataset.original  = 'true';
    mode = 'draw';
    updateUI();
    return;
  }

  // Grab tool: sample and update pen picker
  if (mode === 'grab') {
    penColour = cell.style.background;
    inputs.pen.value = penColour;
    mode = 'draw';
    updateUI();
    return;
  }

  // Determine new colour
  let newCol = penColour;
  if (isRainbow) {
    newCol = `hsl(${Math.random() * 360},100%,50%)`;
  }
  if (isShade) {
    newCol = shade(cell.style.background, -20);
  }
  if (isLighten) {
    newCol = shade(cell.style.background, +20);
  }

  // Apply and mark as painted
  cell.style.background = newCol;
  cell.dataset.original = 'false';
}

/* ------------------------------------------------------------------
   SECTION 6: UI State Management
   ------------------------------------------------------------------ */

/**
 * clearModes()
 * ------------
 * Reset all tool flags and return to 'draw' mode.
 */
function clearModes() {
  isRainbow  = false;
  isShade    = false;
  isLighten  = false;
  mode       = 'draw';
}

/**
 * updateUI()
 * ----------
 * Remove the 'active' class from all tool buttons.
 * Called before adding 'active' back to the selected one.
 */
function updateUI() {
  Object.values(buttons).forEach(btn => {
    btn.classList.remove('active');
  });
}

/* ------------------------------------------------------------------
   SECTION 7: Event Bindings
   ------------------------------------------------------------------ */

// Pen colour picker
inputs.pen.addEventListener('input', e => {
  penColour = e.target.value;
  clearModes();
  updateUI();
});

// Background colour picker
inputs.bg.addEventListener('input', e => {
  pushHistory();  // allow undo of background change
  bgColour = e.target.value;
  container.style.setProperty('--bgColour', bgColour);
  // Recolour only untouched cells
  container.querySelectorAll('.pixel').forEach(cell => {
    if (cell.dataset.original === 'true') {
      cell.style.background = bgColour;
    }
  });
});

// Tool buttons
buttons.grab.addEventListener('click', () => {
  clearModes();
  mode = 'grab';
  updateUI();
  buttons.grab.classList.add('active');
});
buttons.erase.addEventListener('click', () => {
  clearModes();
  mode = 'erase';
  updateUI();
  buttons.erase.classList.add('active');
});
buttons.rainbow.addEventListener('click', () => {
  clearModes();
  isRainbow = true;
  updateUI();
  buttons.rainbow.classList.add('active');
});
buttons.shade.addEventListener('click', () => {
  clearModes();
  isShade = true;
  updateUI();
  buttons.shade.classList.add('active');
});
buttons.lighten.addEventListener('click', () => {
  clearModes();
  isLighten = true;
  updateUI();
  buttons.lighten.classList.add('active');
});

// Clear, Undo, Toggle Grid
buttons.clear.addEventListener('click', () => buildGrid(gridSize));
buttons.undo.addEventListener('click', undo);
buttons.toggle.addEventListener('click', () => {
  container.classList.toggle('no-grid-lines');
});

// Grid size slider
gridSizeInput.addEventListener('input', e => {
  gridSize = +e.target.value;
  gridLabel.textContent = `${gridSize}×${gridSize}`;
  buildGrid(gridSize);
});

// Save to browser storage
saveBtn.addEventListener('click', () => {
  const data = Array.from(container.children).map(cell => ({
    bg:   cell.style.background,
    orig: cell.dataset.original
  }));
  localStorage.setItem('retroSketchData', JSON.stringify({
    gridSize,
    bgColour,
    data
  }));
  alert('Canvas saved.');
});

// Export as PNG
exportBtn.addEventListener('click', () => {
  const scale = 10;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = gridSize * scale;
  const ctx = cvs.getContext('2d');
  container.querySelectorAll('.pixel').forEach((cell, i) => {
    const x = i % gridSize;
    const y = Math.floor(i / gridSize);
    ctx.fillStyle = cell.style.background;
    ctx.fillRect(x * scale, y * scale, scale, scale);
  });
  const link = document.createElement('a');
  link.download = 'retro-sketch.png';
  link.href = cvs.toDataURL();
  link.click();
});

/* ------------------------------------------------------------------
   SECTION 8: Initialization & Restore
   ------------------------------------------------------------------ */

window.addEventListener('load', () => {
  // Try to load saved state
  const saved = JSON.parse(localStorage.getItem('retroSketchData') || 'null');
  if (saved) {
    gridSize = saved.gridSize;
    bgColour = saved.bgColour;
    inputs.bg.value = bgColour;
    gridSizeInput.value = gridSize;
    gridLabel.textContent = `${gridSize}×${gridSize}`;

    buildGrid(gridSize);

    const cells = container.querySelectorAll('.pixel');
    saved.data.forEach((cellData, i) => {
      if (cells[i]) {
        cells[i].style.background = cellData.bg;
        cells[i].dataset.original = cellData.orig;
      }
    });
  } else {
    // No saved data; build fresh canvas
    buildGrid(gridSize);
  }
});

