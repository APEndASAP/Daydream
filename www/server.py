# -*- coding: utf-8 -*-
"""白日梦本地预览服务器（带 no-cache 头，防止浏览器缓存旧版代码）

用法（任选其一）：
  python server.py            # 默认端口 8902
  python server.py 8903       # 指定端口

相比 python -m http.server 的关键区别：每个响应都带
  Cache-Control: no-cache, no-store, must-revalidate
浏览器每次都会向服务器校验文件是否有更新，代码改完刷新即生效，
不会再出现"昨晚是好的今天又坏了"的旧缓存问题。
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8902
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), NoCacheHandler).serve_forever()
