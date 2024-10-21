#!/usr/bin/env python3
"""
Extract minor planet orbital elements and discovery dates to json.

Orbital elements are extracted from the file MPCORB.DAT:
https://minorplanetcenter.net/iau/MPCORB/MPCORB.DAT
Discovery dates are extracted from the file NumberedMPs.txt:
https://minorplanetcenter.net/iau/lists/NumberedMPs.txt

Usage:
======
./data_to_json.py [-h] [-c] [N]

Parse orbital and discovery data to json.

positional arguments:
  N              maximum number of results

optional arguments:
  -h, --help     show this help message and exit
  -c, --compact  output as compact json format

TODO:
=====
- Get range between discovery dates
- Create an API (python server)
"""

OUTPUT_FILE = 'catalog.json'
MPCORB_FILE = 'MPCORB.DAT'
NUMMPS_FILE = 'NumberedMPs.txt'

import os, sys, json, argparse
from time import time
from datetime import datetime
from itertools import zip_longest
from operator import itemgetter

# Change working directory to the module path
os.chdir(os.path.dirname(os.path.realpath(__file__)))

# Datetime to Julian date
def dt2jd(dt):
    dt = dt - datetime(2000, 1, 1)
    return dt.days + (dt.seconds + dt.microseconds / 1000000) / 86400 + 2451544.5

# Packed date to Datetime
def pd2dt(pd):
    y = int(str(int(pd[0], 36)) + pd[1:3])
    m = int(pd[3], 36)
    d = int(pd[4], 36)
    return datetime(y, m, d)

# Packed to Julian date
def pd2jd(pd):
    dt = pd2dt(pd)
    return dt2jd(dt)

def main(argv):
    # Parse argumanets
    parser = argparse.ArgumentParser(description='Parse orbital and discovery data to json.')
    parser.add_argument('amount', metavar='N', type=int, nargs='?', help='maximum number of results')
    parser.add_argument('-c', '--compact', action='store_true', dest='compact', help='output as compact json format')
    args = parser.parse_args()

    print('Extracting MPC discovery dates and orbital elements ...')
    start_time = time()

    """
    Extract the discovery dates from NumberedMPs.txt
    For a description of the format see https://minorplanetcenter.net/iau/lists/NumberedMPs000001.html
    """

    mpcs_disc = {}

    for line in open(NUMMPS_FILE):
        nr_str = line[1:7].strip().replace('(', '')
        if not nr_str.isdigit():
            print(f"Skipping line for invalid number: {nr_str}")
            continue
        nr = int(nr_str)

        # Extract the discovery date (YYYY MM DD)
        date_str = line[41:51]
        try:
            # Convert it to Julian date
            date = datetime.strptime(date_str, '%Y %m %d')
            mpcs_disc[nr] = dt2jd(date)
        except ValueError:
            print(f"Skipping invalid date: {date_str} for MP #{nr}")

    """
    Extract the orbital elements from MPCORB.DAT
    For a description of the format see https://minorplanetcenter.net/iau/info/MPOrbitFormat.html

    The following columns are extracted:

    epoch = Date for which the information is valid (packed date)
    a     = Semi-major axis (AU)
    e     = Orbital eccentricity (0..1)
    i     = Inclination to the ecliptic (degrees)
    W     = Longitude of ascending node (degrees)
    w     = Argument of perihelion (degrees)
    M     = Mean anomaly (degrees)
    n     = Mean daily motion (degrees per day)
    """

    mpcs_disc_len = len(mpcs_disc)
    mpcs = []
    found = 0

    for line in open(MPCORB_FILE):
        nr_str = line[167:173].strip().replace('(', '')
        if not nr_str.isdigit():
            print(f"Skipping line for invalid number: {nr_str}")
            continue
        nr = int(nr_str)

        # Skip if discovery date is missing
        if nr not in mpcs_disc:
            print(f'Skipping MP #{nr} (no discovery date found)')
            continue

        # Extract the orbital elements
        _, _, _, epoch, M, w, W, i, e, n, a, _ = line.split(None, 11)
        mpc = (mpcs_disc[nr], pd2jd(epoch), float(a), float(e), float(i), float(W), float(w), float(M), float(n))
        mpcs.append(mpc)

        # Maximum requested reached?
        found += 1
        if found == args.amount:
            break
        if found == mpcs_disc_len:
            break

    # Sort by discovery date
    mpcs.sort(key=itemgetter(0))

    if args.compact:
        output = mpcs
    else:
        keys = ['disc', 'epoch', 'a', 'e', 'i', 'W', 'w', 'M', 'n']
        output = [dict(zip(keys, mpc)) for mpc in mpcs]

    with open(OUTPUT_FILE, 'w') as outfile:
        json.dump(output, outfile)
        # json.dump(output, outfile, indent=2, separators=(',', ':'))

    print('Finished extracting %d MPCs in %s seconds.' % (len(mpcs), time()-start_time))

if __name__ == '__main__':
    main(sys.argv[1:])
