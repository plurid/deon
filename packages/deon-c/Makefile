# The C implementation of Deon. Zero third-party dependencies: the C standard library and POSIX only.
# `make` builds the tool and the harness adapter; `make test` runs the conformance suite.

CC ?= cc
CFLAGS ?= -std=c17 -Wall -Wextra -pedantic -O2
INCLUDE := -Isource/deon
LIB := $(wildcard source/deon/*.c)
CLI := source/main.c $(wildcard source/cli/*.c)

.PHONY: all deon harness test network cache clean

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

network: build/network
	./build/network

build/network: tests/network.c $(LIB)
	@mkdir -p build
	$(CC) $(CFLAGS) $(INCLUDE) tests/network.c $(LIB) -o build/network

cache: build/cache
	./build/cache

build/cache: tests/cache.c $(LIB)
	@mkdir -p build
	$(CC) $(CFLAGS) $(INCLUDE) tests/cache.c $(LIB) -o build/cache

clean:
	rm -rf build
