#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "deon.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <arpa/inet.h>

/* The network path over a loopback server. Nothing else exercises the socket: the differential harness
 * uses in-memory resources, and every fixture that names the network is a denial. So this test binds a
 * server to 127.0.0.1, never anything routable, and drives an import, a link, a non-success status, and
 * a denial through it. */

static int failures = 0;
static void check(bool ok, const char *what) {
    if (ok) printf("ok   %s\n", what);
    else { printf("FAIL %s\n", what); failures++; }
}

static void serve(int listener) {
    signal(SIGPIPE, SIG_IGN);
    for (;;) {
        int fd = accept(listener, NULL, NULL);
        if (fd < 0) continue;
        char req[2048];
        ssize_t n = read(fd, req, sizeof(req) - 1);
        if (n <= 0) { close(fd); continue; }
        req[n] = '\0';

        const char *body = "{\n    inner value\n}\n";
        const char *status = "200 OK";
        const char *ctype = "application/deon";
        if (strstr(req, "/data.json ")) { body = "{\"n\": 1.50}"; ctype = "application/json"; }
        else if (strstr(req, "/missing")) { status = "404 Not Found"; body = "no"; }

        char response[4096];
        int len = snprintf(response, sizeof(response),
            "HTTP/1.0 %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n%s",
            status, ctype, strlen(body), body);
        ssize_t off = 0;
        while (off < len) { ssize_t w = write(fd, response + off, (size_t)(len - off)); if (w <= 0) break; off += w; }
        close(fd);
    }
}

int main(void) {
    int listener = socket(AF_INET, SOCK_STREAM, 0);
    int one = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); /* 127.0.0.1 — never a routable address */
    addr.sin_port = 0;
    if (bind(listener, (struct sockaddr *)&addr, sizeof(addr)) != 0) { perror("bind"); return 2; }
    if (listen(listener, 8) != 0) { perror("listen"); return 2; }

    socklen_t alen = sizeof(addr);
    getsockname(listener, (struct sockaddr *)&addr, &alen);
    int port = ntohs(addr.sin_port);

    pid_t server = fork();
    if (server == 0) { serve(listener); _exit(0); }
    close(listener);

    char base[64];
    snprintf(base, sizeof(base), "http://127.0.0.1:%d", port);

    deon_options net;
    memset(&net, 0, sizeof(net));
    net.allow_network = true;

    /* an import over the network is evaluated and spread */
    {
        char src[256];
        snprintf(src, sizeof(src), "import c from %s/child.deon\n{\n    ...#c\n}\n", base);
        deon_document *d = deon_parse_with(src, strlen(src), &net);
        deon_value *inner = deon_document_ok(d) ? deon_map_get(deon_document_root(d), "inner") : NULL;
        check(inner && inner->kind == DEON_STRING && strncmp(inner->as.string.data, "value", 5) == 0, "import over http");
        deon_document_free(d);
    }

    /* an injected JSON resource keeps its number's source spelling */
    {
        char src[256];
        snprintf(src, sizeof(src), "import j from %s/data.json\n{\n    ...#j\n}\n", base);
        deon_document *d = deon_parse_with(src, strlen(src), &net);
        deon_value *nn = deon_document_ok(d) ? deon_map_get(deon_document_root(d), "n") : NULL;
        check(nn && nn->kind == DEON_STRING && nn->as.string.len == 4 && memcmp(nn->as.string.data, "1.50", 4) == 0, "json import preserves spelling");
        deon_document_free(d);
    }

    /* a non-success status is DEON_RESOURCE_IO: it was allowed and it failed */
    {
        char src[256];
        snprintf(src, sizeof(src), "import m from %s/missing\n{\n    #m\n}\n", base);
        deon_document *d = deon_parse_with(src, strlen(src), &net);
        check(!deon_document_ok(d) && deon_document_error(d)->code == DEON_RESOURCE_IO, "non-success status is RESOURCE_IO");
        deon_document_free(d);
    }

    /* parse_link fetches and evaluates a document by URL */
    {
        char link[128];
        snprintf(link, sizeof(link), "%s/child.deon", base);
        deon_document *d = deon_parse_link(link, &net);
        deon_value *inner = deon_document_ok(d) ? deon_map_get(deon_document_root(d), "inner") : NULL;
        check(inner && inner->kind == DEON_STRING, "parse_link over http");
        deon_document_free(d);
    }

    /* the network is refused before any socket opens when it was not granted */
    {
        char src[256];
        snprintf(src, sizeof(src), "import c from %s/child.deon\n{\n    #c\n}\n", base);
        deon_document *d = deon_parse(src, strlen(src));
        check(!deon_document_ok(d) && deon_document_error(d)->code == DEON_CAPABILITY_DENIED, "network denied by default");
        deon_document_free(d);
    }

    kill(server, SIGTERM);
    waitpid(server, NULL, 0);

    if (failures == 0) { printf("\nall network cases passed\n"); return 0; }
    fprintf(stderr, "\n%d network failure(s)\n", failures);
    return 1;
}
