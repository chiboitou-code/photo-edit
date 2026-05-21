/**
 * PhotoEdit Pro - メインエディタースクリプト
 * Fabric.js を使用した画像編集アプリ
 */

'use strict';

// ========================================
// グローバル状態管理
// ========================================
const State = {
  canvas: null,           // Fabric.jsキャンバス
  imageObj: null,         // ベース画像オブジェクト
  originalImageData: null,// オリジナル画像データURL
  zoom: 1.0,              // 現在のズーム倍率
  currentTool: 'select',  // 現在のツール
  cropRatio: 'free',      // 切り抜き比率
  isCropping: false,      // 切り抜き中フラグ
  cropBox: null,          // 切り抜きボックスの情報 {x,y,w,h}
  cropDrag: null,         // ドラッグ情報
  filters: {              // 現在のフィルター値
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    sharpness: 0,
    grayscale: false,
    sepia: false,
    invert: false,
  },
  history: [],            // Undo履歴 (データURL配列)
  historyIndex: -1,       // 現在の履歴位置
  maxHistory: 20,         // 最大履歴数
  textLayers: [],         // テキストレイヤー配列
  selectedObject: null,   // 現在選択中のFabricオブジェクト
  bgRemoveFn: null,       // @imgly/background-removal の関数（遅延ロード）
  bgRemoveLoading: false, // モデルロード中フラグ
};

// ========================================
// 初期化
// ========================================
function init() {
  setupFabricCanvas();
  setupEventListeners();
  setupKeyboardShortcuts();
  setupDragAndDrop();
  setupPanelTabs();
  setupSliders();
  setupFilters();
  setupTransform();
  setupTextTools();
  setupLayerPanel();
  setupExport();
  setupZoomControls();

  updateUndoRedoButtons();
  console.log('PhotoEdit Pro 初期化完了');
}

// ========================================
// Fabric.js キャンバスのセットアップ
// ========================================
function setupFabricCanvas() {
  State.canvas = new fabric.Canvas('main-canvas', {
    backgroundColor: '#2a2a2a',
    preserveObjectStacking: true,
    selection: true,
    selectionColor: 'rgba(49,168,255,0.15)',
    selectionBorderColor: '#31A8FF',
    selectionLineWidth: 1,
  });

  // オブジェクト選択イベント
  State.canvas.on('selection:created', onObjectSelected);
  State.canvas.on('selection:updated', onObjectSelected);
  State.canvas.on('selection:cleared', onSelectionCleared);

  // オブジェクト変更後の自動履歴保存
  State.canvas.on('object:modified', () => {
    saveHistory();
    updateLayerPanel();
  });
}

// ========================================
// 画像の読み込み
// ========================================
function loadImage(file) {
  if (!file || !file.type.match(/^image\/(png|jpeg|webp)$/)) {
    showToast('PNG / JPG / WebP 形式の画像のみ対応しています', 'error');
    return;
  }

  showLoading('画像を読み込み中...');

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataURL = e.target.result;
    State.originalImageData = dataURL;

    fabric.Image.fromURL(dataURL, (img) => {
      // キャンバスサイズを画像に合わせる
      const maxW = window.innerWidth - 44 - 260 - 80;
      const maxH = window.innerHeight - 36 - 24 - 60;
      const scaleX = maxW / img.width;
      const scaleY = maxH / img.height;
      const scale = Math.min(scaleX, scaleY, 1);

      State.canvas.setWidth(img.width);
      State.canvas.setHeight(img.height);
      State.canvas.setZoom(1);

      img.set({
        left: 0,
        top: 0,
        selectable: false,
        evented: false,
        id: 'background',
      });

      State.canvas.clear();
      State.canvas.add(img);
      State.canvas.renderAll();

      State.imageObj = img;
      State.filters = {
        brightness: 0, contrast: 0, saturation: 0,
        temperature: 0, sharpness: 0,
        grayscale: false, sepia: false, invert: false,
      };

      // スライダーをリセット
      resetSliders();

      // 画面にフィット
      setZoom(scale);

      // UI表示切り替え
      document.getElementById('drop-zone').style.display = 'none';
      document.getElementById('canvas-wrapper').style.display = 'block';
      document.getElementById('status-bar').style.display = 'flex';

      // リサイズ入力初期値
      document.getElementById('resize-width').value = img.width;
      document.getElementById('resize-height').value = img.height;

      // ステータス更新
      updateStatus();

      // 履歴をリセットして初期状態を保存
      State.history = [];
      State.historyIndex = -1;
      saveHistory();

      // レイヤーパネル更新
      State.textLayers = [];
      updateLayerPanel();

      hideLoading();
      showToast('画像を読み込みました', 'success');
    });
  };
  reader.readAsDataURL(file);
}

// ========================================
// イベントリスナー設定
// ========================================
function setupEventListeners() {
  // ファイル選択ボタン
  document.getElementById('btn-upload').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  document.getElementById('file-input').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      loadImage(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Undo / Redo ボタン
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  // 保存ボタン（ヘッダー）
  document.getElementById('btn-save').addEventListener('click', () => saveImage('png'));

  // ズームボタン
  document.getElementById('btn-zoom-in').addEventListener('click', () => changeZoom(1.25));
  document.getElementById('btn-zoom-out').addEventListener('click', () => changeZoom(0.8));
  document.getElementById('btn-zoom-fit').addEventListener('click', fitToScreen);

  // 背景削除ボタン
  document.getElementById('btn-remove-bg').addEventListener('click', removeBackground);

  // ツールボタン
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      setTool(tool);
    });
  });
}

// ========================================
// ドラッグ＆ドロップ
// ========================================
function setupDragAndDrop() {
  const dropZone = document.getElementById('canvas-area');

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.getElementById('drop-zone').classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    document.getElementById('drop-zone').classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    document.getElementById('drop-zone').classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadImage(file);
  });
}

// ========================================
// パネルタブ切り替え
// ========================================
function setupPanelTabs() {
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const panelId = tab.dataset.panel;

      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById('panel-' + panelId).classList.add('active');
    });
  });
}

// ========================================
// スライダー（色調補正）のセットアップ
// ========================================
function setupSliders() {
  const sliders = [
    { id: 'sl-brightness',  valId: 'val-brightness',  key: 'brightness' },
    { id: 'sl-contrast',    valId: 'val-contrast',    key: 'contrast' },
    { id: 'sl-saturation',  valId: 'val-saturation',  key: 'saturation' },
    { id: 'sl-temperature', valId: 'val-temperature', key: 'temperature' },
    { id: 'sl-sharpness',   valId: 'val-sharpness',   key: 'sharpness' },
  ];

  sliders.forEach(({ id, valId, key }) => {
    const slider = document.getElementById(id);
    const valEl  = document.getElementById(valId);

    slider.addEventListener('input', () => {
      const val = parseInt(slider.value);
      valEl.textContent = val;
      State.filters[key] = val;
      applyFilters();
    });

    // マウスアップ時に履歴保存
    slider.addEventListener('change', () => {
      saveHistory();
    });
  });
}

// ========================================
// フィルター適用（Canvas APIを使用）
// ========================================
function applyFilters() {
  if (!State.imageObj || !State.originalImageData) return;

  // オリジナル画像を一時Canvasに描画
  const tmpCanvas = document.createElement('canvas');
  const tmpCtx = tmpCanvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    tmpCanvas.width  = img.width;
    tmpCanvas.height = img.height;
    tmpCtx.drawImage(img, 0, 0);

    // ピクセル操作でフィルター適用
    const imageData = tmpCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);
    applyPixelFilters(imageData);
    tmpCtx.putImageData(imageData, 0, 0);

    // シャープネス（畳み込みフィルター）
    if (State.filters.sharpness > 0) {
      applySharpness(tmpCtx, tmpCanvas.width, tmpCanvas.height);
    }

    // Fabric画像を更新
    const newDataURL = tmpCanvas.toDataURL('image/png');
    State.imageObj.setSrc(newDataURL, () => {
      State.canvas.renderAll();
    });
  };
  img.src = State.originalImageData;
}

/**
 * ピクセル単位のフィルター処理
 * @param {ImageData} imageData
 */
function applyPixelFilters(imageData) {
  const data  = imageData.data;
  const { brightness, contrast, saturation, temperature, grayscale, sepia, invert } = State.filters;

  // コントラスト係数
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // --- 明るさ ---
    if (brightness !== 0) {
      const bAdj = brightness * 2.55;
      r += bAdj;
      g += bAdj;
      b += bAdj;
    }

    // --- コントラスト ---
    if (contrast !== 0) {
      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      b = contrastFactor * (b - 128) + 128;
    }

    // --- 色温度 (温かく=R↑B↓ / 冷たく=R↓B↑) ---
    if (temperature !== 0) {
      const t = temperature * 0.5;
      r += t;
      b -= t;
    }

    // --- モノクロ ---
    if (grayscale) {
      const avg = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = avg;
    }

    // --- セピア ---
    if (sepia) {
      const or = r, og = g, ob = b;
      r = (or * 0.393) + (og * 0.769) + (ob * 0.189);
      g = (or * 0.349) + (og * 0.686) + (ob * 0.168);
      b = (or * 0.272) + (og * 0.534) + (ob * 0.131);
    }

    // --- 階調の反転 ---
    if (invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    // クランプ (0〜255に収める)
    data[i]     = Math.min(255, Math.max(0, r));
    data[i + 1] = Math.min(255, Math.max(0, g));
    data[i + 2] = Math.min(255, Math.max(0, b));
  }

  // --- 彩度 ---
  if (saturation !== 0) {
    applySaturation(data, saturation / 100);
  }
}

/**
 * 彩度調整（HSL変換を利用）
 */
function applySaturation(data, amount) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l   = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      const newS = Math.min(1, Math.max(0, s + amount * s));

      const h = max === r ? (g - b) / d + (g < b ? 6 : 0)
              : max === g ? (b - r) / d + 2
              : (r - g) / d + 4;

      const newRgb = hslToRgb(h / 6, newS, l);
      data[i]     = Math.round(newRgb[0] * 255);
      data[i + 1] = Math.round(newRgb[1] * 255);
      data[i + 2] = Math.round(newRgb[2] * 255);
    }
  }
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hue2rgb(p, q, h + 1/3),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1/3),
  ];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}

/**
 * シャープネス（アンシャープマスク風）
 */
function applySharpness(ctx, w, h) {
  const amount = State.filters.sharpness / 100;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const copy = new Uint8ClampedArray(data);

  // 簡易シャープネスカーネル
  const kernel = [
     0, -amount,        0,
    -amount, 1 + 4 * amount, -amount,
     0, -amount,        0,
  ];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let val = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const kidx = ((y + ky) * w + (x + kx)) * 4;
            val += copy[kidx + c] * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        data[idx + c] = Math.min(255, Math.max(0, val));
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ========================================
// フィルターボタン（モノクロ・セピア・反転）
// ========================================
function setupFilters() {
  document.getElementById('btn-grayscale').addEventListener('click', () => {
    State.filters.grayscale = !State.filters.grayscale;
    document.getElementById('btn-grayscale').classList.toggle('active', State.filters.grayscale);
    if (State.filters.grayscale) {
      State.filters.sepia = false;
      document.getElementById('btn-sepia').classList.remove('active');
    }
    applyFilters();
    saveHistory();
  });

  document.getElementById('btn-sepia').addEventListener('click', () => {
    State.filters.sepia = !State.filters.sepia;
    document.getElementById('btn-sepia').classList.toggle('active', State.filters.sepia);
    if (State.filters.sepia) {
      State.filters.grayscale = false;
      document.getElementById('btn-grayscale').classList.remove('active');
    }
    applyFilters();
    saveHistory();
  });

  document.getElementById('btn-invert').addEventListener('click', () => {
    State.filters.invert = !State.filters.invert;
    document.getElementById('btn-invert').classList.toggle('active', State.filters.invert);
    applyFilters();
    saveHistory();
  });

  document.getElementById('btn-reset-filters').addEventListener('click', () => {
    State.filters = {
      brightness: 0, contrast: 0, saturation: 0,
      temperature: 0, sharpness: 0,
      grayscale: false, sepia: false, invert: false,
    };
    resetSliders();
    ['btn-grayscale', 'btn-sepia', 'btn-invert'].forEach(id => {
      document.getElementById(id).classList.remove('active');
    });
    applyFilters();
    saveHistory();
    showToast('フィルターをリセットしました', 'info');
  });
}

function resetSliders() {
  const defaults = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0 };
  Object.entries(defaults).forEach(([key, val]) => {
    const slider = document.getElementById(`sl-${key}`);
    const valEl  = document.getElementById(`val-${key}`);
    if (slider) { slider.value = val; }
    if (valEl)  { valEl.textContent = val; }
  });
}

// ========================================
// 変換（リサイズ・回転・反転）
// ========================================
function setupTransform() {
  const widthInput  = document.getElementById('resize-width');
  const heightInput = document.getElementById('resize-height');
  const ratioCheck  = document.getElementById('resize-ratio');
  let origRatio     = 1;

  // 縦横比固定のリアルタイム連動
  widthInput.addEventListener('input', () => {
    if (ratioCheck.checked && State.imageObj) {
      origRatio = State.imageObj.width / State.imageObj.height;
      heightInput.value = Math.round(parseInt(widthInput.value) / origRatio) || '';
    }
  });

  heightInput.addEventListener('input', () => {
    if (ratioCheck.checked && State.imageObj) {
      origRatio = State.imageObj.width / State.imageObj.height;
      widthInput.value = Math.round(parseInt(heightInput.value) * origRatio) || '';
    }
  });

  // サイズ変更適用
  document.getElementById('btn-resize').addEventListener('click', () => {
    if (!State.imageObj) return showToast('画像を読み込んでください', 'error');

    const newW = parseInt(widthInput.value);
    const newH = parseInt(heightInput.value);

    if (!newW || !newH || newW < 1 || newH < 1) {
      return showToast('正しいサイズを入力してください', 'error');
    }
    if (newW > 8000 || newH > 8000) {
      return showToast('サイズは8000px以下にしてください', 'error');
    }

    showLoading('サイズ変更中...');

    // 一時Canvasでリサイズ処理
    const tmpCanvas = document.createElement('canvas');
    const tmpCtx = tmpCanvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      tmpCanvas.width  = newW;
      tmpCanvas.height = newH;
      tmpCtx.drawImage(img, 0, 0, newW, newH);

      const newDataURL = tmpCanvas.toDataURL('image/png');

      // テキストレイヤーのスケール調整
      const scaleX = newW / State.imageObj.width;
      const scaleY = newH / State.imageObj.height;

      State.canvas.getObjects().forEach(obj => {
        if (obj.id !== 'background') {
          obj.set({
            left: obj.left * scaleX,
            top:  obj.top  * scaleY,
            scaleX: (obj.scaleX || 1) * scaleX,
            scaleY: (obj.scaleY || 1) * scaleY,
          });
          obj.setCoords();
        }
      });

      // リサイズ後の画像をセット
      State.canvas.setWidth(newW);
      State.canvas.setHeight(newH);
      State.originalImageData = newDataURL;

      fabric.Image.fromURL(newDataURL, (newImg) => {
        newImg.set({ left: 0, top: 0, selectable: false, evented: false, id: 'background' });
        State.canvas.remove(State.imageObj);
        State.canvas.add(newImg);
        State.canvas.sendToBack(newImg);
        State.canvas.renderAll();
        State.imageObj = newImg;

        fitToScreen();
        updateStatus();
        saveHistory();
        hideLoading();
        showToast(`${newW} × ${newH} px にリサイズしました`, 'success');
      });
    };
    img.src = State.originalImageData;
  });

  // 回転ボタン
  document.getElementById('btn-rotate-left').addEventListener('click',  () => rotateImage(-90));
  document.getElementById('btn-rotate-right').addEventListener('click', () => rotateImage(90));
  document.getElementById('btn-flip-h').addEventListener('click', () => flipImage('horizontal'));
  document.getElementById('btn-flip-v').addEventListener('click', () => flipImage('vertical'));

  // 切り抜きプリセット
  document.querySelectorAll('.crop-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.crop-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.cropRatio = btn.dataset.ratio;
    });
  });

  document.getElementById('btn-start-crop').addEventListener('click', startCrop);
  document.getElementById('btn-apply-crop').addEventListener('click', applyCrop);
  document.getElementById('btn-cancel-crop').addEventListener('click', cancelCrop);
}

/**
 * 画像を回転
 */
function rotateImage(degrees) {
  if (!State.imageObj) return showToast('画像を読み込んでください', 'error');

  showLoading('回転中...');

  const tmpCanvas = document.createElement('canvas');
  const tmpCtx = tmpCanvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const newW = Math.round(img.width * cos + img.height * sin);
    const newH = Math.round(img.width * sin + img.height * cos);

    tmpCanvas.width  = newW;
    tmpCanvas.height = newH;
    tmpCtx.translate(newW / 2, newH / 2);
    tmpCtx.rotate(rad);
    tmpCtx.drawImage(img, -img.width / 2, -img.height / 2);

    const newDataURL = tmpCanvas.toDataURL('image/png');
    reloadBaseImage(newDataURL, () => {
      hideLoading();
      showToast(`${degrees > 0 ? '右' : '左'}${Math.abs(degrees)}°回転しました`, 'success');
    });
  };
  img.src = State.originalImageData;
}

/**
 * 画像を反転
 */
function flipImage(direction) {
  if (!State.imageObj) return showToast('画像を読み込んでください', 'error');

  const tmpCanvas = document.createElement('canvas');
  const tmpCtx = tmpCanvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    tmpCanvas.width  = img.width;
    tmpCanvas.height = img.height;
    tmpCtx.translate(
      direction === 'horizontal' ? img.width  : 0,
      direction === 'vertical'   ? img.height : 0
    );
    tmpCtx.scale(
      direction === 'horizontal' ? -1 : 1,
      direction === 'vertical'   ? -1 : 1
    );
    tmpCtx.drawImage(img, 0, 0);

    reloadBaseImage(tmpCanvas.toDataURL('image/png'), () => {
      showToast(direction === 'horizontal' ? '水平反転しました' : '垂直反転しました', 'success');
    });
  };
  img.src = State.originalImageData;
}

/**
 * ベース画像を新しいデータURLで更新
 */
function reloadBaseImage(dataURL, callback) {
  State.originalImageData = dataURL;
  fabric.Image.fromURL(dataURL, (newImg) => {
    newImg.set({ left: 0, top: 0, selectable: false, evented: false, id: 'background' });
    State.canvas.setWidth(newImg.width);
    State.canvas.setHeight(newImg.height);
    State.canvas.remove(State.imageObj);
    State.canvas.add(newImg);
    State.canvas.sendToBack(newImg);
    State.canvas.renderAll();
    State.imageObj = newImg;

    document.getElementById('resize-width').value  = newImg.width;
    document.getElementById('resize-height').value = newImg.height;
    updateStatus();
    saveHistory();
    if (callback) callback();
  });
}

// ========================================
// 切り抜き機能
// ========================================
function startCrop() {
  if (!State.imageObj) return showToast('画像を読み込んでください', 'error');

  State.isCropping = true;
  setTool('crop');

  const wrapper  = document.getElementById('canvas-wrapper');
  const overlay  = document.getElementById('crop-overlay');
  const cropBox  = document.getElementById('crop-box');
  const wRect    = wrapper.getBoundingClientRect();

  // キャンバスの表示サイズ
  const canvasW = State.canvas.getWidth()  * State.zoom;
  const canvasH = State.canvas.getHeight() * State.zoom;

  // 初期切り抜きサイズ（中央60%）
  let bx = canvasW * 0.2;
  let by = canvasH * 0.2;
  let bw = canvasW * 0.6;
  let bh = canvasH * 0.6;

  // 比率プリセット適用
  if (State.cropRatio !== 'free' && State.cropRatio !== 'circle') {
    const [rw, rh] = State.cropRatio.split(':').map(Number);
    bh = bw * (rh / rw);
    if (bh > canvasH * 0.8) {
      bh = canvasH * 0.8;
      bw = bh * (rw / rh);
    }
  }

  // 円形は1:1で表示
  if (State.cropRatio === 'circle') {
    bh = bw;
    cropBox.style.borderRadius = '50%';
  } else {
    cropBox.style.borderRadius = '0';
  }

  overlay.style.display = 'block';

  // オーバーレイをキャンバスwrapperに合わせて配置
  overlay.style.left   = wrapper.offsetLeft + 'px';
  overlay.style.top    = wrapper.offsetTop  + 'px';
  overlay.style.width  = canvasW + 'px';
  overlay.style.height = canvasH + 'px';

  function setCropBox(x, y, w, h) {
    bx = Math.max(0, Math.min(x, canvasW - 10));
    by = Math.max(0, Math.min(y, canvasH - 10));
    bw = Math.max(10, Math.min(w, canvasW - bx));
    bh = Math.max(10, Math.min(h, canvasH - by));
    cropBox.style.left   = bx + 'px';
    cropBox.style.top    = by + 'px';
    cropBox.style.width  = bw + 'px';
    cropBox.style.height = bh + 'px';
    State.cropBox = { x: bx, y: by, w: bw, h: bh };
  }

  setCropBox(bx, by, bw, bh);

  // ドラッグ移動
  let dragStart = null;
  let resizeHandle = null;

  function onMouseDown(e) {
    const target = e.target;
    if (target.classList.contains('crop-handle')) {
      resizeHandle = Array.from(target.classList).find(c => ['tl','tr','bl','br'].includes(c));
    } else if (target === cropBox || target.id === 'crop-box') {
      dragStart = { mx: e.clientX, my: e.clientY, bx, by };
    } else {
      // 新規選択開始
      const oRect = overlay.getBoundingClientRect();
      const nx = e.clientX - oRect.left;
      const ny = e.clientY - oRect.top;
      dragStart = null;
      resizeHandle = null;

      let newBx = nx, newBy = ny, newBw = 0, newBh = 0;

      function onNewDrag(me) {
        const dx = me.clientX - oRect.left - nx;
        const dy = me.clientY - oRect.top  - ny;

        if (State.cropRatio !== 'free' && State.cropRatio !== 'circle') {
          const [rw, rh] = State.cropRatio.split(':').map(Number);
          newBw = Math.abs(dx);
          newBh = newBw * (rh / rw);
        } else {
          newBw = Math.abs(dx);
          newBh = State.cropRatio === 'circle' ? newBw : Math.abs(dy);
        }

        setCropBox(
          dx >= 0 ? newBx : newBx - newBw,
          dy >= 0 ? newBy : newBy - newBh,
          newBw, newBh
        );
      }

      function onNewUp() {
        document.removeEventListener('mousemove', onNewDrag);
        document.removeEventListener('mouseup',   onNewUp);
      }

      document.addEventListener('mousemove', onNewDrag);
      document.addEventListener('mouseup',   onNewUp);
    }
  }

  function onMouseMove(e) {
    if (dragStart) {
      const dx = e.clientX - dragStart.mx;
      const dy = e.clientY - dragStart.my;
      setCropBox(dragStart.bx + dx, dragStart.by + dy, bw, bh);
    } else if (resizeHandle) {
      const oRect = overlay.getBoundingClientRect();
      const mx = e.clientX - oRect.left;
      const my = e.clientY - oRect.top;

      const origRight  = bx + bw;
      const origBottom = by + bh;

      let nx = bx, ny = by, nw = bw, nh = bh;

      if (resizeHandle.includes('l')) { nx = mx; nw = origRight - mx; }
      if (resizeHandle.includes('r')) { nw = mx - bx; }
      if (resizeHandle.includes('t')) { ny = my; nh = origBottom - my; }
      if (resizeHandle.includes('b')) { nh = my - by; }

      // 比率固定
      if (State.cropRatio !== 'free' && State.cropRatio !== 'circle') {
        const [rw, rh] = State.cropRatio.split(':').map(Number);
        nh = nw * (rh / rw);
      } else if (State.cropRatio === 'circle') {
        nh = nw;
      }

      setCropBox(nx, ny, nw, nh);
    }
  }

  function onMouseUp() {
    dragStart = null;
    resizeHandle = null;
  }

  overlay.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  // クリーンアップ用に保存
  State._cropCleanup = () => {
    overlay.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
  };

  // UIボタン切り替え
  document.getElementById('btn-start-crop').style.display  = 'none';
  document.getElementById('btn-apply-crop').style.display  = 'block';
  document.getElementById('btn-cancel-crop').style.display = 'block';

  showToast('切り抜き範囲をドラッグで選択してください', 'info');
}

function applyCrop() {
  if (!State.cropBox || !State.imageObj) return;

  const { x, y, w, h } = State.cropBox;
  const invZoom = 1 / State.zoom;

  // 表示座標を実画像座標に変換
  const rx = Math.round(x * invZoom);
  const ry = Math.round(y * invZoom);
  const rw = Math.round(w * invZoom);
  const rh = Math.round(h * invZoom);

  if (rw < 1 || rh < 1) return showToast('切り抜き範囲が小さすぎます', 'error');

  showLoading('切り抜き中...');

  const tmpCanvas = document.createElement('canvas');
  const tmpCtx = tmpCanvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    tmpCanvas.width  = rw;
    tmpCanvas.height = rh;

    // 円形切り抜き
    if (State.cropRatio === 'circle') {
      tmpCtx.beginPath();
      tmpCtx.arc(rw / 2, rh / 2, Math.min(rw, rh) / 2, 0, Math.PI * 2);
      tmpCtx.clip();
    }

    tmpCtx.drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh);

    reloadBaseImage(tmpCanvas.toDataURL('image/png'), () => {
      cancelCrop();
      hideLoading();
      showToast('切り抜きを適用しました', 'success');
    });
  };
  img.src = State.originalImageData;
}

function cancelCrop() {
  State.isCropping = false;
  State.cropBox    = null;

  document.getElementById('crop-overlay').style.display = 'none';
  document.getElementById('btn-start-crop').style.display  = 'block';
  document.getElementById('btn-apply-crop').style.display  = 'none';
  document.getElementById('btn-cancel-crop').style.display = 'none';

  if (State._cropCleanup) {
    State._cropCleanup();
    State._cropCleanup = null;
  }

  setTool('select');
}

// ========================================
// テキスト追加・編集
// ========================================
function setupTextTools() {
  document.getElementById('btn-add-text').addEventListener('click', addTextLayer);

  // 選択テキストの回転・透明度
  document.getElementById('text-rotation').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('val-text-rotation').textContent = val + '°';
    if (State.selectedObject && State.selectedObject.type === 'textbox') {
      State.selectedObject.set('angle', val);
      State.canvas.renderAll();
    }
  });

  document.getElementById('text-opacity').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('val-text-opacity').textContent = val + '%';
    if (State.selectedObject && State.selectedObject.type === 'textbox') {
      State.selectedObject.set('opacity', val / 100);
      State.canvas.renderAll();
    }
  });

  document.getElementById('text-rotation').addEventListener('change', saveHistory);
  document.getElementById('text-opacity').addEventListener('change', saveHistory);

  document.getElementById('btn-delete-text').addEventListener('click', () => {
    if (State.selectedObject) {
      State.canvas.remove(State.selectedObject);
      State.canvas.renderAll();
      saveHistory();
      updateLayerPanel();
      onSelectionCleared();
    }
  });
}

function addTextLayer() {
  if (!State.imageObj) return showToast('画像を読み込んでください', 'error');

  const content     = document.getElementById('text-content').value || 'テキスト';
  const font        = document.getElementById('text-font').value;
  const size        = parseInt(document.getElementById('text-size').value) || 40;
  const color       = document.getElementById('text-color').value;
  const bold        = document.getElementById('text-bold').checked;
  const italic      = document.getElementById('text-italic').checked;
  const strokeColor = document.getElementById('text-stroke-color').value;
  const strokeWidth = parseInt(document.getElementById('text-stroke-width').value) || 0;

  const text = new fabric.Textbox(content, {
    left:       State.canvas.getWidth()  / 2,
    top:        State.canvas.getHeight() / 2,
    originX:    'center',
    originY:    'center',
    fontFamily: font,
    fontSize:   size,
    fill:       color,
    fontWeight: bold   ? 'bold'   : 'normal',
    fontStyle:  italic ? 'italic' : 'normal',
    stroke:     strokeWidth > 0 ? strokeColor : null,
    strokeWidth: strokeWidth,
    editable:   true,
    id:         'text-' + Date.now(),
  });

  State.canvas.add(text);
  State.canvas.setActiveObject(text);
  State.canvas.renderAll();

  State.textLayers.push(text);
  updateLayerPanel();
  saveHistory();
  showToast('テキストを追加しました。ダブルクリックで編集できます', 'info');

  // テキストパネルに切り替え
  switchPanel('text');
}

function onObjectSelected(e) {
  const obj = State.canvas.getActiveObject();
  State.selectedObject = obj;

  if (obj && obj.type === 'textbox') {
    document.getElementById('text-selected-section').style.display = 'block';
    document.getElementById('text-rotation').value = Math.round(obj.angle || 0);
    document.getElementById('val-text-rotation').textContent = Math.round(obj.angle || 0) + '°';
    document.getElementById('text-opacity').value = Math.round((obj.opacity || 1) * 100);
    document.getElementById('val-text-opacity').textContent = Math.round((obj.opacity || 1) * 100) + '%';
  }

  updateLayerPanel();
}

function onSelectionCleared() {
  State.selectedObject = null;
  document.getElementById('text-selected-section').style.display = 'none';
  updateLayerPanel();
}

// ========================================
// レイヤーパネル更新
// ========================================
function setupLayerPanel() {
  document.getElementById('btn-layer-up').addEventListener('click', () => {
    const obj = State.canvas.getActiveObject();
    if (obj && obj.id !== 'background') {
      State.canvas.bringForward(obj);
      State.canvas.renderAll();
      updateLayerPanel();
      saveHistory();
    }
  });

  document.getElementById('btn-layer-down').addEventListener('click', () => {
    const obj = State.canvas.getActiveObject();
    if (obj && obj.id !== 'background') {
      State.canvas.sendBackwards(obj);
      State.canvas.renderAll();
      updateLayerPanel();
      saveHistory();
    }
  });

  document.getElementById('btn-layer-delete').addEventListener('click', () => {
    const obj = State.canvas.getActiveObject();
    if (obj && obj.id !== 'background') {
      State.canvas.remove(obj);
      State.canvas.renderAll();
      updateLayerPanel();
      saveHistory();
    }
  });
}

function updateLayerPanel() {
  const list    = document.getElementById('layers-list');
  const objects = State.canvas.getObjects().slice().reverse(); // 上から表示
  const activeObj = State.canvas.getActiveObject();

  list.innerHTML = '';

  objects.forEach(obj => {
    const item = document.createElement('div');
    item.className = 'layer-item' + (obj === activeObj ? ' active' : '');

    // サムネイル
    const thumb = document.createElement('div');
    thumb.className = 'layer-thumb';

    if (obj.id === 'background') {
      // 背景画像のサムネイル
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width  = 28;
      thumbCanvas.height = 20;
      const tCtx = thumbCanvas.getContext('2d');
      const imgEl = new Image();
      imgEl.onload = () => {
        tCtx.drawImage(imgEl, 0, 0, 28, 20);
        thumbImg.src = thumbCanvas.toDataURL();
      };
      imgEl.src = State.originalImageData || '';
      const thumbImg = document.createElement('img');
      thumb.appendChild(thumbImg);
    } else if (obj.type === 'textbox') {
      thumb.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h8v2H4v-2z"/></svg>';
    }

    // 名前
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = obj.id === 'background' ? '背景画像'
                     : obj.type === 'textbox'  ? obj.text.substring(0, 12) || 'テキスト'
                     : 'オブジェクト';

    // タイプ
    const type = document.createElement('span');
    type.className = 'layer-type';
    type.textContent = obj.id === 'background' ? '画像'
                     : obj.type === 'textbox'  ? 'テキスト'
                     : 'オブジェクト';

    item.appendChild(thumb);
    item.appendChild(name);
    item.appendChild(type);

    // クリックでレイヤー選択
    item.addEventListener('click', () => {
      if (obj.id !== 'background') {
        State.canvas.setActiveObject(obj);
        State.canvas.renderAll();
        updateLayerPanel();
      }
    });

    list.appendChild(item);
  });
}

// ========================================
// 書き出し・保存
// ========================================
function setupExport() {
  const qualitySlider = document.getElementById('export-quality');
  const qualityVal    = document.getElementById('val-export-quality');
  const formatSelect  = document.getElementById('export-format');
  const qualityRow    = document.getElementById('jpeg-quality-row');

  qualitySlider.addEventListener('input', () => {
    qualityVal.textContent = qualitySlider.value + '%';
  });

  formatSelect.addEventListener('change', () => {
    qualityRow.style.display = formatSelect.value === 'png' ? 'none' : 'flex';
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const format   = formatSelect.value;
    const quality  = parseInt(qualitySlider.value) / 100;
    const filename = document.getElementById('export-filename').value || 'edited-image';
    saveImage(format, quality, filename);
  });

  document.getElementById('btn-save-png').addEventListener('click', () => saveImage('png'));
  document.getElementById('btn-save-jpg').addEventListener('click', () => saveImage('jpeg', 0.92));
  document.getElementById('btn-save-png-alpha').addEventListener('click', () => saveImage('png', 1, 'image-alpha', true));
}

/**
 * 画像を保存
 * @param {string} format - 'png' | 'jpeg' | 'webp'
 * @param {number} quality - 0.0〜1.0
 * @param {string} filename - ファイル名（拡張子なし）
 * @param {boolean} transparent - 透過PNG
 */
function saveImage(format = 'png', quality = 0.92, filename = 'edited-image', transparent = false) {
  if (!State.imageObj) return showToast('画像を読み込んでください', 'error');

  showLoading('保存中...');

  // 全オブジェクトを一時Canvasに合成
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width  = State.canvas.getWidth();
  exportCanvas.height = State.canvas.getHeight();
  const ctx = exportCanvas.getContext('2d');

  if (!transparent || format !== 'png') {
    // 背景色を塗る（JPEG用）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  }

  // Fabricキャンバスの内容を描画
  const fabricDataURL = State.canvas.toDataURL({
    format: 'png',
    multiplier: 1,
  });

  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);

    const mimeType = format === 'jpeg' ? 'image/jpeg'
                   : format === 'webp' ? 'image/webp'
                   : 'image/png';

    const dataURL = exportCanvas.toDataURL(mimeType, quality);
    const a = document.createElement('a');
    a.href     = dataURL;
    a.download = `${filename}.${format === 'jpeg' ? 'jpg' : format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    hideLoading();
    showToast(`${format.toUpperCase()} で保存しました`, 'success');
  };
  img.src = fabricDataURL;
}

// ========================================
// 背景削除（@imgly/background-removal - ブラウザ内AIローカル処理）
// APIキー不要・登録不要・画像はサーバーに送信されない
// ========================================

/**
 * @imgly/background-removal ライブラリを遅延ロード
 * 初回のみCDNからONNXモデル（約40MB）をダウンロード、以降はキャッシュ使用
 */
async function loadBgRemoveLib() {
  if (State.bgRemoveFn) return State.bgRemoveFn; // 既にロード済み

  const progressEl = document.getElementById('bg-remove-progress');
  const barEl      = document.getElementById('bg-remove-bar');
  const statusEl   = document.getElementById('bg-remove-status');

  progressEl.style.display = 'block';
  statusEl.textContent = 'AIモデルをロード中...（初回のみ）';
  barEl.style.width = '0%';

  try {
    // ESM CDN から動的インポート
    const CDN = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm';
    const module = await import(/* @vite-ignore */ CDN);
    State.bgRemoveFn = module.removeBackground;

    barEl.style.width = '100%';
    statusEl.textContent = 'AIモデル準備完了 ✅';
    setTimeout(() => { progressEl.style.display = 'none'; }, 1500);

    return State.bgRemoveFn;
  } catch (err) {
    progressEl.style.display = 'none';
    throw new Error('AIモデルのロードに失敗しました: ' + err.message);
  }
}

async function removeBackground() {
  if (!State.imageObj) return showToast('画像を読み込んでください', 'error');
  if (State.bgRemoveLoading) return showToast('処理中です。しばらくお待ちください', 'info');

  State.bgRemoveLoading = true;

  const progressEl = document.getElementById('bg-remove-progress');
  const barEl      = document.getElementById('bg-remove-bar');
  const statusEl   = document.getElementById('bg-remove-status');
  progressEl.style.display = 'block';

  try {
    // ---- Step 1: ライブラリロード ----
    statusEl.textContent = 'AIモデルを準備中...';
    barEl.style.width = '10%';
    const removeBackgroundFn = await loadBgRemoveLib();

    // ---- Step 2: 現在の画像をBlobに変換 ----
    statusEl.textContent = '画像を解析中...';
    barEl.style.width = '30%';

    const fabricDataURL = State.canvas.toDataURL({ format: 'png', multiplier: 1 });
    const imageBlob = dataURLtoBlob(fabricDataURL);

    // ---- Step 3: AI背景削除実行 ----
    statusEl.textContent = 'AI処理中（数秒かかります）...';
    barEl.style.width = '50%';

    const resultBlob = await removeBackgroundFn(imageBlob, {
      model: 'medium',          // small / medium から選択（medium=高精度）
      output: {
        format: 'image/png',
        quality: 0.9,
      },
      // 進捗コールバック
      progress: (key, current, total) => {
        if (total > 0) {
          const pct = Math.round(50 + (current / total) * 45);
          barEl.style.width = pct + '%';
          if (key.includes('fetch')) {
            statusEl.textContent = `モデルDL中... ${Math.round(current/total*100)}%`;
          }
        }
      },
    });

    // ---- Step 4: 結果を読み込んでCanvas更新 ----
    barEl.style.width = '98%';
    statusEl.textContent = '適用中...';

    const reader = new FileReader();
    reader.onload = (e) => {
      reloadBaseImage(e.target.result, () => {
        barEl.style.width = '100%';
        statusEl.textContent = '背景削除完了 ✅';
        setTimeout(() => { progressEl.style.display = 'none'; }, 1500);
        State.bgRemoveLoading = false;
        showToast('背景を削除しました（AI処理）', 'success');
      });
    };
    reader.readAsDataURL(resultBlob);

  } catch (err) {
    progressEl.style.display = 'none';
    State.bgRemoveLoading = false;
    showToast('背景削除エラー: ' + err.message, 'error');
    console.error('Background removal error:', err);
  }
}

function dataURLtoBlob(dataURL) {
  const [header, data] = dataURL.split(',');
  const mime  = header.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const arr   = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ========================================
// ズーム制御
// ========================================
function setupZoomControls() {
  // マウスホイールでズーム
  document.getElementById('canvas-area').addEventListener('wheel', (e) => {
    if (!State.imageObj) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    changeZoom(delta);
  }, { passive: false });
}

function setZoom(zoom) {
  State.zoom = Math.min(8, Math.max(0.05, zoom));
  const wrapper = document.getElementById('canvas-wrapper');

  wrapper.style.transform = `scale(${State.zoom})`;
  wrapper.style.transformOrigin = 'center center';

  const pct = Math.round(State.zoom * 100);
  document.getElementById('zoom-display').textContent = pct + '%';
  document.getElementById('status-zoom').textContent  = pct + '%';
}

function changeZoom(factor) {
  setZoom(State.zoom * factor);
}

function fitToScreen() {
  if (!State.imageObj) return;
  const area = document.getElementById('canvas-area');
  const maxW = area.clientWidth  - 60;
  const maxH = area.clientHeight - 60;
  const scaleX = maxW / State.canvas.getWidth();
  const scaleY = maxH / State.canvas.getHeight();
  setZoom(Math.min(scaleX, scaleY));
}

// ========================================
// ツール切り替え
// ========================================
function setTool(tool) {
  State.currentTool = tool;

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  document.getElementById('status-mode').textContent =
    tool === 'select'   ? '選択'   :
    tool === 'crop'     ? '切り抜き' :
    tool === 'text'     ? 'テキスト' :
    tool === 'zoom-in'  ? 'ズームイン' :
    tool === 'zoom-out' ? 'ズームアウト' : tool;

  // ズームツールのクリック動作
  if (tool === 'zoom-in') {
    document.getElementById('canvas-area').style.cursor = 'zoom-in';
    const onZoomClick = () => changeZoom(1.25);
    State.canvas.on('mouse:down', onZoomClick);
    State._zoomClickHandler = onZoomClick;
  } else if (tool === 'zoom-out') {
    document.getElementById('canvas-area').style.cursor = 'zoom-out';
  } else {
    document.getElementById('canvas-area').style.cursor = 'default';
    if (State._zoomClickHandler) {
      State.canvas.off('mouse:down', State._zoomClickHandler);
      State._zoomClickHandler = null;
    }
  }

  // テキストパネルに自動切り替え
  if (tool === 'text') {
    switchPanel('text');
  }
}

function switchPanel(panelName) {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
  const tab = document.querySelector(`.panel-tab[data-panel="${panelName}"]`);
  if (tab) tab.classList.add('active');
  const panel = document.getElementById('panel-' + panelName);
  if (panel) panel.classList.add('active');
}

// ========================================
// 履歴管理（Undo / Redo）
// ========================================
function saveHistory() {
  if (!State.imageObj) return;

  // 現在位置より後の履歴を削除
  State.history = State.history.slice(0, State.historyIndex + 1);

  // Canvasの状態をJSON + 画像データで保存
  const json    = State.canvas.toJSON(['id']);
  const imgData = State.originalImageData;

  State.history.push({ json, imgData });

  // 最大履歴数を超えたら古いものを削除
  if (State.history.length > State.maxHistory) {
    State.history.shift();
  }

  State.historyIndex = State.history.length - 1;
  updateUndoRedoButtons();
}

function undo() {
  if (State.historyIndex <= 0) return;
  State.historyIndex--;
  restoreHistory(State.historyIndex);
}

function redo() {
  if (State.historyIndex >= State.history.length - 1) return;
  State.historyIndex++;
  restoreHistory(State.historyIndex);
}

function restoreHistory(index) {
  const { json, imgData } = State.history[index];

  showLoading('復元中...');

  State.originalImageData = imgData;

  State.canvas.loadFromJSON(json, () => {
    State.canvas.getObjects().forEach(obj => {
      if (obj.id === 'background') {
        obj.set({ selectable: false, evented: false });
        State.imageObj = obj;
      }
    });
    State.canvas.renderAll();
    updateLayerPanel();
    updateStatus();
    updateUndoRedoButtons();
    hideLoading();
  });
}

function updateUndoRedoButtons() {
  document.getElementById('btn-undo').disabled = State.historyIndex <= 0;
  document.getElementById('btn-redo').disabled = State.historyIndex >= State.history.length - 1;
}

// ========================================
// キーボードショートカット
// ========================================
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key  = e.key.toLowerCase();

    // テキスト入力中は無視
    const tag = document.activeElement.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }

    if (ctrl && key === 'z') { e.preventDefault(); undo(); return; }
    if (ctrl && key === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl && key === 's') {
      e.preventDefault();
      if (e.shiftKey) saveImage('jpeg', 0.92);
      else            saveImage('png');
      return;
    }
    if (ctrl && key === 'o') { e.preventDefault(); document.getElementById('file-input').click(); return; }
    if (ctrl && key === '0') { e.preventDefault(); fitToScreen(); return; }

    if (key === '+' || key === '=') { changeZoom(1.25); return; }
    if (key === '-')                { changeZoom(0.8);  return; }
    if (key === '0')                { setZoom(1.0);     return; }

    if (key === 'v') { setTool('select'); return; }
    if (key === 'c' && !ctrl) { setTool('crop'); return; }
    if (key === 't') { setTool('text'); return; }

    if (key === 'delete' || key === 'backspace') {
      const obj = State.canvas.getActiveObject();
      if (obj && obj.id !== 'background') {
        State.canvas.remove(obj);
        State.canvas.renderAll();
        saveHistory();
        updateLayerPanel();
      }
    }

    if (key === 'escape') {
      if (State.isCropping) cancelCrop();
      State.canvas.discardActiveObject();
      State.canvas.renderAll();
    }

    if (key === '?') {
      document.getElementById('shortcuts-modal').style.display = 'flex';
    }
  });
}

// ========================================
// ショートカットモーダル
// ========================================
function closeShortcuts() {
  document.getElementById('shortcuts-modal').style.display = 'none';
}
window.closeShortcuts = closeShortcuts;

// ========================================
// ステータスバー更新
// ========================================
function updateStatus() {
  if (!State.imageObj) return;
  const w = State.canvas.getWidth();
  const h = State.canvas.getHeight();
  const sizeEl = document.getElementById('status-size');
  sizeEl.textContent = `${w} × ${h} px`;
}

// ========================================
// ローディング表示
// ========================================
function showLoading(message = '処理中...') {
  document.getElementById('loading-message').textContent = message;
  document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

// ========================================
// トースト通知
// ========================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // 3秒後に削除
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ========================================
// アプリ起動
// ========================================
document.addEventListener('DOMContentLoaded', init);
