#!/usr/bin/env python
"""
Extract MPC discovery dates and orbital elements.

Discovery dates are extracted from the file NumberedMPs.txt:
http://www.minorplanetcenter.net/iau/lists/NumberedMPs.txt

Orbital elements are extracted from the file MPCORB.DAT:
http://www.minorplanetcenter.net/iau/MPCORB/MPCORB.DAT

TODO:
- Get maximum amount of results
- Get range between discovery dates
- Create an API (python server)
"""

import sys, json, argparse
from time import time
from datetime import datetime
from itertools import izip
# from jdcal import gcal2jd, jd2gcal
# from astropy.time import Time

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

    mpcorbfile = 'MPCORB.DAT'
    nummpsfile = 'NumberedMPs.txt'
    outputfile = 'mpcs.json'

    print 'Extracting MPC discovery dates and orbital elements ...'
    start_time = time()

    # Extract the discovery dates from NumberedMPs.txt
    # For a description of the format see http://www.minorplanetcenter.net/iau/lists/NumberedMPs000001.html

    mpcs_disc = {}

    for line in open(nummpsfile):
        nr = int(line[1:7].strip().replace('(', ''))
        # Extract the discovery date (YYYY MM DD) and convert it to Julian date
        date = datetime.strptime(line[41:51], '%Y %m %d')
        mpcs_disc[nr] = dt2jd(date)

    """
    Extract the orbital elements from MPCORB.DAT
    For a description of the format see http://www.minorplanetcenter.net/iau/info/MPOrbitFormat.html

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

    mpcs = []
    count = 0

    for line in open(mpcorbfile):
        nr = line[167:173].strip().replace('(', '')
        if not nr: continue
        nr = int(nr)

        # Skip if discovery date is missing
        if nr not in mpcs_disc:
            print 'Skipping MPC #%d (no discovery date found)' % (nr)
            continue

        # Extract the orbital elements
        _, _, _, epoch, M, w, W, i, e, n, a, _ = line.split(None, 11)
        mpc = (mpcs_disc[nr], pd2jd(epoch), float(a), float(e), float(i), float(W), float(w), float(M), float(n))
        mpcs.append(mpc)

        # Maximum requested reached?
        count += 1
        if count == args.amount: break

    if args.compact:
        output = mpcs
    else:
        keys = ['disc', 'epoch', 'a', 'e', 'i', 'W', 'w', 'M', 'n']
        output = [dict(izip(keys, mpc)) for mpc in mpcs]

    with open(outputfile, 'w') as outfile:
        json.dump(output, outfile)
        # json.dump(output, outfile, indent=2, separators=(',', ':'))

    print 'Finished extracting %d MPCs in %s seconds.' % (len(mpcs), time()-start_time)

if __name__ == '__main__':
    main(sys.argv[1:])
