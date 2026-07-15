# The Java implementation of Deon. Zero third-party dependencies: the Java standard library only.
# `make` builds the tool and the harness adapter; `make test` runs the conformance suite.

JAVAC ?= javac
JAVA ?= java
JFLAGS ?= -d build
LIB := $(wildcard source/deon/*.java)

.PHONY: all deon harness test network cache depth number clean

all: deon harness

deon: build/.cli
build/.cli: $(LIB) $(wildcard source/cli/*.java)
	@mkdir -p build
	$(JAVAC) $(JFLAGS) $(LIB) source/cli/*.java
	@touch build/.cli

harness: build/.harness
build/.harness: $(LIB) $(wildcard source/harness/*.java)
	@mkdir -p build
	$(JAVAC) $(JFLAGS) $(LIB) source/harness/*.java
	@touch build/.harness

test: build/.tests
	$(JAVA) -cp build tests.Conformance

build/.tests: $(LIB) $(wildcard tests/Conformance.java)
	@mkdir -p build
	$(JAVAC) $(JFLAGS) $(LIB) tests/Conformance.java
	@touch build/.tests

network: build/.network
	$(JAVA) -cp build tests.NetworkTest

build/.network: $(LIB) $(wildcard tests/NetworkTest.java)
	@mkdir -p build
	$(JAVAC) $(JFLAGS) $(LIB) tests/NetworkTest.java
	@touch build/.network

cache: build/.cache
	$(JAVA) -cp build tests.CacheTest

build/.cache: $(LIB) $(wildcard tests/CacheTest.java)
	@mkdir -p build
	$(JAVAC) $(JFLAGS) $(LIB) tests/CacheTest.java
	@touch build/.cache

depth: build/.depth
	$(JAVA) -cp build tests.DepthTest

build/.depth: $(LIB) $(wildcard tests/DepthTest.java)
	@mkdir -p build
	$(JAVAC) $(JFLAGS) $(LIB) tests/DepthTest.java
	@touch build/.depth

number: build/.number
	$(JAVA) -cp build tests.NumberTest

build/.number: $(LIB) $(wildcard source/harness/*.java) $(wildcard tests/NumberTest.java)
	@mkdir -p build
	$(JAVAC) $(JFLAGS) $(LIB) source/harness/*.java tests/NumberTest.java
	@touch build/.number

clean:
	rm -rf build
