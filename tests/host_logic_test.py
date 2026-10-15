import io
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "host"))
import download_host as host


class HostLogicTest(unittest.TestCase):
    def test_watch_url_rejects_anything_except_an_id(self):
        self.assertEqual(host.watch_url("jNQXAC9IVRw"), "https://www.youtube.com/watch?v=jNQXAC9IVRw")
        self.assertEqual(host.watch_url("../etc/passwd"), "")
        self.assertEqual(host.watch_url("https://evil.example/watch?v=jNQXAC9IVRw"), "")
        self.assertEqual(host.watch_url("short"), "")

    def test_safe_stem_stays_one_filename(self):
        stem = host.safe_stem("../etc/passwd", "jNQXAC9IVRw")
        self.assertEqual(stem, "etc passwd [jNQXAC9IVRw]")
        self.assertNotIn("/", stem)
        self.assertNotIn("\\", stem)
        reserved = host.safe_stem("con", "jNQXAC9IVRw")
        self.assertTrue(reserved.startswith("youtube-video ["))

    def test_message_roundtrip_and_bad_id_does_not_download(self):
        payload = {"type": "download", "videoId": "nope", "title": "x", "outDir": "C:\\Windows"}
        raw = json_message(payload)
        message = host.read_message(io.BytesIO(raw))
        self.assertEqual(message["videoId"], "nope")
        out = io.BytesIO()
        host.NATIVE_OUT = out
        result = host.handle(message, Path.home() / "Downloads")
        self.assertEqual(result["type"], "error")
        self.assertIn("无效", result["message"])

    def test_public_error_hides_urls(self):
        text = host.public_error(RuntimeError("403 https://example.invalid/videoplayback?id=1"))
        self.assertNotIn("http", text)
        self.assertIn("拒绝", text)


def json_message(payload):
    import json
    data = json.dumps(payload).encode("utf-8")
    return struct.pack("<I", len(data)) + data


if __name__ == "__main__":
    unittest.main()
