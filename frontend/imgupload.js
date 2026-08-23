/*
 * 私人护士 · 图片上传工具（多图导入核心逻辑）
 * 从 <input type="file" multiple> 收集图片并压缩为 dataUrl。
 * 独立模块化以便单元测试：onchange 必须先把 input.files 快照为数组再重置 input，
 * 否则异步压缩遍历途中 input.value="" 会清空 FileList，导致只处理首张图。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NurseImgUpload = api;
})(this, function () {
  "use strict";

  // 从 input.files 快照为真实数组，并立即重置 input.value。
  // 必须在异步处理前快照：input.value="" 会清空 input.files（FileList），
  // 若异步遍历仍引用原 FileList，会因列表被清空而提前结束（只处理首张）。
  function snapshotAndReset(input) {
    const fs = input && input.files ? Array.from(input.files) : [];
    if (input) input.value = "";
    return fs;
  }

  // 收集并压缩图片：遍历 files，过滤非图片，逐张调用 downscale，返回 {name,type,dataUrl}[]。
  // downscale: async (file) => dataUrl（由调用方注入浏览器端 FileReader/canvas 实现）。
  async function collectImages(files, downscale) {
    const out = [];
    const list = files || [];
    for (const f of list) {
      if (!f || !f.type || !String(f.type).startsWith("image/")) continue;
      const d = await downscale(f);
      if (!d) continue;
      out.push({ name: f.name || "image", type: "image/jpeg", dataUrl: d });
    }
    return out;
  }

  return { snapshotAndReset, collectImages };
});
