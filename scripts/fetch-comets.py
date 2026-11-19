"""Refresh the small, pinned JPL Horizons comet sample (network required).

Run manually with python3 scripts/fetch-comets.py. Never runs during a build.
Keeps response headers/solution provenance and hashes beside the compact vectors.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [('1P', 'Halley'), ('2P', 'Encke'), ('55P', 'Tempel-Tuttle')]


def fetch(designation, start, stop):
    params = dict(format='json', COMMAND=f"'DES={designation}; CAP;'",
                  EPHEM_TYPE="'VECTORS'", CENTER="'500@10'", START_TIME=f"'{start}'",
                  STOP_TIME=f"'{stop}'", STEP_SIZE="'4 d'", TIME_TYPE="'UT'",
                  OUT_UNITS="'AU-D'", REF_PLANE="'ECLIPTIC'", REF_SYSTEM="'ICRF'",
                  VEC_TABLE="'2'", CSV_FORMAT="'YES'", VEC_CORR="'NONE'", OBJ_DATA="'YES'")
    url = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + urlencode(params)
    with urlopen(url, timeout=90) as response:
        raw = response.read()
    result = json.loads(raw)['result']
    header, body = result.split('$$SOE')
    body = body.split('$$EOE')[0]
    rows = []
    for line in body.strip().splitlines():
        cols = line.split(',')
        rows.append([float(cols[0]), *[float(x) for x in cols[2:8]]])
    header = '\n'.join(line for line in header.splitlines() if 'Calling TDBMUT' not in line) + '\n'
    return rows, dict(url=url, sha256=hashlib.sha256(raw).hexdigest(), header=header)


def main():
    data = {}
    provenance = dict(source='NASA/JPL Horizons', retrieved=datetime.now(timezone.utc).isoformat(),
                      frame='Heliocentric ecliptic J2000', time='UT', units='AU, AU/day', objects={})
    checks = {}
    for designation, name in TARGETS:
        rows, source = fetch(designation, '1980-01-01', '2100-01-01')
        # Midpoint references independently computed by Horizons, including every perihelion.
        middle, check_source = fetch(designation, '1980-01-03', '2099-12-30')
        data[designation] = {'start': rows[0][0], 'step': 4,
                             'states': [[float(f'{v:.12g}') for v in row[1:]] for row in rows]}
        provenance['objects'][designation] = source
        # Retain the worst midpoint and a representative set for offline regressions.
        errors = []
        for idx, row in enumerate(middle):
            if idx + 1 >= len(rows): break
            left, right = rows[idx], rows[idx+1]
            pred = [(left[k+1]+right[k+1])/2 + (left[k+4]-right[k+4])/2 for k in range(3)]
            errors.append((sum((pred[k]-row[k+1])**2 for k in range(3))**.5, idx))
        worst, index = max(errors)
        checks[designation] = {'maxMidpointErrorAU': worst, 'source': check_source,
                              'samples': [middle[i] for i in sorted(set([index, 0, len(errors)-1, *range(0,len(errors),400)]))]}
        print(name, len(rows), 'worst midpoint error (AU)', worst, flush=True)
    (ROOT/'src/unified/comets/vectors.json').write_text(json.dumps(data,separators=(',', ':'))+'\n')
    (ROOT/'src/unified/comets/provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    (ROOT/'tests/fixtures/comet-vectors.json').write_text(json.dumps(checks,indent=2)+'\n')


if __name__ == '__main__': main()
