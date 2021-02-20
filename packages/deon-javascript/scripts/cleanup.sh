#!/bin/bash

find ./distribution -type d -name '*__tests__' -exec rm -rf {} + \
    && find ./distribution -type f -name '*.DS_Store' -exec rm -rf {} +
