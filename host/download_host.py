"""Native messaging host. Downloads one YouTube video with local yt-dlp.

Chrome speaks length-prefixed JSON on stdin and stdout. Library logs stay on
stderr so they cannot break that stream.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import struct
import sys
import threading
import time
from pathlib import Path

MAX_MESSAGE = 65536
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{6,16}$")
RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])$", re.IGNORECASE)
NATIVE_OUT = None


def set_binary_stdio() -> None:
    if sys.platform != "win32":
        return
    import msvcrt

    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)


def read_message(stream):
    raw = stream.read(4)
    if len(raw) < 4:
        return None
    size = struct.unpack("<I", raw)[0]
    if size <= 0 or size > MAX_MESSAGE:
        return None
    data = stream.read(size)
    if len(data) != size:
        return None
    try:
        message = json.loads(data.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(message, dict):
        return None
    return message


def write_message(payload, stream=None) -> None:
    target = stream if stream is not None else NATIVE_OUT
    if target is None:
        raise RuntimeError("native stdout is not ready")
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(data) > MAX_MESSAGE:
        data = json.dumps(
            {"type": "error", "message": "结果太长"}, ensure_ascii=False
        ).encode("utf-8")
    target.write(struct.pack("<I", len(data)))
    target.write(data)
    target.flush()


def watch_url(video_id: str) -> str:
    if not isinstance(video_id, str) or not VIDEO_ID.fullmatch(video_id):
        return ""
    return "https://www.youtube.com/watch?v=" + video_id


def safe_stem(title: str, video_id: str) -> str:
    text = title or ""
    text = re.sub(r"[\u0000-\u001f\u007f]", "", text)
    text = re.sub(r"[\u202a-\u202e\u2066-\u2069]", "", text)
    text = re.sub(r'[<>:"/\\|?*]', " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[\s.]+", "", text)
    text = re.sub(r"[\s.]+$", "", text).strip()
    if len(text) > 80:
        text = text[:80].strip()
    if not text or RESERVED.fullmatch(text):
        text = "youtube-video"
    return text + " [" + video_id + "]"


def public_error(exc: BaseException) -> str:
    text = str(exc or "")
    low = text.lower()
    if "403" in text or "forbidden" in low:
        return "YouTube 拒绝了这次下载，请稍后重试。"
    if "private" in low or "sign in" in low or "login" in low or "age" in low:
        return "这个视频需要登录或有年龄限制，当前不会读取浏览器登录状态。"
    if "ffmpeg" in low:
        return "没有找到 ffmpeg，无法把画面和声音合成一个 mp4。"
    if "javascript runtime" in low or "js runtime" in low:
        return "没有可用的 Node.js，yt-dlp 无法完成下载。"
    if "unavailable" in low or "not available" in low:
        return "这个视频现在不能下载。"
    if "not allowed" in low:
        return "保存文件夹不可用，请重新选择。"
    return "下载失败，请稍后重试。"


def log_error(exc: BaseException) -> None:
    text = re.sub(r"https?://\S+", "[url]", str(exc))
    print(text[:1000], file=sys.stderr)


def _existing_file(path_text: str) -> str:
    if not path_text:
        return ""
    path = Path(path_text)
    return str(path) if path.is_file() else ""


def tool_paths() -> tuple[str, str]:
    data = {}
    config = Path(__file__).with_name("tools.json")
    try:
        loaded = json.loads(config.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            data = loaded
    except (OSError, json.JSONDecodeError):
        data = {}

    node = data.get("node") if isinstance(data.get("node"), str) else ""
    ffmpeg = data.get("ffmpeg") if isinstance(data.get("ffmpeg"), str) else ""
    node = _existing_file(node) or shutil.which("node") or ""
    if not node:
        program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        fallback = Path(program_files) / "nodejs" / "node.exe"
        if fallback.is_file():
            node = str(fallback)
    ffmpeg = _existing_file(ffmpeg) or shutil.which("ffmpeg") or ""
    if not ffmpeg:
        appdata = os.environ.get("APPDATA", "")
        if appdata:
            candidate = Path(appdata) / "VideoToolkit" / "bin" / "ffmpeg.exe"
            if candidate.is_file():
                ffmpeg = str(candidate)
    return node, ffmpeg


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except (OSError, ValueError):
        return False
    return True


def config_path() -> Path:
    return Path(__file__).with_name("download_dir.txt")


def _blocked_roots() -> list[Path]:
    roots = []
    for raw in (
        os.environ.get("SystemRoot") or r"C:\Windows",
        os.environ.get("ProgramFiles") or r"C:\Program Files",
        os.environ.get("ProgramFiles(x86)") or r"C:\Program Files (x86)",
    ):
        try:
            roots.append(Path(raw).resolve())
        except OSError:
            continue
    return roots


def acceptable_output_dir(path: Path) -> Path | None:
    """Accept an existing folder the user chose. Reject system folders and drive roots."""
    try:
        if not path.is_absolute():
            return None
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    if not resolved.is_dir():
        return None
    if resolved == Path(resolved.anchor):
        return None
    for blocked in _blocked_roots():
        if resolved == blocked or _inside(resolved, blocked):
            return None
    return resolved


def default_output_dir() -> Path:
    downloads = Path.home() / "Downloads"
    downloads.mkdir(exist_ok=True)
    checked = acceptable_output_dir(downloads)
    if checked is None:
        raise ValueError("output directory is not allowed")
    return checked


def load_output_dir(config: Path | None = None) -> Path:
    file = config_path() if config is None else config
    if not file.is_file():
        return default_output_dir()
    text = file.read_text(encoding="utf-8").strip()
    chosen = acceptable_output_dir(Path(text)) if text else None
    if chosen is None:
        raise ValueError("output directory is not allowed")
    return chosen


def save_output_dir(path: Path, config: Path | None = None) -> Path:
    chosen = acceptable_output_dir(path)
    if chosen is None:
        raise ValueError("output directory is not allowed")
    file = config_path() if config is None else config
    file.write_text(str(chosen), encoding="utf-8")
    return chosen


def reset_output_dir(config: Path | None = None) -> Path:
    file = config_path() if config is None else config
    try:
        file.unlink()
    except OSError:
        pass
    return default_output_dir()


def pick_output_dir(config: Path | None = None) -> Path | None:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    try:
        root.wm_attributes("-topmost", True)
    except tk.TclError:
        pass
    initial = default_output_dir()
    try:
        initial = load_output_dir(config)
    except ValueError:
        initial = default_output_dir()
    selected = filedialog.askdirectory(
        title="选择视频保存文件夹",
        initialdir=str(initial),
        mustexist=True,
        parent=root,
    )
    root.destroy()
    if not selected:
        return None
    return save_output_dir(Path(selected), config)


def directory_message(path: Path) -> dict:
    return {"type": "directory", "path": str(path)}


def _looks_like_media(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            head = handle.read(32)
    except OSError:
        return False
    if b"ftyp" in head:
        return True
    return head.startswith(b"\x1aE\xdf\xa3")


def _cleanup_partials(directory: Path, stem: str) -> None:
    try:
        names = list(directory.glob(stem + "*"))
    except OSError:
        return
    for path in names:
        if not path.is_file():
            continue
        name = path.name.lower()
        if ".part" in name or name.endswith(".ytdl") or name.endswith(".temp"):
            try:
                path.unlink()
            except OSError:
                pass


def _send_progress(message: str, percent: int | None, last: dict) -> None:
    now = time.monotonic()
    if percent is not None and percent < 100 and now - last["at"] < 0.4:
        return
    last["at"] = now
    payload = {"type": "progress", "message": message}
    if percent is not None:
        payload["percent"] = max(0, min(100, int(percent)))
    write_message(payload)


def download_video(video_id: str, title: str, out_dir: Path) -> Path:
    url = watch_url(video_id)
    if not url:
        raise ValueError("bad video id")
    checked = acceptable_output_dir(out_dir)
    if checked is None:
        raise ValueError("output directory is not allowed")
    out_dir = checked
    out_dir.mkdir(exist_ok=True)

    try:
        from yt_dlp import YoutubeDL
    except Exception as exc:
        raise RuntimeError("yt-dlp is not installed") from exc

    node, ffmpeg = tool_paths()
    if not node:
        raise RuntimeError("No supported JavaScript runtime could be found")
    if not ffmpeg:
        raise RuntimeError("ffmpeg was not found")

    stem = safe_stem(title if isinstance(title, str) else "", video_id)
    outtmpl = str(out_dir / (stem + ".%(ext)s"))
    last = {"at": 0.0}

    def hook(item):
        status = item.get("status")
        if status == "downloading":
            total = item.get("total_bytes") or item.get("total_bytes_estimate") or 0
            done = item.get("downloaded_bytes") or 0
            percent = int(done * 100 / total) if total else None
            _send_progress("正在下载", percent, last)
        elif status == "finished":
            _send_progress("正在准备文件", None, last)

    def post_hook(item):
        if item.get("status") == "started":
            _send_progress("正在合并成 mp4", None, last)

    options = {
        "outtmpl": outtmpl,
        "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "overwrites": True,
        "retries": 5,
        "fragment_retries": 5,
        "file_access_retries": 3,
        "nocheckcertificate": False,
        "windowsfilenames": True,
        "js_runtimes": {"node": {"path": node}},
        "ffmpeg_location": str(Path(ffmpeg).parent),
        "progress_hooks": [hook],
        "postprocessor_hooks": [post_hook],
    }
    try:
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=True) or {}
    except Exception:
        _cleanup_partials(out_dir, stem)
        raise

    candidates = []
    for item in info.get("requested_downloads") or []:
        filepath = item.get("filepath") or item.get("filename")
        if filepath:
            candidates.append(Path(filepath))
    candidates.append(out_dir / (stem + ".mp4"))
    for path in candidates:
        if not path.is_file() or not _inside(path, out_dir):
            continue
        if path.stat().st_size < 1024 or not _looks_like_media(path):
            continue
        return path.resolve()
    _cleanup_partials(out_dir, stem)
    raise RuntimeError("yt-dlp finished without a playable file")


def handle(message, out_dir: Path):
    if not isinstance(message, dict) or message.get("type") != "download":
        return {"type": "error", "message": "请求无效"}
    video_id = message.get("videoId") if isinstance(message.get("videoId"), str) else ""
    if not watch_url(video_id):
        return {"type": "error", "message": "视频编号无效"}
    title = message.get("title") if isinstance(message.get("title"), str) else ""
    if len(title) > 300:
        title = ""
    try:
        path = download_video(video_id, title, out_dir)
    except Exception as exc:
        log_error(exc)
        if "yt-dlp is not installed" in str(exc):
            return {"type": "error", "message": "没有安装 yt-dlp。请运行 py -3 -m pip install -U yt-dlp"}
        return {"type": "error", "message": public_error(exc)}
    return {"type": "done", "message": "已保存", "path": str(path)}


def dispatch(message) -> dict:
    kind = message.get("type") if isinstance(message, dict) else ""
    if kind == "get-directory":
        try:
            return directory_message(load_output_dir())
        except ValueError:
            return {"type": "error", "message": "保存文件夹不可用，请重新选择。"}
    if kind == "reset-directory":
        return directory_message(reset_output_dir())
    if kind == "pick-directory":
        try:
            chosen = pick_output_dir()
        except ValueError:
            return {"type": "error", "message": "这个文件夹不能用来保存视频。"}
        except Exception as exc:
            log_error(exc)
            return {"type": "error", "message": "无法打开文件夹选择窗口。"}
        if chosen is None:
            return {"type": "cancelled"}
        return directory_message(chosen)
    if kind == "download":
        try:
            out_dir = load_output_dir()
        except ValueError:
            return {"type": "error", "message": "保存文件夹不可用，请重新选择。"}
        return handle(message, out_dir)
    return {"type": "error", "message": "请求无效"}


def _watch_parent_close() -> None:
    try:
        while True:
            chunk = sys.stdin.buffer.read(1)
            if not chunk:
                os._exit(0)
    except Exception:
        os._exit(0)


def main() -> int:
    global NATIVE_OUT
    set_binary_stdio()
    NATIVE_OUT = sys.stdout.buffer
    # yt-dlp must not write on the native-messaging stream.
    sys.stdout = sys.stderr
    message = read_message(sys.stdin.buffer)
    if message is None:
        return 1
    threading.Thread(target=_watch_parent_close, daemon=True).start()
    try:
        result = dispatch(message)
    except Exception as exc:
        log_error(exc)
        result = {"type": "error", "message": "下载失败，请稍后重试。"}
    write_message(result)
    # Skip interpreter shutdown while the stdin watcher is still blocked.
    os._exit(0 if result.get("type") in ("done", "directory", "cancelled") else 1)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        log_error(exc)
        if NATIVE_OUT is not None:
            try:
                write_message({"type": "error", "message": "下载失败，请稍后重试。"})
            except Exception:
                pass
        raise SystemExit(1)
