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
#include <dirent.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <netinet/in.h>

/* The response cache, keyed by a digest of the credential (section 9). The proof that the cache is a
 * cache is that a second fetch succeeds after the server is gone; the proof that the digest separates
 * credentials is that a fetch under a different token, against the same URL, misses and so fails. */

static int failures = 0;
static void check(bool ok, const char *what) {
    if (ok) printf("ok   %s\n", what);
    else { printf("FAIL %s\n", what); failures++; }
}

static void serve_once(int listener) {
    int fd = accept(listener, NULL, NULL);
    if (fd < 0) return;
    char req[2048];
    read(fd, req, sizeof(req) - 1);
    const char *body = "{\n    inner value\n}\n";
    char response[512];
    int len = snprintf(response, sizeof(response),
        "HTTP/1.0 200 OK\r\nContent-Type: application/deon\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n%s",
        strlen(body), body);
    ssize_t off = 0;
    while (off < len) { ssize_t w = write(fd, response + off, (size_t)(len - off)); if (w <= 0) break; off += w; }
    close(fd);
}

static bool dir_has_entry(const char *dir) {
    DIR *d = opendir(dir);
    if (!d) return false;
    struct dirent *e;
    bool found = false;
    while ((e = readdir(d))) {
        if (e->d_name[0] != '.' && strlen(e->d_name) == 64) { found = true; break; }
    }
    closedir(d);
    return found;
}

int main(void) {
    int listener = socket(AF_INET, SOCK_STREAM, 0);
    int one = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;
    if (bind(listener, (struct sockaddr *)&addr, sizeof(addr)) != 0) { perror("bind"); return 2; }
    listen(listener, 8);
    socklen_t alen = sizeof(addr);
    getsockname(listener, (struct sockaddr *)&addr, &alen);
    int port = ntohs(addr.sin_port);

    /* serve exactly one request, then the server is gone */
    pid_t server = fork();
    if (server == 0) { serve_once(listener); _exit(0); }
    close(listener);

    char tmpl[] = "/tmp/deon-c-cache-XXXXXX";
    char *dir = mkdtemp(tmpl);
    if (!dir) { perror("mkdtemp"); kill(server, SIGTERM); return 2; }

    char base[64];
    snprintf(base, sizeof(base), "http://127.0.0.1:%d", port);
    char src[256];
    snprintf(src, sizeof(src), "import c from %s/child.deon\n{\n    ...#c\n}\n", base);

    deon_pair authz_secret = { "127.0.0.1", "secret" };
    deon_pair authz_other = { "127.0.0.1", "other" };

    deon_options o;
    memset(&o, 0, sizeof(o));
    o.allow_network = true;
    o.cache = true;
    o.cache_directory = dir;
    o.authorization = &authz_secret;
    o.authorization_len = 1;

    /* the first fetch reaches the one-shot server and writes the cache */
    deon_document *d1 = deon_parse_with(src, strlen(src), &o);
    check(deon_document_ok(d1) && deon_map_get(deon_document_root(d1), "inner"), "first fetch reaches the server");
    deon_document_free(d1);

    check(dir_has_entry(dir), "a digest-named cache entry is written");

    waitpid(server, NULL, 0); /* the server has served its one request and exited */

    /* the second fetch, same credential, is served from the cache — the server is gone */
    deon_document *d2 = deon_parse_with(src, strlen(src), &o);
    check(deon_document_ok(d2) && deon_map_get(deon_document_root(d2), "inner"), "second fetch is served from cache");
    deon_document_free(d2);

    /* a different credential is a different key, so it misses — and with the server gone, fails */
    o.authorization = &authz_other;
    deon_document *d3 = deon_parse_with(src, strlen(src), &o);
    check(!deon_document_ok(d3) && deon_document_error(d3)->code == DEON_RESOURCE_IO, "a different token misses the cache");
    deon_document_free(d3);

    /* clean up the temporary cache directory */
    DIR *dd = opendir(dir);
    if (dd) {
        struct dirent *e;
        while ((e = readdir(dd))) {
            if (e->d_name[0] == '.') continue;
            char path[1024];
            snprintf(path, sizeof(path), "%s/%s", dir, e->d_name);
            remove(path);
        }
        closedir(dd);
    }
    rmdir(dir);

    if (failures == 0) { printf("\nall cache cases passed\n"); return 0; }
    fprintf(stderr, "\n%d cache failure(s)\n", failures);
    return 1;
}
