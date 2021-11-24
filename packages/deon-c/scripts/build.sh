rm -rf ./build

mkdir ./build

gcc \
    source/*.c \
    source/cli/*.c \
    source/deon/*.c \
    -Wall -std=c99 -pedantic -o ./build/deon
