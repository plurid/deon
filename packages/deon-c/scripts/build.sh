rm -rf ./build

mkdir ./build

gcc \
    source/*.c \
    source/cli/*.c \
    source/deon/*.c \
    -Wall -std=c17 -pedantic -o ./build/deon
