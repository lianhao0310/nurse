#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
下载 GitHub Actions 构建的 nurse 产物（iOS .ipa + Android .apk）到本地 builds/ 目录。

- 同时查找 build-ios.yml 和 build-android.yml 最近一次「成功」的运行
- 下载各自 artifact 并解压，重命名为 nurse-<commit>.ipa / nurse-<commit>.apk
- 同一次提交的 IPA+APK 放到 builds/nurse-<commit>/ 同一目录
- 幂等：已下载过的 run 会跳过（通过 .downloaded-<platform> 标记）
- 鉴权：优先环境变量 GITHUB_PAT，其次仓库根目录 .ipa_config 里的 GITHUB_PAT=

用法：
  GITHUB_PAT=xxx python scripts/download_builds.py
  python scripts/download_builds.py        # 从 .ipa_config 读取
  python scripts/download_builds.py ios    # 仅下载 IPA
  python scripts/download_builds.py apk    # 仅下载 APK
"""
import os
import sys
import json
import zipfile
import urllib.request
import urllib.error
import urllib.parse

REPO = "lianhao0310/nurse"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "builds")

PLATFORMS = {
    "ios": {
        "workflow": "build-ios.yml",
        "artifact": "nurse-ios-ipa",
        "ext": ".ipa",
        "ua": "nurse-ipa-downloader",
    },
    "apk": {
        "workflow": "build-android.yml",
        "artifact": "nurse-android-apk",
        "ext": ".apk",
        "ua": "nurse-apk-downloader",
    },
}


def load_token():
    t = os.environ.get("GITHUB_PAT")
    if t:
        return t.strip()
    cfg = os.path.join(ROOT, ".ipa_config")
    if os.path.exists(cfg):
        for line in open(cfg, encoding="utf-8"):
            line = line.strip()
            if line.startswith("GITHUB_PAT="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def api(url, token, method="GET", data=None, accept="application/vnd.github+json"):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", accept)
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    return urllib.request.urlopen(req, timeout=90)


def safe_remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


class _NoAuthOnRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        newreq = super().redirect_request(req, fp, code, msg, headers, newurl)
        if newreq is None:
            return newreq
        old_host = urllib.parse.urlparse(req.get_full_url()).netloc
        new_host = urllib.parse.urlparse(newurl).netloc
        if new_host != old_host and "Authorization" in newreq.headers:
            del newreq.headers["Authorization"]
        return newreq


def download_platform(token, key):
    cfg = PLATFORMS[key]
    wf = cfg["workflow"]
    art_name = cfg["artifact"]
    ext = cfg["ext"]

    print(f"\n=== [{key}] 查找 {wf} 成功运行 ===")
    url = (f"https://api.github.com/repos/{REPO}/actions/workflows/{wf}"
           f"/runs?status=success&per_page=10")
    try:
        with api(url, token) as r:
            runs = json.load(r).get("workflow_runs", [])
    except urllib.error.HTTPError as e:
        print(f"  查询失败 HTTP {e.code}: {e.read().decode('utf-8','replace')[:300]}",
              file=sys.stderr)
        return False

    if not runs:
        print(f"  没有成功的构建运行（{wf}）。")
        return False

    for run in runs:
        rid = run["id"]
        head = run.get("head_sha", "")[:8]
        with api(f"https://api.github.com/repos/{REPO}/actions/runs/{rid}/artifacts", token) as r:
            arts = json.load(r).get("artifacts", [])
        art = next((a for a in arts if a["name"] == art_name), None)
        if not art:
            continue

        dest = os.path.join(OUT_DIR, f"nurse-{head}")
        done = os.path.join(dest, f".downloaded-{key}")
        if os.path.exists(done):
            print(f"  [跳过] run-{rid} ({head}) 已下载过。")
            return True

        os.makedirs(dest, exist_ok=True)
        aid = art["id"]
        size = art.get("size_in_bytes", 0)
        print(f"  下载 run-{rid} ({head}) 的 {art_name}  大小≈{size/1024:.0f}KB ...")
        try:
            opener = urllib.request.build_opener(_NoAuthOnRedirect())
            req = urllib.request.Request(
                f"https://api.github.com/repos/{REPO}/actions/artifacts/{aid}/zip",
                headers={
                    "Authorization": "Bearer " + token,
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "User-Agent": cfg["ua"],
                },
            )
            with opener.open(req, timeout=120) as r:
                data = r.read()
        except urllib.error.HTTPError as e:
            print(f"  下载失败 HTTP {e.code}: {e.read().decode('utf-8','replace')[:300]}",
                  file=sys.stderr)
            return False

        zip_path = os.path.join(dest, "artifact.zip")
        with open(zip_path, "wb") as f:
            f.write(data)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(dest)

        for f in os.listdir(dest):
            if f.endswith(ext):
                src = os.path.join(dest, f)
                new = os.path.join(dest, f"nurse-{head}{ext}")
                if src == new:
                    continue
                if os.path.exists(new):
                    safe_remove(new)
                os.rename(src, new)

        safe_remove(zip_path)
        with open(done, "w") as f:
            f.write(str(rid))

        print(f"  [完成] -> {dest}")
        print(f"          {key}: nurse-{head}{ext}")
        return True

    print(f"  最近的构建运行均没有可下载的 {ext} 产物。")
    return False


def main():
    token = load_token()
    if not token:
        print("ERROR: 未找到 GitHub PAT。请设置环境变量 GITHUB_PAT，"
              "或在仓库根目录 .ipa_config 写入 GITHUB_PAT=...", file=sys.stderr)
        sys.exit(1)

    target = sys.argv[1] if len(sys.argv) > 1 else "all"
    if target == "all":
        keys = list(PLATFORMS.keys())
    elif target in PLATFORMS:
        keys = [target]
    else:
        print(f"ERROR: 未知平台 '{target}'，可用: ios, apk, all", file=sys.stderr)
        sys.exit(1)

    results = {}
    for key in keys:
        results[key] = download_platform(token, key)

    print("\n=== 汇总 ===")
    for key, ok in results.items():
        status = "✅" if ok else "❌"
        print(f"  {status} {key}")

    if not all(results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
