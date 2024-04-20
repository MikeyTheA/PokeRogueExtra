#!/bin/sh
npm run build
echo "Moving build to extension"
cp dist/assets/index-*.js extension/index