import http.server, socketserver, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = 8902
Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map.update({'.js':'application/javascript','.m4a':'audio/mp4','.mp3':'audio/mpeg','.ogg':'audio/ogg','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})
class NoCache(Handler):
    def end_headers(self):
        self.send_header('Cache-Control','no-store, no-cache, must-revalidate')
        super().end_headers()
with socketserver.TCPServer(("127.0.0.1", PORT), NoCache) as httpd:
    print(f"Serving on http://127.0.0.1:{PORT}", flush=True)
    httpd.serve_forever()
