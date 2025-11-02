#!/usr/bin/env bash
set -xe

export VERSION=$1

sed -i "40s!.*!  source = \"git::https://github.com/retainless/retainless-collector.git//aws/terraform?ref=$VERSION\"!" README.md
sed -i "7s!.*!  \"version\": \"${VERSION#v}\",!" package.json
sed -i "3s!.*!  \"version\": \"${VERSION#v}\",!" packages/cli/package.json
sed -i "3s!.*!  \"version\": \"${VERSION#v}\",!" packages/log-processor/package.json
sed -i "2s!.*!  url = \"https://github.com/retainless/retainless-collector/releases/download/$VERSION/aws.zip\"!" aws/terraform/log-processor.tf
