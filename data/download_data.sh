#!/bin/bash

# Download and extract MPC discovery dates and orbital elements.
# Data available from the Minor Planet Center (http://www.minorplanetcenter.net/data)

NUMMPS_URL="https://minorplanetcenter.net/iau/lists/NumberedMPs.txt"
MPCORB_URL="https://minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz"

cd "$(dirname "$0")"

echo "Downloading MPC data ..."
echo "- $NUMMPS_URL"
curl -sO "$NUMMPS_URL" &
echo "- $MPCORB_URL"
curl -sO "$MPCORB_URL" && gunzip -f "${MPCORB_URL##*/}"
