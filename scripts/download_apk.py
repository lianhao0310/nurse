#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
下载 GitHub Actions 构建的 nurse Android .apk 产物到本地 builds/ 目录。

- 在 GitHub 上查找 build-android.yml 最近一次「成功」的运行
- 定位名为 nurse-android-apk 的 artifact，下载并解压
- 幂等：已下载过的 run 会跳过（通过 builds/run-<id>/.downloaded 标记）
- 鉴权：优先环境变量 GITHUB_PAT，其次仓库根目录 .ipa_config 里的 GITHUB_PAT=

用法：
  GITHUB_PAT=xxx python scripts/download_apk.py
  python scripts/download_apk.py        # 从 .ipa_config 读取
"""
import os
import sys
import json
import zipfile
import urllib.request
import urllib.error
import urllib.parse
from http.client import HTTPResponse

REPO = "lianhao0310/nurse"
WORKFLOW = "build-android.yml"
ARTIFACT_NAME = "nurse-android-apk"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "builds")


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
    """删除文件；忽略沙箱安全删除机制（回收站不可用）导致的异常。"""
    try:
        os.remove(path)
    except OSError:
        pass  # 沙箱禁止硬删除时忽略，不影响主流程


def main():
    token = load_token()
    if not token:
        print("ERROR: 未找到 GitHub PAT。请设置环境变量 GITHUB_PAT，"
              "或在仓库根目录 .ipa_config 写入 GITHUB_PAT=...", file=sys.stderr)
        sys.exit(1)

    # 1) 取最近若干次成功运行
    url = (f"https://api.github.com/repos/{REPO}/actions/workflows/{WORKFLOW}"
           f"/runs?status=success&per_page=10")
    try:
        with api(url, token) as r:
            runs = json.load(r).get("workflow_runs", [])
    except urllib.error.HTTPError as e:
        print(f"查询构建运行失败 HTTP {e.code}: {e.read().decode('utf-8','replace')[:300]}",
              file=sys.stderr)
        sys.exit(1)

    if not runs:
        print("没有成功的构建运行（build-android.yml）。")
        return

    for run in runs:
        rid = run["id"]
        head = run.get("head_sha", "")[:8]
        with api(f"https://api.github.com/repos/{REPO}/actions/runs/{rid}/artifacts", token) as r:
            arts = json.load(r).get("artifacts", [])
        art = next((a for a in arts if a["name"] == ARTIFACT_NAME), None)
        if not art:
            continue

        dest = os.path.join(OUT_DIR, f"run-{rid}")
        done = os.path.join(dest, ".downloaded")
        if os.path.exists(done):
            print(f"[跳过] run-{rid} ({head}) 已下载过。")
            return

        os.makedirs(dest, exist_ok=True)
        aid = art["id"]
        size = art.get("size_in_bytes", 0)
        print(f"下载 run-{rid} ({head}) 的 {ARTIFACT_NAME}  大小≈{size/1024:.0f}KB ...")
        try:
            # 该接口会 302 跳转到 Azure blob（自带 SAS 令牌）。
            # 跳转后若仍带 GitHub 的 Authorization 头，Azure 会返回 401。
            # 因此用自定义 opener：跨主机跳转时剥离 Authorization 头。
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

            opener = urllib.request.build_opener(_NoAuthOnRedirect())
            req = urllib.request.Request(
                f"https://api.github.com/repos/{REPO}/actions/artifacts/{aid}/zip",
                headers={
                    "Authorization": "Bearer " + token,
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "User-Agent": "nurse-apk-downloader",
                },
            )
            with opener.open(req, timeout=120) as r:
                data = r.read()
        except urllib.error.HTTPError as e:
            print(f"  下载失败 HTTP {e.code}: {e.read().decode('utf-8','replace')[:300]}",
                  file=sys.stderr)
            sys.exit(1)

        zip_path = os.path.join(dest, "artifact.zip")
        with open(zip_path, "wb") as f:
            f.write(data)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(dest)

        # 把 .apk 重命名为带 commit 短哈希的清晰名字
        for f in os.listdir(dest):
            if f.endswith(".apk"):
                new = os.path.join(dest, f"nurse-{head}.apk")
                if os.path.exists(new):
                    safe_remove(new)
                os.rename(os.path.join(dest, f), new)

        safe_remove(zip_path)
        with open(done, "w") as f:
            f.write(str(rid))

        print(f"[完成] -> {dest}")
        print(f"        apk: nurse-{head}.apk")
        return

    print("最近的构建运行均没有可下载的 apk 产物。")


if __name__ == "__main__":
    main()
