rm -rf ./build

mkdir ./build

gcc source/main.c -Wall -std=c99 -pedantic -o ./build/deon
