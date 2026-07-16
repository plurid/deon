# The C implementation of Deon. Zero third-party dependencies: the C standard library and POSIX only.
# `make` builds the tool and the harness adapter; `make test` runs the conformance suite.
#
# The one exception is opt-in and off by default: `make network-build` compiles the tool with
# -DDEON_NETWORK and links LibreSSL's libtls (-ltls) so that `import ... from https://...` speaks real,
# certificate-verified TLS. Every default target below stays dependency-free — no libtls, plain HTTP only,
# with https refused as an unsupported capability — so the conformance suite, the harness, and the Swift
# build keep working on machines without LibreSSL.

CC ?= cc
CFLAGS ?= -std=c17 -Wall -Wextra -pedantic -O2
INCLUDE := -Isource/deon
LIB := $(wildcard source/deon/*.c)
CLI := source/main.c $(wildcard source/cli/*.c)

# libtls discovery for the opt-in network build only. Override if libtls is not on the default search
# path, e.g. with Homebrew LibreSSL:
#   make network-build TLS_CFLAGS="-I$(brew --prefix libressl)/include" TLS_LDFLAGS="-L$(brew --prefix libressl)/lib"
TLS_CFLAGS ?=
TLS_LDFLAGS ?=

.PHONY: all deon harness test depth correctness network network-build cache clean

all: deon harness

deon: build/deon
build/deon: $(CLI) $(LIB)
	@mkdir -p build
	$(CC) $(CFLAGS) $(INCLUDE) $(CLI) $(LIB) -o build/deon

harness: build/harness
build/harness: source/harness/adapter.c $(LIB)
	@mkdir -p build
	$(CC) $(CFLAGS) $(INCLUDE) source/harness/adapter.c $(LIB) -o build/harness

test: build/conformance
	./build/conformance

build/conformance: tests/conformance.c $(LIB)
	@mkdir -p build
	$(CC) $(CFLAGS) $(INCLUDE) tests/conformance.c $(LIB) -o build/conformance

depth: build/depth
	./build/depth

build/depth: tests/depth.c $(LIB)
	@mkdir -p build
	$(CC) $(CFLAGS) $(INCLUDE) tests/depth.c $(LIB) -o build/depth

correctness: build/correctness
	./build/correctness

build/correctness: tests/correctness.c $(LIB)
	@mkdir -p build
	$(CC) $(CFLAGS) $(INCLUDE) tests/correctness.c $(LIB) -o build/correctness

network: build/network
	./build/network

# The loopback network test. It binds only to 127.0.0.1 and drives the http path, the response-size cap,
# the redirect cap, and cross-origin credential non-forwarding. The response cap is shrunk here so the
# over-cap case is a small, fast transfer rather than a real 16 MiB one; the capping code is identical.
build/network: tests/network.c $(LIB)
	@mkdir -p build
	$(CC) $(CFLAGS) -DDEON_NET_MAX_RESPONSE=65536 $(INCLUDE) tests/network.c $(LIB) -o build/network

# Opt-in TLS build: the tool with https support, linking LibreSSL's libtls. This is the ONLY target that
# is not dependency-free; it requires libtls (https://www.libressl.org) at build and run time. All other
# targets never touch it. Certificate verification is on and is not disabled anywhere in the client.
network-build: build/deon-network
build/deon-network: $(CLI) $(LIB)
	@mkdir -p build
	$(CC) $(CFLAGS) -DDEON_NETWORK $(TLS_CFLAGS) $(INCLUDE) $(CLI) $(LIB) $(TLS_LDFLAGS) -ltls -o build/deon-network

cache: build/cache
	./build/cache

build/cache: tests/cache.c $(LIB)
	@mkdir -p build
	$(CC) $(CFLAGS) $(INCLUDE) tests/cache.c $(LIB) -o build/cache

clean:
	rm -rf build
