"""
Servidor de desarrollo para `public/`.

`python -m http.server` no manda cabeceras de caché, así que el navegador se
queda con los módulos ES viejos y uno termina persiguiendo errores que ya
arregló. Este manda `no-store` en todo.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class SinCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, formato, *args):
        pass


puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
manejador = partial(SinCache, directory="public")
print(f"public/ servido en http://localhost:{puerto} (sin caché)")
ThreadingHTTPServer(("127.0.0.1", puerto), manejador).serve_forever()
