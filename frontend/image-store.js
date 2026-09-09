/*
 * Nurse · 图片文件存储模块
 * ------------------------------------------------------------------
 * 依赖：@capacitor/filesystem
 *
 * 功能：
 *   - saveImage(dataUrl) → 写二进制文件到 images/ 目录，返回相对路径
 *   - readImage(path) → 读取文件返回 dataUrl
 *   - deleteImage(path) / deleteImages(paths[])
 *   - copyImageDir(srcDir, destDir) → 递归复制图片目录（备份用）
 *
 * 图片目录与 nurse.db 同级：iOS Documents/images/，Android DATA/images/
 * 加载方式：<script src="image-store.js"> -> window.NurseImageStore
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseImageStore = api;
})(this, function () {
  "use strict";

  const IMG_DIR = "images";

  function _fs() {
    return window.Capacitor.Plugins.Filesystem;
  }
  function _fsAvailable() {
    try {
      return !!(
        typeof window !== "undefined" &&
        window.Capacitor &&
        window.Capacitor.Plugins &&
        window.Capacitor.Plugins.Filesystem
      );
    } catch (_) { return false; }
  }
  function _dir() {
    try {
      if (window.Capacitor && window.Capacitor.getPlatform) {
        return window.Capacitor.getPlatform() === "ios" ? "Documents" : "DATA";
      }
    } catch (_) {}
    return "DATA";
  }

  function _rand6() {
    return Math.random().toString(36).slice(2, 8);
  }

  function _genFilename() {
    return Date.now().toString(36) + "-" + _rand6() + ".jpg";
  }

  function _parseDataUrl(dataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
    if (!m) return { type: "image/jpeg", base64: "" };
    return { type: m[1], base64: m[2] };
  }

  async function saveImage(dataUrl) {
    if (!_fsAvailable()) return { path: "", name: "image", type: "image/jpeg" };
    const { type, base64 } = _parseDataUrl(dataUrl);
    if (!base64) return { path: "", name: "image", type: type || "image/jpeg" };
    const filename = _genFilename();
    const path = IMG_DIR + "/" + filename;
    await _fs().writeFile({
      path: path,
      data: base64,
      directory: _dir(),
      recursive: true,
    });
    return { path: path, name: filename, type: type || "image/jpeg" };
  }

  async function saveImages(dataUrls) {
    const out = [];
    for (const d of (dataUrls || [])) {
      if (d && typeof d === "object" && d.dataUrl) {
        const r = await saveImage(d.dataUrl);
        out.push(r);
      } else if (typeof d === "string") {
        const r = await saveImage(d);
        out.push(r);
      }
    }
    return out;
  }

  async function readImage(path, type) {
    if (!_fsAvailable() || !path) return "";
    try {
      const res = await _fs().readFile({ path: path, directory: _dir() });
      const base64 = (typeof res.data === "string") ? res.data : "";
      return "data:" + (type || "image/jpeg") + ";base64," + base64;
    } catch (_) { return ""; }
  }

  async function readImages(items) {
    const out = [];
    for (const im of (items || [])) {
      if (!im || !im.path) { out.push(null); continue; }
      const dataUrl = await readImage(im.path, im.type);
      out.push({ name: im.name || "image", type: im.type || "image/jpeg", dataUrl });
    }
    return out.filter(Boolean);
  }

  async function deleteImage(path) {
    if (!_fsAvailable() || !path) return;
    try { await _fs().deleteFile({ path: path, directory: _dir() }); } catch (_) {}
  }

  async function deleteImages(paths) {
    for (const p of (paths || [])) {
      await deleteImage(p);
    }
  }

  async function listImages() {
    if (!_fsAvailable()) return [];
    try {
      const res = await _fs().readdir({ path: IMG_DIR, directory: _dir() });
      return (res && res.files) || [];
    } catch (_) { return []; }
  }

  async function copyImageDir(destDir, destDirectory) {
    if (!_fsAvailable()) return;
    const files = await listImages();
    for (const f of files) {
      try {
        await _fs().copyFile({
          from: IMG_DIR + "/" + f,
          to: destDir + "/" + IMG_DIR + "/" + f,
          directory: _dir(),
          toDirectory: destDirectory || _dir(),
        });
      } catch (_) {}
    }
  }

  return {
    IMG_DIR,
    saveImage,
    saveImages,
    readImage,
    readImages,
    deleteImage,
    deleteImages,
    listImages,
    copyImageDir,
  };
});
