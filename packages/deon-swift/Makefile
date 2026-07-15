# The Swift implementation of Deon. It does not re-read the specification — it binds to `deon-c`, the C
# implementation, through a Clang module map over that package's own header (Sources/CDeon). There is one
# parser, one evaluator, one canonical writer, and this package cannot drift from them.
#
# Zero third-party dependencies: the Swift standard library, the C standard library and POSIX, and the C
# sources of the sibling package. No SwiftPM, because SwiftPM will not reach a source file outside the
# package root, and the whole point is to compile the sibling's sources rather than copy them.
#
#   make            build the library, the tool, and the harness adapter
#   make test       run the conformance suite (70 fixtures) against spec/conformance/cases.json
#   make network    run the network test (binds to 127.0.0.1 only, never a public network)
#   make cache      run the credential-cache test

SWIFTC ?= swiftc
CC ?= cc
CFLAGS ?= -std=c17 -O2

CDEON := ../deon-c/source/deon
MODULEMAP := Sources/CDeon/module.modulemap
MODULEFLAG := -Xcc -fmodule-map-file=$(MODULEMAP)

CSRC := $(wildcard $(CDEON)/*.c)
COBJ := $(patsubst $(CDEON)/%.c,build/cobj/%.o,$(CSRC))

LIBSRC := $(wildcard Sources/Deon/*.swift)

.PHONY: all deon harness test depth network cache clean

all: deon harness

# #region the C library, compiled to objects and linked into every Swift binary
build/cobj/%.o: $(CDEON)/%.c
	@mkdir -p build/cobj
	$(CC) $(CFLAGS) -I$(CDEON) -c $< -o $@
# #endregion

# #region the Deon module — the Swift wrapper over the C library
build/Deon.swiftmodule build/Deon.o: $(LIBSRC) $(MODULEMAP)
	@mkdir -p build
	$(SWIFTC) -wmo -parse-as-library -module-name Deon -O -enable-testing $(MODULEFLAG) \
		-emit-module -emit-module-path build/Deon.swiftmodule \
		-emit-object -o build/Deon.o \
		$(LIBSRC)
# #endregion

deon: build/deon
build/deon: Sources/deon-cli/main.swift build/Deon.swiftmodule build/Deon.o $(COBJ)
	$(SWIFTC) -module-name deon_cli -O -I build $(MODULEFLAG) \
		Sources/deon-cli/main.swift build/Deon.o $(COBJ) -o build/deon

harness: build/harness
build/harness: Sources/deon-harness/main.swift build/Deon.swiftmodule build/Deon.o $(COBJ)
	$(SWIFTC) -module-name deon_harness -O -I build $(MODULEFLAG) \
		Sources/deon-harness/main.swift build/Deon.o $(COBJ) -o build/harness

test: build/conformance
	./build/conformance

build/conformance: Tests/Conformance.swift build/Deon.swiftmodule build/Deon.o $(COBJ)
	$(SWIFTC) -module-name conformance -O -I build $(MODULEFLAG) \
		Tests/Conformance.swift build/Deon.o $(COBJ) -o build/conformance

depth: build/depth-test
	./build/depth-test

build/depth-test: Tests/DepthTest.swift build/Deon.swiftmodule build/Deon.o $(COBJ)
	$(SWIFTC) -module-name depth_test -O -I build $(MODULEFLAG) \
		Tests/DepthTest.swift build/Deon.o $(COBJ) -o build/depth-test

network: build/network-test
	./build/network-test

build/network-test: Tests/NetworkTest.swift build/Deon.swiftmodule build/Deon.o $(COBJ)
	$(SWIFTC) -module-name network_test -O -I build $(MODULEFLAG) \
		Tests/NetworkTest.swift build/Deon.o $(COBJ) -o build/network-test

cache: build/cache-test
	./build/cache-test

build/cache-test: Tests/CacheTest.swift build/Deon.swiftmodule build/Deon.o $(COBJ)
	$(SWIFTC) -module-name cache_test -O -I build $(MODULEFLAG) \
		Tests/CacheTest.swift build/Deon.o $(COBJ) -o build/cache-test

clean:
	rm -rf build
