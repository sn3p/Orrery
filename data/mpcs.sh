#!/bin/sh

# Download and extract MPC discovery dates and orbital elements.
# Data available from the Minor Planet Center (http://www.minorplanetcenter.net/data)

NUMMPS_URL="http://www.minorplanetcenter.net/iau/lists/NumberedMPs.txt"
MPCORB_URL="http://www.minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz"

echo "Downloading MPC data ..."
echo "- $NUMMPS_URL"
curl -sO "$NUMMPS_URL" &
echo "- $MPCORB_URL"
curl -sO "$MPCORB_URL" && gunzip -f "${MPCORB_URL##*/}" &
wait
python "mpc2json.py"
